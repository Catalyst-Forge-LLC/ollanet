/**
 * `ollanet serve --funnel`: Tailscale preflight, enable-link flow, and teardown.
 * The tailscale CLI is always mocked (injected exec or OLLANET_TAILSCALE_BIN).
 */
import assert from "node:assert/strict";
import { spawn } from "node:child_process";
import { readFile } from "node:fs/promises";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { after, before, describe, it } from "node:test";

import { FunnelError, preflight, startFunnel } from "../dist/funnel.js";
import { CLI, makeSandbox, runCli } from "./helpers.mjs";

const FAKE = path.join(path.dirname(fileURLToPath(import.meta.url)), "fixtures", "fake-tailscale.mjs");

function status({ running = true, dns = "box.example.ts.net.", certs = ["box.example.ts.net"], caps = { funnel: null } } = {}) {
  return JSON.stringify({
    BackendState: running ? "Running" : "Stopped",
    Self: { DNSName: dns, CapMap: caps },
    CertDomains: certs,
  });
}

/** Fake exec: answers by first args; records every call. */
function fakeExec(handlers) {
  const calls = [];
  const exec = async (args, opts) => {
    calls.push({ args, opts });
    const key = args.join(" ");
    const h = Object.entries(handlers).find(([prefix]) => key.startsWith(prefix))?.[1];
    const r = typeof h === "function" ? h(args) : h;
    return { code: 0, stdout: "", stderr: "", timedOut: false, missing: false, ...(r ?? {}) };
  };
  const syncCalls = [];
  const execSync = (args) => {
    syncCalls.push(args);
    return { code: 0, stdout: "", stderr: "", timedOut: false, missing: false };
  };
  return { exec, execSync, calls, syncCalls };
}

describe("funnel preflight", () => {
  it("reports a missing tailscale CLI", async () => {
    const { exec } = fakeExec({ status: { code: null, missing: true } });
    await assert.rejects(preflight(exec), /tailscale CLI not found/);
  });

  it("requires a running backend", async () => {
    const { exec } = fakeExec({ status: { stdout: status({ running: false }) } });
    await assert.rejects(preflight(exec), /not running .*tailscale up/);
  });

  it("points at the admin DNS page when HTTPS certificates are off", async () => {
    for (const certs of [null, []]) {
      const { exec } = fakeExec({ status: { stdout: status({ certs }) } });
      await assert.rejects(preflight(exec), (err) => {
        assert.ok(err instanceof FunnelError);
        assert.match(err.message, /HTTPS Certificates/);
        assert.match(err.message, /https:\/\/login\.tailscale\.com\/admin\/dns/);
        return true;
      });
    }
  });

  it("reads the DNS name and the funnel capability", async () => {
    const yes = fakeExec({ status: { stdout: status() } });
    assert.deepEqual(await preflight(yes.exec), { dnsName: "box.example.ts.net", funnelAllowed: true });
    const ports = fakeExec({
      status: { stdout: status({ caps: { "https://tailscale.com/cap/funnel-ports?ports=443,8443": null } }) },
    });
    assert.equal((await preflight(ports.exec)).funnelAllowed, true);
    const no = fakeExec({ status: { stdout: status({ caps: { https: null } }) } });
    assert.equal((await preflight(no.exec)).funnelAllowed, false);
  });
});

describe("startFunnel", () => {
  const base = { localPort: 11500, target: "http://127.0.0.1:11500", funnelPort: 443 };

  it("turns the funnel on, then off only for its own port", async () => {
    const f = fakeExec({
      status: { stdout: status() },
      "funnel status": { stdout: "{}" },
      "funnel --bg": { stdout: "Available on the internet:\nhttps://box.example.ts.net/\n" },
    });
    const handle = await startFunnel({ ...base, exec: f.exec, execSync: f.execSync });
    assert.equal(handle.publicUrl, "https://box.example.ts.net/");
    assert.equal(handle.added, true);
    assert.deepEqual(f.calls.at(-1).args, ["funnel", "--bg", "--https=443", "http://127.0.0.1:11500"]);
    assert.ok(f.calls.at(-1).opts.timeoutMs > 0);
    handle.stop();
    handle.stop();
    assert.deepEqual(f.syncCalls, [["funnel", "--https=443", "off"]]);
    assert.ok(!f.calls.some((c) => c.args.includes("reset")), "never resets other serve config");
  });

  it("uses the port in the URL for 8443", async () => {
    const f = fakeExec({ status: { stdout: status() }, "funnel status": { stdout: "{}" } });
    const handle = await startFunnel({ ...base, funnelPort: 8443, exec: f.exec, execSync: f.execSync });
    assert.equal(handle.publicUrl, "https://box.example.ts.net:8443/");
    assert.deepEqual(f.calls.at(-1).args, ["funnel", "--bg", "--https=8443", "http://127.0.0.1:11500"]);
  });

  it("rejects ports Funnel does not allow", async () => {
    const f = fakeExec({});
    await assert.rejects(startFunnel({ ...base, funnelPort: 8080, exec: f.exec }), /443, 8443, 10000/);
    assert.equal(f.calls.length, 0);
  });

  it("surfaces the enable link when Funnel is not approved", async () => {
    const f = fakeExec({
      status: { stdout: status({ caps: { https: null } }) },
      "funnel status": { stdout: "{}" },
      "funnel --bg": {
        code: null,
        stdout: "Funnel is not enabled on your tailnet.\nTo enable, visit:\n\n   https://login.tailscale.com/f/funnel?node=abc123\n",
      },
    });
    await assert.rejects(startFunnel({ ...base, exec: f.exec, execSync: f.execSync }), (err) => {
      assert.ok(err instanceof FunnelError);
      assert.equal(err.enableUrl, "https://login.tailscale.com/f/funnel?node=abc123");
      assert.match(err.message, /not enabled/);
      return true;
    });
    const on = f.calls.at(-1);
    assert.ok(on.opts.until instanceof RegExp, "stops early once the link is printed");
    assert.equal(f.syncCalls.length, 0);
  });

  it("leaves an identical existing funnel alone", async () => {
    const web = { Web: { "box.example.ts.net:443": { Handlers: { "/": { Proxy: "http://127.0.0.1:11500" } } } } };
    const f = fakeExec({ status: { stdout: status() }, "funnel status": { stdout: JSON.stringify(web) } });
    const handle = await startFunnel({ ...base, exec: f.exec, execSync: f.execSync });
    assert.equal(handle.added, false);
    assert.ok(!f.calls.some((c) => c.args.includes("--bg")));
    handle.stop();
    assert.equal(f.syncCalls.length, 0);
  });

  it("refuses to replace someone else's handler on that port", async () => {
    const web = { Web: { "box.example.ts.net:443": { Handlers: { "/": { Proxy: "http://127.0.0.1:3000" } } } } };
    const f = fakeExec({ status: { stdout: status() }, "funnel status": { stdout: JSON.stringify(web) } });
    await assert.rejects(startFunnel({ ...base, exec: f.exec, execSync: f.execSync }), /already serves http:\/\/127\.0\.0\.1:3000/);
    assert.ok(!f.calls.some((c) => c.args.includes("--bg")));
  });
});

