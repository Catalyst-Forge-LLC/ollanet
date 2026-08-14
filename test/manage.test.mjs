import assert from "node:assert/strict";
import { after, before, describe, it } from "node:test";

import { makeSandbox, runCli, startMock } from "./helpers.mjs";

function mockConfig(port) {
  return {
    discovery: { localhost: false, tailscale: false, lan: false },
    hosts: [{ name: "mockhost", host: "127.0.0.1", port }],
  };
}

describe("ollanet show", () => {
  it("prints Modelfile and marks a tuned name", async () => {
    const mock = await startMock({
      show: {
        "gemma4-ctx32k": {
          modelfile: "# written by finetuna\nFROM gemma3:12b\nPARAMETER num_ctx 32768\n",
          parameters: "num_ctx 32768\nnum_gpu 99\n",
          details: { family: "gemma", parameter_size: "12B", quantization_level: "Q4_K_M" },
        },
      },
    });
    const sandbox = await makeSandbox(mockConfig(mock.port));
    try {
      const res = await runCli(["show", "mockhost", "gemma4-ctx32k"], { sandbox });
      assert.equal(res.code, 0, res.stderr);
      assert.match(res.stdout, /gemma4-ctx32k/);
      assert.match(res.stdout, /\[tuned\]/);
      assert.match(res.stdout, /num_ctx 32768/);
      assert.match(res.stdout, /FROM gemma3:12b/);
      assert.equal(mock.shows()[0].model, "gemma4-ctx32k");
    } finally {
      await mock.close();
      await sandbox.cleanup();
    }
  });

  it("emits JSON with --json", async () => {
    const mock = await startMock();
    const sandbox = await makeSandbox(mockConfig(mock.port));
    try {
      const res = await runCli(["show", "mockhost", "fake:1b", "--json"], { sandbox });
      assert.equal(res.code, 0, res.stderr);
      const payload = JSON.parse(res.stdout);
      assert.equal(payload.machine, "mockhost");
      assert.equal(payload.model, "fake:1b");
      assert.equal(payload.tuned, false);
      assert.ok(payload.capabilities.includes("completion"));
    } finally {
      await mock.close();
      await sandbox.cleanup();
    }
  });
});

describe("ollanet rm", () => {
  it("refuses to delete without --yes when stdin is not a TTY", async () => {
    const mock = await startMock();
    const sandbox = await makeSandbox(mockConfig(mock.port));
    try {
      const res = await runCli(["rm", "mockhost", "fake:1b"], { sandbox });
      assert.notEqual(res.code, 0);
      assert.match(res.stderr, /without --yes/);
      assert.equal(mock.deletes().length, 0);
    } finally {
      await mock.close();
      await sandbox.cleanup();
    }
  });

  it("POSTs /api/delete with --yes", async () => {
    const mock = await startMock();
    const sandbox = await makeSandbox(mockConfig(mock.port));
    try {
      const res = await runCli(["rm", "mockhost", "fake:1b", "--yes"], { sandbox });
      assert.equal(res.code, 0, res.stderr);
      assert.match(res.stdout, /deleted fake:1b on mockhost/);
      assert.equal(mock.deletes()[0].model, "fake:1b");
    } finally {
      await mock.close();
      await sandbox.cleanup();
    }
  });

  it("surfaces an Ollama delete error", async () => {
    const mock = await startMock({ deleteError: "model not found" });
    const sandbox = await makeSandbox(mockConfig(mock.port));
    try {
      const res = await runCli(["rm", "mockhost", "missing:7b", "--yes"], { sandbox });
      assert.notEqual(res.code, 0);
      assert.match(res.stderr, /model not found/);
    } finally {
      await mock.close();
      await sandbox.cleanup();
    }
  });
});

describe("ollanet ps", () => {
  it("lists models loaded in VRAM on a named host", async () => {
    const mock = await startMock({ loaded: ["gemma4-ctx32k", "fake:1b"] });
    const sandbox = await makeSandbox(mockConfig(mock.port));
    try {
      const res = await runCli(["ps", "mockhost"], { sandbox });
      assert.equal(res.code, 0, res.stderr);
      assert.match(res.stdout, /gemma4-ctx32k/);
      assert.match(res.stdout, /\[tuned\]/);
      assert.match(res.stdout, /fake:1b/);
      assert.match(res.stdout, /VRAM/);
      assert.match(res.stdout, /100% GPU/);
    } finally {
      await mock.close();
      await sandbox.cleanup();
    }
  });

  it("emits JSON with --json", async () => {
    const mock = await startMock({ loaded: ["fake:1b"] });
    const sandbox = await makeSandbox(mockConfig(mock.port));
    try {
      const res = await runCli(["ps", "mockhost", "--json"], { sandbox });
      assert.equal(res.code, 0, res.stderr);
      const payload = JSON.parse(res.stdout);
      assert.equal(payload.hosts.length, 1);
      assert.equal(payload.hosts[0].machine, "mockhost");
      assert.equal(payload.hosts[0].models[0].name, "fake:1b");
      assert.equal(payload.hosts[0].models[0].tuned, false);
      assert.equal(payload.hosts[0].models[0].gpu_percent, 100);
      assert.equal(payload.hosts[0].models[0].cpu_percent, 0);
      assert.equal(payload.hosts[0].models[0].processor, "100% GPU");
    } finally {
      await mock.close();
      await sandbox.cleanup();
    }
  });

  it("shows a CPU/GPU split when size_vram is less than size", async () => {
    const mock = await startMock({
      loaded: ["fake:1b"],
      psSize: 200,
      psVram: 50,
    });
    const sandbox = await makeSandbox(mockConfig(mock.port));
    try {
      const res = await runCli(["ps", "mockhost"], { sandbox });
      assert.equal(res.code, 0, res.stderr);
      assert.match(res.stdout, /75%\/25% CPU\/GPU/);
    } finally {
      await mock.close();
      await sandbox.cleanup();
    }
  });
});

describe("scan tuned marker", () => {
  it("marks Finetuna-style names in scan --json", async () => {
    const mock = await startMock({ models: ["fake:1b", "gemma4-ctx32k"] });
    const sandbox = await makeSandbox(mockConfig(mock.port));
    try {
      const res = await runCli(["scan", "--json"], { sandbox });
      assert.equal(res.code, 0, res.stderr);
      const payload = JSON.parse(res.stdout);
      const names = Object.fromEntries(
        payload.servers[0].models.map((m) => [m.name, m.tuned]),
      );
      assert.equal(names["fake:1b"], false);
      assert.equal(names["gemma4-ctx32k"], true);
    } finally {
      await mock.close();
      await sandbox.cleanup();
    }
  });
});
