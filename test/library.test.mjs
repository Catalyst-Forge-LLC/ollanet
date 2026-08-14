/**
 * Library entry: package exports, import-time safety, and scanNetwork(config).
 * Runs against dist/ (npm test builds first).
 */
import assert from "node:assert/strict";
import { spawn } from "node:child_process";
import { readFile } from "node:fs/promises";
import path from "node:path";
import { describe, it } from "node:test";
import { fileURLToPath, pathToFileURL } from "node:url";

import { makeSandbox, startMock } from "./helpers.mjs";

const ROOT = path.join(path.dirname(fileURLToPath(import.meta.url)), "..");
const INDEX = pathToFileURL(path.join(ROOT, "dist", "index.js")).href;

function runNode(source, env = {}) {
  const child = spawn(process.execPath, ["--input-type=module", "-e", source], {
    cwd: ROOT,
    env: { ...process.env, ...env },
    stdio: ["ignore", "pipe", "pipe"],
  });
  let stdout = "";
  let stderr = "";
  child.stdout.on("data", (d) => (stdout += d));
  child.stderr.on("data", (d) => (stderr += d));
  return new Promise((resolve) => {
    const timer = setTimeout(() => child.kill("SIGKILL"), 20_000);
    child.on("close", (code) => {
      clearTimeout(timer);
      resolve({ code, stdout, stderr });
    });
  });
}

describe("package entry", () => {
  it("advertises exports + types for the root and ./scan", async () => {
    const pkg = JSON.parse(await readFile(path.join(ROOT, "package.json"), "utf8"));
    assert.deepEqual(pkg.exports["."], {
      types: "./dist/index.d.ts",
      import: "./dist/index.js",
    });
    assert.deepEqual(pkg.exports["./scan"], {
      types: "./dist/scan.d.ts",
      import: "./dist/scan.js",
    });
    assert.equal(pkg.types, "./dist/index.d.ts");
    assert.equal(pkg.bin.ollanet, "./dist/cli.js");
  });

  it("import { scanNetwork } from dist/index.js exposes the library API, not main()", async () => {
    const mod = await import(INDEX);
    assert.equal(typeof mod.scanNetwork, "function");
    assert.equal(typeof mod.discoverHosts, "function");
    assert.equal(typeof mod.runPrompt, "function");
    assert.equal(typeof mod.pullModel, "function");
    assert.equal(typeof mod.ollamaPull, "function");
    assert.equal(typeof mod.ollamaChat, "function");
    assert.equal(typeof mod.loadConfig, "function");
    assert.equal(mod.main, undefined);
  });

  it("emits declaration files for the public entry", async () => {
    const dts = await readFile(path.join(ROOT, "dist", "index.d.ts"), "utf8");
    assert.match(dts, /export \{ scanNetwork \}/);
    assert.match(dts, /from "\.\/scan\.js"/);
    assert.doesNotMatch(dts, /from "\.\/scan\.ts"/);
  });
});

describe("import-time safety", () => {
  it("importing ollanet does not throw on a bad OLLAMA_PORT", async () => {
    const res = await runNode(`await import(${JSON.stringify(INDEX)}); console.log("ok");`, {
      OLLAMA_PORT: "abc",
    });
    assert.equal(res.code, 0, res.stderr);
    assert.match(res.stdout, /ok/);
  });
});

describe("scanNetwork library contract", () => {
  it("uses an in-memory config and does not LAN-scan by default", async () => {
    const mock = await startMock({ models: ["fake:1b"] });
    const { scanNetwork } = await import(INDEX);
    try {
      const payload = await scanNetwork({
        lanScan: false,
        config: {
          hosts: [{ name: "studio", host: "127.0.0.1", port: mock.port }],
          discovery: { localhost: false, tailscale: false, lan: false },
        },
      });
      assert.equal(payload.servers.length, 1);
      assert.equal(payload.servers[0].hostname, "studio");
      assert.deepEqual(
        payload.servers[0].models.map((m) => m.name),
        ["fake:1b"],
      );
      assert.ok(!payload.sources.includes("lan"));
    } finally {
      await mock.close();
    }
  });

  it("skips the config file when config is passed", async () => {
    const mock = await startMock({ models: ["fake:1b"] });
    const sandbox = await makeSandbox({
      hosts: [{ name: "poison", host: "127.0.0.1", port: 1 }],
      discovery: { localhost: true, tailscale: false, lan: false },
    });
    const source = `
      import { scanNetwork } from ${JSON.stringify(INDEX)};
      const payload = await scanNetwork({
        lanScan: false,
        config: {
          hosts: [{ name: "studio", host: "127.0.0.1", port: ${mock.port} }],
          discovery: { localhost: false, tailscale: false, lan: false },
        },
      });
      console.log(JSON.stringify(payload.servers.map((s) => s.hostname)));
    `;
    try {
      const res = await runNode(source, { OLLANET_CONFIG: sandbox.configFile, OLLANET_HOSTS: "" });
      assert.equal(res.code, 0, res.stderr);
      assert.deepEqual(JSON.parse(res.stdout.trim()), ["studio"]);
    } finally {
      await mock.close();
      await sandbox.cleanup();
    }
  });
});

describe("runPrompt library options", () => {
  it("save: false does not write a transcript", async () => {
    const mock = await startMock();
    const sandbox = await makeSandbox();
    const source = `
      import { runPrompt } from ${JSON.stringify(INDEX)};
      import { readdir } from "node:fs/promises";
      const result = await runPrompt({
        machine: "127.0.0.1:${mock.port}",
        model: "fake:1b",
        prompt: "hi",
        save: false,
        writeStdout: false,
        quiet: true,
        config: {
          hosts: [{ name: "studio", host: "127.0.0.1", port: ${mock.port} }],
          discovery: { localhost: false, tailscale: false, lan: false },
        },
      });
      const files = await readdir(${JSON.stringify(sandbox.responsesDir)}).catch(() => []);
      console.log(JSON.stringify({ chat_id: result.chat_id, files }));
    `;
    try {
      const res = await runNode(source, {
        OLLANET_CONFIG: sandbox.configFile,
        OLLANET_RESPONSES_DIR: sandbox.responsesDir,
        OLLANET_HOSTS: "",
      });
      assert.equal(res.code, 0, res.stderr);
      const body = JSON.parse(res.stdout.trim());
      assert.equal(body.chat_id, null);
      assert.deepEqual(body.files, []);
    } finally {
      await mock.close();
      await sandbox.cleanup();
    }
  });
});

describe("pullModel library contract", () => {
  it("pulls onto a host from in-memory config", async () => {
    const mock = await startMock();
    const { pullModel } = await import(INDEX);
    try {
      const result = await pullModel({
        machine: "studio",
        model: "gemma3:12b",
        writeStdout: false,
        quiet: true,
        config: {
          hosts: [{ name: "studio", host: "127.0.0.1", port: mock.port }],
          discovery: { localhost: false, tailscale: false, lan: false },
        },
      });
      assert.equal(result.machine, "studio");
      assert.equal(result.model, "gemma3:12b");
      assert.equal(result.status, "success");
      assert.equal(mock.pulls()[0].model, "gemma3:12b");
    } finally {
      await mock.close();
    }
  });
});
