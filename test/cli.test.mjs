/**
 * End-to-end tests: spawn the real CLI against a mock Ollama server and assert
 * on both the printed output and the exact request bodies sent over the wire.
 *
 * Tests tagged "Regression:" each correspond to a bug that actually shipped.
 */
import assert from "node:assert/strict";
import { readFile, readdir } from "node:fs/promises";
import path from "node:path";
import { after, before, describe, it } from "node:test";

import { makeSandbox, runCli, startMock } from "./helpers.mjs";

/** Config naming the mock server "mockhost" with a default model. */
function mockConfig(port, extra = {}) {
  return {
    hosts: [{ name: "mockhost", host: "127.0.0.1", port }],
    defaultModels: { mockhost: "fake:1b" },
    ...extra,
  };
}

describe("prompt assembly", () => {
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

  // Regression: args were joined with "\n\n", so every word became its own paragraph.
  it("joins unquoted prompt words with single spaces", async () => {
    mock.requests.length = 0;
    await runCli(["prompt", "mockhost", "write", "a", "haiku", "about", "ferrets"], { sandbox });

    assert.equal(mock.chats()[0].messages.at(-1).content, "write a haiku about ferrets");
  });

  it("keeps a quoted prompt intact", async () => {
    mock.requests.length = 0;
    await runCli(["prompt", "mockhost", "write a haiku about ferrets"], { sandbox });

    assert.equal(mock.chats()[0].messages.at(-1).content, "write a haiku about ferrets");
  });

  it("joins argv and stdin with a blank line", async () => {
    mock.requests.length = 0;
    await runCli(["prompt", "mockhost", "summarize", "this"], { sandbox, stdin: "PIPED BODY" });

    assert.equal(mock.chats()[0].messages.at(-1).content, "summarize this\n\nPIPED BODY");
  });

  it("accepts a stdin-only prompt", async () => {
    mock.requests.length = 0;
    await runCli(["prompt", "mockhost"], { sandbox, stdin: "just stdin" });

    assert.equal(mock.chats()[0].messages.at(-1).content, "just stdin");
  });

  it("errors when no prompt is supplied at all", async () => {
    const res = await runCli(["prompt", "mockhost"], { sandbox });

    assert.notEqual(res.code, 0);
    assert.match(res.stderr, /No prompt provided/);
  });
});

describe("model token peeling", () => {
  let mock;
  let sandbox;

  before(async () => {
    mock = await startMock({ models: ["fake:1b"] });
    sandbox = await makeSandbox(mockConfig(mock.port));
  });
  after(async () => {
    await mock.close();
    await sandbox.cleanup();
  });

  it("peels a leading token that exists on the host", async () => {
    mock.requests.length = 0;
    await runCli(["prompt", "mockhost", "fake:1b", "hello"], { sandbox });

    const req = mock.chats()[0];
    assert.equal(req.model, "fake:1b");
    assert.equal(req.messages.at(-1).content, "hello");
  });

  // Regression: any first token containing ":" or "/" was swallowed as a model name.
  it("does not treat a prompt containing a colon as a model", async () => {
    mock.requests.length = 0;
    const res = await runCli(["prompt", "mockhost", "TODO: fix the parser"], { sandbox });

    assert.equal(res.code, 0);
    assert.equal(mock.chats()[0].messages.at(-1).content, "TODO: fix the parser");
  });

  it("does not treat a leading URL as a model", async () => {
    mock.requests.length = 0;
    const res = await runCli(["prompt", "mockhost", "https://example.com", "summarize", "it"], {
      sandbox,
    });

    assert.equal(res.code, 0);
    assert.equal(mock.chats()[0].messages.at(-1).content, "https://example.com summarize it");
  });

  it("keeps a model-shaped token the host does not actually have", async () => {
    mock.requests.length = 0;
    await runCli(["prompt", "mockhost", "ratio:3/4", "explain"], { sandbox });

    const req = mock.chats()[0];
    assert.equal(req.model, "fake:1b");
    assert.equal(req.messages.at(-1).content, "ratio:3/4 explain");
  });

  it("lets --model win over a positional token", async () => {
    mock.requests.length = 0;
    await runCli(["prompt", "mockhost", "--model", "fake:1b", "hello world"], { sandbox });

    assert.equal(mock.chats()[0].model, "fake:1b");
  });
});