describe("ollanet serve --funnel (CLI, fake tailscale)", () => {
  let sandbox;
  let logFile;

  function env(extra = {}) {
    return {
      OLLANET_SERVE_FILE: path.join(sandbox.dir, "serve.json"),
      OLLANET_TAILSCALE_BIN: FAKE,
      FAKE_TS_LOG: logFile,
      ...extra,
    };
  }
  const calls = async () => (await readFile(logFile, "utf8").catch(() => "")).trim().split("\n").filter(Boolean);

  before(async () => {
    sandbox = await makeSandbox({ discovery: { localhost: false, tailscale: false, lan: false } });
    logFile = path.join(sandbox.dir, "ts.log");
  });
  after(async () => sandbox.cleanup());

  it("refuses --funnel when no tokens exist, before calling tailscale", async () => {
    const res = await runCli(["serve", "--funnel", "--listen", "127.0.0.1:0", "--refresh", "off"], {
      sandbox,
      env: env(),
    });
    assert.equal(res.code, 1);
    assert.match(res.stderr, /no active serve tokens/);
    assert.match(res.stderr, /ollanet serve token add <name>/);
    assert.deepEqual(await calls(), []);
  });

  it("prints the enable link and exits non-zero instead of hanging", async () => {
    const add = await runCli(["serve", "token", "add", "t1"], { sandbox, env: env() });
    assert.equal(add.code, 0, add.stderr);
    const started = Date.now();
    const res = await runCli(["serve", "--funnel", "--listen", "127.0.0.1:0", "--refresh", "off"], {
      sandbox,
      env: env({ FAKE_TS_MODE: "noenable" }),
    });
    assert.equal(res.code, 1, res.stderr);
    assert.match(res.stderr, /https:\/\/login\.tailscale\.com\/f\/funnel\?node=fakeNode123/);
    assert.ok(Date.now() - started < 20_000);
  });

  it("explains how to turn on HTTPS certificates", async () => {
    const res = await runCli(["serve", "--funnel", "--listen", "127.0.0.1:0", "--refresh", "off"], {
      sandbox,
      env: env({ FAKE_TS_MODE: "nocerts" }),
    });
    assert.equal(res.code, 1);
    assert.match(res.stderr, /HTTPS Certificates.*admin\/dns/);
  });

  it("publishes, reports status, and turns the funnel off on exit", async () => {
    const child = spawn(
      process.execPath,
      [CLI, "serve", "--funnel", "--listen", "127.0.0.1:0", "--refresh", "off"],
      {
        env: {
          ...process.env,
          OLLANET_CONFIG: sandbox.configFile,
          OLLANET_LAST_SCAN: sandbox.lastScanFile,
          OLLANET_QUIET: "",
          ...env(),
        },
        stdio: ["ignore", "pipe", "pipe"],
      },
    );
    let stdout = "";
    let stderr = "";
    child.stderr.on("data", (d) => (stderr += d));
    await new Promise((resolve, reject) => {
      const timer = setTimeout(() => reject(new Error(`no Funnel URL:\n${stdout}\n${stderr}`)), 15_000);
      child.stdout.on("data", (d) => {
        stdout += d;
        if (/Catalog: /.test(stdout)) {
          clearTimeout(timer);
          resolve();
        }
      });
    });
    assert.match(stdout, /Funnel:  https:\/\/box\.example\.ts\.net\/\n/);
    assert.match(stdout, /Catalog: https:\/\/box\.example\.ts\.net\/v1\/catalog/);

    const st = await runCli(["serve", "status", "--json"], { sandbox, env: env() });
    const state = JSON.parse(st.stdout);
    assert.equal(state.running, true);
    assert.equal(state.funnel_url, "https://box.example.ts.net/");

    const exited = new Promise((resolve) => child.once("exit", resolve));
    child.kill("SIGTERM");
    await exited;
    // Windows cannot deliver SIGTERM to a handler (kill is a hard stop).
    if (process.platform !== "win32") {
      assert.ok((await calls()).includes("funnel --https=443 off"), (await calls()).join("\n"));
      const after = await runCli(["serve", "status"], { sandbox, env: env() });
      assert.match(after.stdout, /not running/);
    }
    assert.ok(!(await calls()).some((c) => c.includes("reset")));
  });
});
