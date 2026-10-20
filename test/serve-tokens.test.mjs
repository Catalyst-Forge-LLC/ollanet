/**
 * `ollanet serve token`: last-used tracking, list output, interactive rm
 * helpers, and prune. All against temp serve.json files.
 */
import assert from "node:assert/strict";
import { createHash } from "node:crypto";
import { readFile, writeFile } from "node:fs/promises";
import path from "node:path";
import { after, before, describe, it } from "node:test";

import { makeSandbox, runCli } from "./helpers.mjs";

const DAY = 86_400_000;
const sha = (s) => createHash("sha256").update(s).digest("hex");
const iso = (msAgo) => new Date(Date.now() - msAgo).toISOString();

function tok(name, extra = {}) {
  return { name, sha256: sha(`olns_${name}`), created_at: iso(40 * DAY), expires_at: null, ...extra };
}

async function writeStore(file, tokens) {
  await writeFile(file, JSON.stringify({ tokens, labels: {} }, null, 2));
}
async function readStore(file) {
  return JSON.parse(await readFile(file, "utf8"));
}

let sandbox;
let storeFile;
let mod;
let store;

before(async () => {
  sandbox = await makeSandbox({ discovery: { localhost: false, tailscale: false, lan: false } });
  storeFile = path.join(sandbox.dir, "serve.json");
  // In-process imports read these at call time (config path at import time).
  process.env.OLLANET_SERVE_FILE = storeFile;
  process.env.OLLANET_CONFIG = sandbox.configFile;
  process.env.OLLANET_LAST_SCAN = path.join(sandbox.dir, "missing-scan.json");
  mod = await import("../dist/serve.js");
  store = await import("../dist/serve-store.js");
});
after(async () => sandbox.cleanup());

const env = () => ({ OLLANET_SERVE_FILE: storeFile });

describe("token list", () => {
  it("shows LAST USED and marks expired tokens", async () => {
    await writeStore(storeFile, [
      tok("fresh"),
      tok("used", { last_used: iso(3 * 60_000 + 5000) }),
      tok("old", { expires_at: iso(DAY) }),
    ]);
    const res = await runCli(["serve", "token", "list"], { sandbox, env: env() });
    assert.equal(res.code, 0, res.stderr);
    const lines = res.stdout.trimEnd().split("\n");
    assert.match(lines[0], /^NAME\s+CREATED\s+EXPIRES\s+LAST USED$/);
    assert.match(res.stdout, /fresh .* never\s+never\n/);
    assert.match(res.stdout, /used .* 3m ago\n/);
    assert.match(res.stdout, /old .* EXPIRED \d{4}-\d\d-\d\d \d\d:\d\dZ/);

    const json = JSON.parse((await runCli(["serve", "token", "list", "--json"], { sandbox, env: env() })).stdout);
    const used = json.find((t) => t.name === "used");
    assert.match(used.last_used, /^\d{4}-\d\d-\d\dT/);
    assert.equal(json.find((t) => t.name === "fresh").last_used, null);
    assert.equal(json.find((t) => t.name === "old").expired, true);
    assert.ok(!JSON.stringify(json).includes("sha256"), "hashes stay out of list output");
  });

  it("formats relative times", () => {
    const now = Date.parse("2026-10-20T12:00:00Z");
    assert.equal(mod.relativeTime(null, now), "never");
    assert.equal(mod.relativeTime("2026-10-20T11:59:30Z", now), "just now");
    assert.equal(mod.relativeTime("2026-10-20T11:57:00Z", now), "3m ago");
    assert.equal(mod.relativeTime("2026-10-20T09:00:00Z", now), "3h ago");
    assert.equal(mod.relativeTime("2026-10-10T12:00:00Z", now), "10d ago");
  });
});

describe("last_used tracking", () => {
  it("writes first use at once, debounces repeats, and flushes on close", async () => {
    const token = "olns_live-token";
    await writeStore(storeFile, [{ ...tok("live"), sha256: sha(token) }, tok("other")]);
    const handle = await mod.startServe({ host: "127.0.0.1", port: 0, refreshMs: 0, rate: 100, lastUsedFlushMs: 60_000 });
    try {
      const auth = { Authorization: `Bearer ${token}` };
      assert.equal((await fetch(`${handle.url}/v1/catalog`, { headers: auth })).status, 200);
      await new Promise((r) => setTimeout(r, 150));
      const first = (await readStore(storeFile)).tokens.find((t) => t.name === "live").last_used;
      assert.ok(first, "first use is written right away");

      await new Promise((r) => setTimeout(r, 20));
      assert.equal((await fetch(`${handle.url}/v1/catalog`, { headers: auth })).status, 200);
      await new Promise((r) => setTimeout(r, 150));
      const second = (await readStore(storeFile)).tokens.find((t) => t.name === "live").last_used;
      assert.equal(second, first, "a repeat within the interval is not written yet");
      assert.equal((await readStore(storeFile)).tokens.find((t) => t.name === "other").last_used, undefined);

      await handle.close();
      const flushed = (await readStore(storeFile)).tokens.find((t) => t.name === "live").last_used;
      assert.ok(Date.parse(flushed) > Date.parse(first), "close() flushes the pending use");
    } finally {
      await handle.close().catch(() => {});
    }
  });

  it("never brings back a token removed in the meantime", async () => {
    const a = tok("keep");
    const b = tok("gone");
    for (let i = 0; i < 10; i += 1) {
      await writeStore(storeFile, [a, b]);
      const used = new Map([
        [a.sha256, new Date().toISOString()],
        [b.sha256, new Date().toISOString()],
      ]);
      await Promise.all([store.recordLastUsed(used), store.removeTokens(["gone"])]);
      const names = (await readStore(storeFile)).tokens.map((t) => t.name);
      assert.deepEqual(names, ["keep"], `round ${i}`);
    }
    await store.recordLastUsed(new Map([[a.sha256, iso(DAY)]]));
    const kept = (await readStore(storeFile)).tokens[0];
    assert.ok(Date.parse(kept.last_used) > Date.now() - DAY / 2, "last_used never moves backwards");
  });
});