describe("host naming and continuation", () => {
  let mock;
  let sandbox;
  let chatId;

  before(async () => {
    mock = await startMock({ models: ["fake:1b"] });
    sandbox = await makeSandbox(mockConfig(mock.port));
    const res = await runCli(["prompt", "mockhost", "first question"], { sandbox });
    chatId = /chat ([0-9a-f]+)/.exec(res.stderr)?.[1];
    assert.ok(chatId, `expected a chat id in stderr, got: ${res.stderr}`);
  });
  after(async () => {
    await mock.close();
    await sandbox.cleanup();
  });

  // Regression: a config host given as an IP had dnsName set to that IP, so
  // shortName() returned the first octet ("127") instead of the configured name.
  // That wrong name was persisted as chat.machine, making the chat uncontinuable.
  it("uses the configured name, not the first octet of the IP", async () => {
    const files = await readdir(sandbox.responsesDir);
    const chat = JSON.parse(await readFile(path.join(sandbox.responsesDir, files[0]), "utf8"));

    assert.equal(chat.machine, "mockhost");
  });

  // Regression: the first word of an unquoted follow-up was consumed as a hostname.
  it("does not steal the first word of an unquoted follow-up", async () => {
    mock.requests.length = 0;
    const res = await runCli(["prompt", "--chat", chatId, "explain", "that", "again"], { sandbox });

    assert.equal(res.code, 0);
    assert.equal(mock.chats()[0].messages.at(-1).content, "explain that again");
  });

  it("peels a leading token that really is a discovered host", async () => {
    mock.requests.length = 0;
    const res = await runCli(["prompt", "mockhost", "--chat", chatId, "another", "question"], {
      sandbox,
    });

    assert.equal(res.code, 0);
    assert.equal(mock.chats()[0].messages.at(-1).content, "another question");
  });

  it("carries prior turns into the request", async () => {
    mock.requests.length = 0;
    await runCli(["prompt", "--chat", chatId, "yet another follow-up"], { sandbox });

    const roles = mock.chats()[0].messages.map((m) => m.role);
    assert.ok(roles.length >= 3, `expected accumulated history, got: ${roles.join(",")}`);
    assert.equal(roles[0], "user");
    assert.ok(roles.includes("assistant"));
  });

  it("rejects a traversal-shaped chat id", async () => {
    const res = await runCli(["prompt", "--chat", "../../../etc/passwd", "hi"], { sandbox });

    assert.notEqual(res.code, 0);
    assert.match(res.stderr, /Invalid chat id/);
  });

  it("writes a transcript with roles and content in order", async () => {
    const files = await readdir(sandbox.responsesDir);
    const chat = JSON.parse(await readFile(path.join(sandbox.responsesDir, files[0]), "utf8"));

    assert.equal(chat.messages[0].role, "user");
    assert.equal(chat.messages[0].content, "first question");
    assert.equal(chat.messages[1].role, "assistant");
    assert.ok(chat.topic);
    assert.ok(chat.created_at && chat.updated_at);
  });
});

describe("request options", () => {
  let mock;
  let sandbox;

  before(async () => {
    mock = await startMock({ models: ["fake:1b"] });
    sandbox = await makeSandbox(mockConfig(mock.port));
  });
  after(async () => {
    await mock.close();
    await sandbox.cleanup();
  });

  // Regression: the topic pass forced keep_alive:0, unloading the user's model
  // immediately after the first turn of every new chat.
  it("uses the caller's keep_alive for the topic pass too", async () => {
    mock.requests.length = 0;
    await runCli(["prompt", "mockhost", "hello"], {
      sandbox,
      env: { OLLAMA_KEEP_ALIVE: "5m" },
    });

    const sent = mock.chats();
    assert.ok(sent.length >= 2, "expected both a main call and a topic call");
    for (const req of sent) {
      assert.equal(req.keep_alive, "5m");
    }
  });

  it("defaults think to false so thinking models still return a reply", async () => {
    mock.requests.length = 0;
    await runCli(["prompt", "mockhost", "hello"], { sandbox });

    assert.equal(mock.chats()[0].think, false);
  });

  it("sends think:true with --think", async () => {
    mock.requests.length = 0;
    await runCli(["prompt", "mockhost", "--think", "hello"], { sandbox });

    assert.equal(mock.chats()[0].think, true);
  });

  it("passes numeric options through under options{}", async () => {
    mock.requests.length = 0;
    await runCli(["prompt", "mockhost", "--temperature", "0.2", "--num-ctx", "8192", "hello"], {
      sandbox,
    });

    const req = mock.chats()[0];
    assert.equal(req.options.temperature, 0.2);
    assert.equal(req.options.num_ctx, 8192);
  });

  it("rejects a non-numeric flag value", async () => {
    const res = await runCli(["prompt", "mockhost", "--temperature", "hot", "hi"], { sandbox });

    assert.notEqual(res.code, 0);
    assert.match(res.stderr, /--temperature must be a number/);
  });

  it("skips the transcript with --no-save", async () => {
    const s = await makeSandbox(mockConfig(mock.port));
    await runCli(["prompt", "mockhost", "--no-save", "hello"], { sandbox: s });

    await assert.rejects(() => readdir(s.responsesDir));
    await s.cleanup();
  });
});

