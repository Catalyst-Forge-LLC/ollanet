/**
 * Alias CRUD + expansion on prompt / pull / show.
 */
import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import path from "node:path";
import { after, before, describe, it } from "node:test";

import { makeSandbox, runCli, startMock } from "./helpers.mjs";

function mockConfig(port, extra = {}) {
  return {
    hosts: [{ name: "mockhost", host: "127.0.0.1", port }],
    defaultModels: { mockhost: "fake:1b" },
    ...extra,
  };
}

describe("alias command", () => {
  let mock;
  let sandbox;

  before(async () => {
    mock = await startMock({ models: ["fake:1b", "qwen3:0.6b"] });
    sandbox = await makeSandbox(mockConfig(mock.port));
  });
  after(async () => {
    await mock.close();
    await sandbox.cleanup();
  });

  it("adds, lists, and removes aliases in config", async () => {
    let res = await runCli(["alias", "add", "desk", "mockhost", "qwen3:0.6b"], { sandbox });
    assert.equal(res.code, 0);
    assert.match(res.stdout, /Alias "desk"/);

    const cfg = JSON.parse(await readFile(path.join(sandbox.dir, "config.json"), "utf8"));
    assert.deepEqual(cfg.aliases.desk, { machine: "mockhost", model: "qwen3:0.6b" });

    res = await runCli(["alias", "list", "--json"], { sandbox });
    assert.equal(res.code, 0);
    const listed = JSON.parse(res.stdout);
    assert.deepEqual(listed.desk, { machine: "mockhost", model: "qwen3:0.6b" });

    res = await runCli(["alias", "rm", "desk"], { sandbox });
    assert.equal(res.code, 0);

    const afterRm = JSON.parse(await readFile(path.join(sandbox.dir, "config.json"), "utf8"));
    assert.equal(afterRm.aliases.desk, undefined);
  });

  it("rejects invalid alias names", async () => {
    const res = await runCli(["alias", "add", "1bad", "mockhost", "fake:1b"], { sandbox });
    assert.notEqual(res.code, 0);
    assert.match(res.stderr, /Invalid alias name/);
  });
});

describe("alias expansion", () => {
  let mock;
  let sandbox;

  before(async () => {
    mock = await startMock({ models: ["fake:1b", "qwen3:0.6b"] });
    sandbox = await makeSandbox(
      mockConfig(mock.port, {
        aliases: { desk: { machine: "mockhost", model: "qwen3:0.6b" } },
      }),
    );
  });
  after(async () => {
    await mock.close();
    await sandbox.cleanup();
  });

  it("prompt uses alias machine + model", async () => {
    mock.requests.length = 0;
    const res = await runCli(["prompt", "desk", "hello from alias"], { sandbox });
    assert.equal(res.code, 0);
    const chat = mock.chats()[0];
    assert.equal(chat.model, "qwen3:0.6b");
    assert.equal(chat.messages.at(-1).content, "hello from alias");
  });

  it("prompt allows model override on an alias", async () => {
    mock.requests.length = 0;
    const res = await runCli(["prompt", "desk", "fake:1b", "override me"], { sandbox });
    assert.equal(res.code, 0);
    assert.equal(mock.chats()[0].model, "fake:1b");
    assert.equal(mock.chats()[0].messages.at(-1).content, "override me");
  });

  it("show expands a bare alias", async () => {
    const res = await runCli(["show", "desk", "--json"], { sandbox });
    assert.equal(res.code, 0);
    const body = JSON.parse(res.stdout);
    assert.equal(body.model, "qwen3:0.6b");
    assert.equal(body.machine, "mockhost");
  });
});