describe("token rm (interactive helpers)", () => {
  it("parses picks", () => {
    assert.deepEqual(mod.parseSelection("1,3", 3), [0, 2]);
    assert.deepEqual(mod.parseSelection(" 3 1 1 ", 3), [0, 2]);
    assert.deepEqual(mod.parseSelection("2-3", 3), [1, 2]);
    assert.deepEqual(mod.parseSelection("all", 2), [0, 1]);
    assert.deepEqual(mod.parseSelection("", 2), []);
    assert.match(mod.parseSelection("4", 3), /Out of range/);
    assert.match(mod.parseSelection("x", 3), /Not a number/);
  });

  it("lists, picks, and confirms", async () => {
    const tokens = [tok("a"), tok("b"), tok("c")];
    let shown = "";
    const answers = ["1,3", "y"];
    const names = await mod.chooseTokensToRemove(tokens, async () => answers.shift(), (t) => (shown += t));
    assert.deepEqual(names, ["a", "c"]);
    assert.match(shown, /^#\s+NAME\s+CREATED\s+EXPIRES\s+LAST USED/);
    assert.match(shown, /\n1\s+a\s/);

    const no = ["all", "n"];
    assert.deepEqual(await mod.chooseTokensToRemove(tokens, async () => no.shift(), () => {}), []);
    const cancel = [""];
    assert.deepEqual(await mod.chooseTokensToRemove(tokens, async () => cancel.shift(), () => {}), []);
    await assert.rejects(mod.chooseTokensToRemove(tokens, async () => "9", () => {}), /Out of range/);
  });

  it("errors without a name when not on a terminal, and never waits for input", async () => {
    await writeStore(storeFile, [tok("a")]);
    const started = Date.now();
    const res = await runCli(["serve", "token", "rm"], { sandbox, env: env(), keepStdinOpen: true });
    assert.equal(res.code, 1);
    assert.match(res.stderr, /needs a name/);
    assert.ok(Date.now() - started < 15_000);
    assert.equal((await readStore(storeFile)).tokens.length, 1);
  });

  it("still removes by name", async () => {
    await writeStore(storeFile, [tok("a"), tok("b")]);
    const res = await runCli(["serve", "token", "rm", "a"], { sandbox, env: env() });
    assert.equal(res.code, 0, res.stderr);
    assert.deepEqual((await readStore(storeFile)).tokens.map((t) => t.name), ["b"]);
  });
});

describe("token prune", () => {
  const seed = () =>
    writeStore(storeFile, [
      tok("fresh", { created_at: iso(DAY) }),
      tok("expired", { expires_at: iso(1000) }),
      tok("stale", { last_used: iso(45 * DAY) }),
      tok("recent", { last_used: iso(DAY) }),
    ]);

  it("needs a criterion", async () => {
    const res = await runCli(["serve", "token", "prune", "--yes"], { sandbox, env: env() });
    assert.equal(res.code, 1);
    assert.match(res.stderr, /--expired and\/or --unused-days/);
  });

  it("refuses without --yes off a terminal and removes nothing", async () => {
    await seed();
    const res = await runCli(["serve", "token", "prune", "--expired"], { sandbox, env: env(), keepStdinOpen: true });
    assert.equal(res.code, 1);
    assert.match(res.stderr, /expired \(expired\)/);
    assert.match(res.stderr, /without --yes/);
    assert.equal((await readStore(storeFile)).tokens.length, 4);
  });

  it("--expired --yes removes only expired tokens", async () => {
    await seed();
    const res = await runCli(["serve", "token", "prune", "--expired", "--yes"], { sandbox, env: env() });
    assert.equal(res.code, 0, res.stderr);
    assert.match(res.stdout, /Removed expired/);
    assert.deepEqual((await readStore(storeFile)).tokens.map((t) => t.name), ["fresh", "stale", "recent"]);
  });

  it("--unused-days counts from last use, else creation", async () => {
    await seed();
    const res = await runCli(["serve", "token", "prune", "--unused-days", "30", "--yes"], { sandbox, env: env() });
    assert.equal(res.code, 0, res.stderr);
    assert.deepEqual((await readStore(storeFile)).tokens.map((t) => t.name).sort(), ["fresh", "recent"]);
  });
});
