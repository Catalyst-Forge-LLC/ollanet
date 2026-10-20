/**
 * `ollanet serve`: read-only, token-gated catalog. Asserts auth, sanitization
 * (no hostnames / IPs / ports / paths), token lifecycle, and loopback-only bind.
 */
import assert from "node:assert/strict";
import { spawn } from "node:child_process";
import { readFile } from "node:fs/promises";
import path from "node:path";
import { after, before, describe, it } from "node:test";

import { CLI, makeSandbox, runCli, startMock } from "./helpers.mjs";

function sandboxEnv(sandbox) {
  return {
    ...process.env,
    OLLANET_CONFIG: sandbox.configFile,
    OLLANET_RESPONSES_DIR: sandbox.responsesDir,
    OLLANET_LAST_SCAN: sandbox.lastScanFile,
    OLLANET_SERVE_FILE: path.join(sandbox.dir, "serve.json"),
    OLLANET_HOSTS: "",
    OLLANET_QUIET: "",
  };
}

/** Start `ollanet serve` on an ephemeral loopback port; resolve once it listens. */
function startServe(sandbox, extra = []) {
  const child = spawn(
    process.execPath,
    [CLI, "serve", "--listen", "127.0.0.1:0", "--refresh", "off", ...extra],
    { env: sandboxEnv(sandbox), stdio: ["ignore", "pipe", "pipe"] },
  );
  let stderr = "";
  return new Promise((resolve, reject) => {
    const timer = setTimeout(() => reject(new Error(`serve did not start:\n${stderr}`)), 15_000);
    child.stderr.on("data", (d) => {
      stderr += d;
      const m = /listening on (http:\/\/\S+)/.exec(stderr);
      if (m) {
        clearTimeout(timer);
        resolve({
          url: m[1],
          stderr: () => stderr,
          stop: () =>
            new Promise((done) => {
              child.once("exit", done);
              child.kill();
            }),
        });
      }
    });
    child.once("exit", (code) => {
      clearTimeout(timer);
      reject(new Error(`serve exited (${code}):\n${stderr}`));
    });
  });
}

function env(sandbox) {
  return { OLLANET_SERVE_FILE: path.join(sandbox.dir, "serve.json") };
}

async function addToken(sandbox, name, extra = []) {
  const res = await runCli(["serve", "token", "add", name, ...extra], { sandbox, env: env(sandbox) });
  assert.equal(res.code, 0, res.stderr);
  return res.stdout.trim();
}

/** Every key anywhere in a JSON value. */
function allKeys(value, out = new Set()) {
  if (Array.isArray(value)) value.forEach((v) => allKeys(v, out));
  else if (value && typeof value === "object") {
    for (const [k, v] of Object.entries(value)) {
      out.add(k);
      allKeys(v, out);
    }
  }
  return out;
}

