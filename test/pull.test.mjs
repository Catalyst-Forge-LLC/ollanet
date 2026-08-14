import assert from "node:assert/strict";
import { after, before, describe, it } from "node:test";

import { makeSandbox, runCli, startMock } from "./helpers.mjs";

function mockConfig(port) {
  return {
    discovery: { localhost: false, tailscale: false, lan: false },
    hosts: [{ name: "mockhost", host: "127.0.0.1", port }],
  };
}

describe("ollanet pull", () => {
  let mock;
  let sandbox;

  before(async () => {
    mock = await startMock();
    sandbox = await makeSandbox(mockConfig(mock.port));
  });
  after(async () => {
    await mock.close();
    await sandbox.cleanup();
  });

  it("POSTs /api/pull with the model on the named machine", async () => {
    mock.requests.length = 0;
    const res = await runCli(["pull", "mockhost", "gemma3:12b"], { sandbox });

    assert.equal(res.code, 0, res.stderr);
    assert.match(res.stdout, /pulled gemma3:12b on mockhost/);
    assert.match(res.stderr, /pulling gemma3:12b/);
    const body = mock.pulls()[0];
    assert.equal(body.model, "gemma3:12b");
    assert.equal(body.stream, true);
    assert.equal(body.insecure, undefined);
  });

  it("emits JSON with --json", async () => {
    mock.requests.length = 0;
    const res = await runCli(["pull", "mockhost", "llama3.2:1b", "--json"], { sandbox });

    assert.equal(res.code, 0, res.stderr);
    const payload = JSON.parse(res.stdout);
    assert.equal(payload.machine, "mockhost");
    assert.equal(payload.model, "llama3.2:1b");
    assert.equal(payload.status, "success");
    assert.match(payload.endpoint, /^http:\/\/127\.0\.0\.1:/);
  });

  it("sends stream:false with --no-stream", async () => {
    mock.requests.length = 0;
    const res = await runCli(["pull", "mockhost", "llama3.2:1b", "--no-stream"], { sandbox });

    assert.equal(res.code, 0, res.stderr);
    assert.equal(mock.pulls()[0].stream, false);
  });

  it("sends insecure:true with --insecure", async () => {
    mock.requests.length = 0;
    const res = await runCli(["pull", "--machine", "mockhost", "--model", "nomic-embed-text", "--insecure"], {
      sandbox,
    });

    assert.equal(res.code, 0, res.stderr);
    assert.equal(mock.pulls()[0].insecure, true);
    assert.equal(mock.pulls()[0].model, "nomic-embed-text");
  });

  it("errors when the model is missing", async () => {
    const res = await runCli(["pull", "mockhost"], { sandbox });

    assert.notEqual(res.code, 0);
    assert.match(res.stderr, /Model is required/);
  });

  it("errors on an unknown machine", async () => {
    const res = await runCli(["pull", "no-such-box", "gemma3:12b"], { sandbox });

    assert.notEqual(res.code, 0);
    assert.match(res.stderr, /Unknown machine/);
  });
});

describe("ollanet pull errors", () => {
  it("surfaces an Ollama pull error", async () => {
    const mock = await startMock({ pullError: "file does not exist" });
    const sandbox = await makeSandbox(mockConfig(mock.port));
    try {
      const res = await runCli(["pull", "mockhost", "missing:7b"], { sandbox });
      assert.notEqual(res.code, 0);
      assert.match(res.stderr, /file does not exist/);
    } finally {
      await mock.close();
      await sandbox.cleanup();
    }
  });
});