describe("streams and output", () => {
  it("keeps reasoning on stderr and the answer on stdout", async () => {
    const mock = await startMock({
      models: ["qwen3:0.6b"],
      thinking: ["Let me ponder. ", "Still pondering. "],
      reply: "Final answer.",
    });
    const sandbox = await makeSandbox({
      hosts: [{ name: "mockhost", host: "127.0.0.1", port: mock.port }],
      defaultModels: { mockhost: "qwen3:0.6b" },
    });

    const res = await runCli(["prompt", "mockhost", "--think", "hi"], { sandbox });

    assert.equal(res.stdout.trim(), "Final answer.");
    assert.match(res.stderr, /\[thinking\]/);
    assert.match(res.stderr, /Still pondering/);
    assert.doesNotMatch(res.stdout, /pondering/);

    await mock.close();
    await sandbox.cleanup();
  });

  it("emits parseable JSON with --json", async () => {
    const mock = await startMock({ models: ["fake:1b"], topicReply: "JSON Topic" });
    const sandbox = await makeSandbox(mockConfig(mock.port));

    const res = await runCli(["prompt", "mockhost", "--json", "hi"], { sandbox });

    const payload = JSON.parse(res.stdout);
    assert.ok(payload.chat_id);
    assert.equal(typeof payload.content, "string");

    await mock.close();
    await sandbox.cleanup();
  });
});

describe("error handling", () => {
  // Regression: a non-Ollama service on the port produced a bare SyntaxError.
  it("explains a non-JSON response instead of throwing SyntaxError", async () => {
    const mock = await startMock({ rawBody: "<html><body>Router admin</body></html>" });
    const sandbox = await makeSandbox(mockConfig(mock.port));

    const res = await runCli(["prompt", "mockhost", "hi"], { sandbox });

    assert.notEqual(res.code, 0);
    assert.match(res.stderr, /Non-JSON response/);
    assert.doesNotMatch(res.stderr, /SyntaxError/);

    await mock.close();
    await sandbox.cleanup();
  });

  it("surfaces a non-200 status with the body", async () => {
    const mock = await startMock({ status: 400 });
    const sandbox = await makeSandbox(mockConfig(mock.port));

    const res = await runCli(["prompt", "mockhost", "hi"], { sandbox });

    assert.notEqual(res.code, 0);
    assert.match(res.stderr, /Ollama HTTP 400/);

    await mock.close();
    await sandbox.cleanup();
  });

  // Regression: bad numeric env vars silently became NaN.
  it("fails loudly on a non-numeric env var", async () => {
    const sandbox = await makeSandbox();
    const res = await runCli(["scan"], { sandbox, env: { OLLAMA_PORT: "abc" } });

    assert.notEqual(res.code, 0);
    assert.match(res.stderr, /Invalid OLLAMA_PORT/);

    await sandbox.cleanup();
  });

  // Regression: bare words were treated as direct addresses, so typos became
  // confusing connection failures instead of a helpful error.
  it("reports an unknown machine rather than dialling a bare word", async () => {
    const mock = await startMock();
    const sandbox = await makeSandbox(mockConfig(mock.port));

    const res = await runCli(["prompt", "mockhostt", "hi"], { sandbox });

    assert.notEqual(res.code, 0);
    assert.match(res.stderr, /Unknown machine/);
    assert.match(res.stderr, /mockhost/);

    await mock.close();
    await sandbox.cleanup();
  });
});

describe("scan and chats", () => {
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

  it("lists a configured host and its models as JSON", async () => {
    const res = await runCli(["scan", "--json"], { sandbox });

    const payload = JSON.parse(res.stdout);
    const server = payload.servers.find((s) => s.ip === "127.0.0.1" && s.port === mock.port);
    assert.ok(server, "expected the mock host in scan output");
    assert.deepEqual(server.models.map((m) => m.name).sort(), ["fake:1b", "qwen3:0.6b"]);
  });

  it("lists saved chats", async () => {
    await runCli(["prompt", "mockhost", "remember this"], { sandbox });
    const res = await runCli(["chats", "--json"], { sandbox });

    const payload = JSON.parse(res.stdout);
    const list = Array.isArray(payload) ? payload : payload.chats;
    assert.ok(list.length > 0, "expected at least one saved chat");
  });
});
