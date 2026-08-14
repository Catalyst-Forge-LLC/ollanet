import assert from "node:assert/strict";
import { readFile, writeFile } from "node:fs/promises";
import path from "node:path";
import { after, before, describe, it } from "node:test";

import { makeSandbox, runCli, startMock } from "./helpers.mjs";

function mockConfig(port) {
  return {
    discovery: { localhost: false, tailscale: false, lan: false },
    hosts: [{ name: "mockhost", host: "127.0.0.1", port }],
    defaultModels: { mockhost: "fake:1b" },
  };
}

describe("ollanet compare", () => {
  let mock;
  let sandbox;

  before(async () => {
    mock = await startMock({ models: ["fake:1b", "qwen3:0.6b"], reply: "compare-ok" });
    sandbox = await makeSandbox(mockConfig(mock.port));
  });
  after(async () => {
    await mock.close();
    await sandbox.cleanup();
  });

  it("runs the same prompt on two models and writes md+json", async () => {
    mock.requests.length = 0;
    const res = await runCli(
      ["compare", "mockhost", "fake:1b", "qwen3:0.6b", "--prompt", "Explain MagicDNS"],
      { sandbox },
    );

    assert.equal(res.code, 0, res.stderr);
    assert.match(res.stderr, /fake:1b/);
    assert.match(res.stderr, /qwen3:0.6b/);
    assert.match(res.stderr, /saved /);
    const chats = mock.chats();
    assert.equal(chats.length, 2);
    assert.equal(chats[0].model, "fake:1b");
    assert.equal(chats[1].model, "qwen3:0.6b");
    assert.equal(chats[0].messages.at(-1).content, "Explain MagicDNS");
    assert.equal(chats[1].messages.at(-1).content, "Explain MagicDNS");

    const idMatch = res.stderr.match(/([a-f0-9]{12})\.md/);
    assert.ok(idMatch, res.stderr);
    const id = idMatch[1];
    const md = await readFile(path.join(sandbox.comparesDir, `${id}.md`), "utf8");
    const json = JSON.parse(await readFile(path.join(sandbox.comparesDir, `${id}.json`), "utf8"));
    assert.match(md, /Explain MagicDNS/);
    assert.match(md, /compare-ok/);
    assert.equal(json.results.length, 2);
    assert.equal(json.prompt, "Explain MagicDNS");
  });

  it("accepts a .md prompt file", async () => {
    const file = path.join(sandbox.dir, "task.md");
    await writeFile(file, "# Task\n\nWrite a haiku.\n");
    mock.requests.length = 0;
    const res = await runCli(
      ["compare", "mockhost", "fake:1b", "qwen3:0.6b", "--file", file, "--json", "--no-save"],
      { sandbox },
    );
    assert.equal(res.code, 0, res.stderr);
    const payload = JSON.parse(res.stdout);
    assert.match(payload.prompt, /Write a haiku/);
    assert.equal(payload.results.length, 2);
    assert.equal(payload.files, undefined);
  });

  it("rejects a single model", async () => {
    const res = await runCli(["compare", "mockhost", "fake:1b", "--prompt", "hi"], { sandbox });
    assert.notEqual(res.code, 0);
    assert.match(res.stderr, /2–5 models/);
  });

  it("rejects a non txt/md file", async () => {
    const file = path.join(sandbox.dir, "task.json");
    await writeFile(file, '{"no":true}');
    const res = await runCli(
      ["compare", "mockhost", "fake:1b", "qwen3:0.6b", "--file", file],
      { sandbox },
    );
    assert.notEqual(res.code, 0);
    assert.match(res.stderr, /\.txt or \.md/);
  });
});

describe("prompt --file", () => {
  it("sends .md file contents as the prompt", async () => {
    const mock = await startMock({ models: ["fake:1b"] });
    const sandbox = await makeSandbox(mockConfig(mock.port));
    const file = path.join(sandbox.dir, "notes.md");
    await writeFile(file, "from the markdown file");
    try {
      mock.requests.length = 0;
      const res = await runCli(["prompt", "mockhost", "--file", file, "--no-save"], { sandbox });
      assert.equal(res.code, 0, res.stderr);
      assert.equal(mock.chats()[0].messages.at(-1).content, "from the markdown file");
    } finally {
      await mock.close();
      await sandbox.cleanup();
    }
  });

  it("joins argv and --file with a blank line", async () => {
    const mock = await startMock({ models: ["fake:1b"] });
    const sandbox = await makeSandbox(mockConfig(mock.port));
    const file = path.join(sandbox.dir, "body.txt");
    await writeFile(file, "FILE BODY");
    try {
      const res = await runCli(["prompt", "mockhost", "summarize", "--file", file, "--no-save"], {
        sandbox,
      });
      assert.equal(res.code, 0, res.stderr);
      assert.equal(mock.chats()[0].messages.at(-1).content, "summarize\n\nFILE BODY");
    } finally {
      await mock.close();
      await sandbox.cleanup();
    }
  });

  it("rejects .json as a prompt file", async () => {
    const mock = await startMock({ models: ["fake:1b"] });
    const sandbox = await makeSandbox(mockConfig(mock.port));
    const file = path.join(sandbox.dir, "nope.json");
    await writeFile(file, "{}");
    try {
      const res = await runCli(["prompt", "mockhost", "--file", file], { sandbox });
      assert.notEqual(res.code, 0);
      assert.match(res.stderr, /\.txt or \.md/);
    } finally {
      await mock.close();
      await sandbox.cleanup();
    }
  });
});