describe("ollanet serve", () => {
  let mock;
  let sandbox;
  let server;
  let token;

  before(async () => {
    mock = await startMock({
      models: ["fake:1b", "qwen3:0.6b"],
      capabilities: { "fake:1b": ["completion", "tools"] },
    });
    sandbox = await makeSandbox({
      discovery: { localhost: false, tailscale: false, lan: false },
      hosts: [{ name: "mockhost", host: "127.0.0.1", port: mock.port }],
      aliases: { desk: { machine: "mockhost", model: "fake:1b" } },
    });
    const scan = await runCli(["scan", "--json"], { sandbox });
    assert.equal(scan.code, 0, scan.stderr);
    token = await addToken(sandbox, "tester");
    server = await startServe(sandbox);
  });
  after(async () => {
    await server?.stop();
    await mock.close();
    await sandbox.cleanup();
  });

  it("answers /healthz without auth", async () => {
    const res = await fetch(`${server.url}/healthz`);
    assert.equal(res.status, 200);
    assert.equal(await res.text(), "ok\n");
  });

  it("requires a bearer token for /v1/* and leaks nothing on 401", async () => {
    for (const [p, headers] of [
      ["/v1/catalog", {}],
      ["/v1/catalog", { Authorization: "Bearer nope" }],
      ["/v1/catalog", { Authorization: `Basic ${token}` }],
      ["/v1/does-not-exist", {}],
    ]) {
      const res = await fetch(`${server.url}${p}`, { headers });
      assert.equal(res.status, 401, p);
      assert.deepEqual(await res.json(), { error: "unauthorized" });
      assert.match(res.headers.get("www-authenticate") ?? "", /^Bearer/);
    }
  });

  it("serves a sanitized catalog with a valid token", async () => {
    const res = await fetch(`${server.url}/v1/catalog`, {
      headers: { Authorization: `Bearer ${token}` },
    });
    assert.equal(res.status, 200);
    assert.equal(res.headers.get("cache-control"), "no-store");
    const text = await res.text();
    const catalog = JSON.parse(text);

    assert.equal(catalog.hosts.length, 1);
    assert.equal(catalog.hosts[0].label, "desk");
    const names = catalog.hosts[0].models.map((m) => m.name).sort();
    assert.deepEqual(names, ["fake:1b", "qwen3:0.6b"]);
    const fake = catalog.hosts[0].models.find((m) => m.name === "fake:1b");
    assert.deepEqual(fake.capabilities, ["completion", "tools"]);
    assert.equal(fake.tuned, false);
    assert.deepEqual(catalog.aliases, [{ name: "desk", host: "desk", model: "fake:1b" }]);
    assert.ok(catalog.scanned_at);

    // No hostnames, IPs, ports, OS, endpoints, or paths anywhere.
    assert.doesNotMatch(text, /127\.0\.0\.1|localhost|mockhost/);
    assert.doesNotMatch(text, new RegExp(`\\b${mock.port}\\b`));
    assert.doesNotMatch(text, /https?:\/\//);
    assert.ok(!text.includes(sandbox.dir), "no file paths");
    assert.doesNotMatch(text, /\b\d{1,3}(\.\d{1,3}){3}\b/, "no IPv4 addresses");
    const keys = allKeys(catalog);
    for (const banned of ["ip", "hostname", "dnsName", "endpoint", "port", "os", "also", "source", "self", "failures"]) {
      assert.ok(!keys.has(banned), `catalog must not contain "${banned}"`);
    }
  });

  it("returns 404 for unknown /v1 paths and 405 for non-GET, after auth", async () => {
    const auth = { Authorization: `Bearer ${token}` };
    assert.equal((await fetch(`${server.url}/v1/prompt`, { headers: auth })).status, 404);
    assert.equal((await fetch(`${server.url}/v1/catalog`, { method: "POST", headers: auth })).status, 405);
    assert.equal((await fetch(`${server.url}/api/tags`)).status, 404);
  });

  it("logs token name, path, and status (never the token)", async () => {
    await fetch(`${server.url}/v1/catalog`, { headers: { Authorization: `Bearer ${token}` } });
    await new Promise((r) => setTimeout(r, 100));
    assert.match(server.stderr(), / tester GET \/v1\/catalog 200/);
    assert.match(server.stderr(), / - GET \/v1\/catalog 401/);
    assert.ok(!server.stderr().includes(token));
  });

  it("rejects an expired token", async () => {
    const short = await addToken(sandbox, "short", ["--expires", "1ms"]);
    await new Promise((r) => setTimeout(r, 20));
    const res = await fetch(`${server.url}/v1/catalog`, { headers: { Authorization: `Bearer ${short}` } });
    assert.equal(res.status, 401);
  });

  it("rate-limits per token", async () => {
    const limited = await startServe(sandbox, ["--rate", "2"]);
    try {
      const auth = { Authorization: `Bearer ${token}` };
      const statuses = [];
      for (let i = 0; i < 3; i += 1) {
        statuses.push((await fetch(`${limited.url}/v1/catalog`, { headers: auth })).status);
      }
      assert.deepEqual(statuses, [200, 200, 429]);
    } finally {
      await limited.stop();
    }
  });
});

describe("ollanet serve token", () => {
  let sandbox;
  before(async () => {
    sandbox = await makeSandbox();
  });
  after(async () => sandbox.cleanup());

  it("prints the token once and stores only its SHA-256 hash", async () => {
    const token = await addToken(sandbox, "agent-1");
    assert.match(token, /^olns_[A-Za-z0-9_-]{43}$/);
    const raw = await readFile(path.join(sandbox.dir, "serve.json"), "utf8");
    assert.ok(!raw.includes(token), "plain token must not be stored");
    const { createHash } = await import("node:crypto");
    assert.ok(raw.includes(createHash("sha256").update(token).digest("hex")));

    const list = await runCli(["serve", "token", "list"], { sandbox, env: env(sandbox) });
    assert.equal(list.code, 0, list.stderr);
    assert.match(list.stdout, /agent-1/);
    assert.ok(!list.stdout.includes(token));
  });

  it("refuses a duplicate name", async () => {
    const res = await runCli(["serve", "token", "add", "agent-1"], { sandbox, env: env(sandbox) });
    assert.equal(res.code, 1);
    assert.match(res.stderr, /already exists/);
  });

  it("removes a token", async () => {
    const rm = await runCli(["serve", "token", "rm", "agent-1"], { sandbox, env: env(sandbox) });
    assert.equal(rm.code, 0, rm.stderr);
    const list = await runCli(["serve", "token", "list", "--json"], { sandbox, env: env(sandbox) });
    assert.deepEqual(JSON.parse(list.stdout), []);
    const again = await runCli(["serve", "token", "rm", "agent-1"], { sandbox, env: env(sandbox) });
    assert.equal(again.code, 1);
  });
});

describe("ollanet serve bind", () => {
  it("refuses a non-loopback bind without --allow-remote", async () => {
    const sandbox = await makeSandbox();
    try {
      const res = await runCli(["serve", "--listen", "0.0.0.0:0", "--refresh", "off"], {
        sandbox,
        env: env(sandbox),
      });
      assert.equal(res.code, 1);
      assert.match(res.stderr, /Refusing to listen on 0\.0\.0\.0/);
      assert.match(res.stderr, /--allow-remote/);
    } finally {
      await sandbox.cleanup();
    }
  });
});
