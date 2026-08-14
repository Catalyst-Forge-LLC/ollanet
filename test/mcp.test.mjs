import assert from "node:assert/strict";
import { spawn } from "node:child_process";
import { after, before, describe, it } from "node:test";
import { CLI, makeSandbox, startMock } from "./helpers.mjs";

function startMcp(sandbox) {
  const child = spawn(process.execPath, [CLI, "mcp"], {
    env: {
      ...process.env,
      OLLANET_CONFIG: sandbox.configFile,
      OLLANET_RESPONSES_DIR: sandbox.responsesDir,
      OLLANET_BENCHMARKS_DIR: sandbox.benchmarksDir,
      OLLANET_LAST_SCAN: sandbox.lastScanFile,
      OLLANET_HOSTS: "",
      OLLAMA_KEEP_ALIVE: "",
      OLLAMA_TEMPERATURE: "",
      OLLAMA_SYSTEM: "",
    },
    stdio: ["pipe", "pipe", "pipe"],
  });

  let buf = "";
  const queue = [];
  child.stdout.on("data", (d) => {
    buf += d.toString();
    let nl;
    while ((nl = buf.indexOf("\n")) !== -1) {
      const line = buf.slice(0, nl).trim();
      buf = buf.slice(nl + 1);
      if (line) queue.push(JSON.parse(line));
    }
  });

  async function rpc(method, params, id = 1) {
    const msg = { jsonrpc: "2.0", id, method, ...(params !== undefined ? { params } : {}) };
    child.stdin.write(`${JSON.stringify(msg)}\n`);
    const deadline = Date.now() + 10_000;
    while (Date.now() < deadline) {
      const hit = queue.find((m) => m.id === id);
      if (hit) {
        const idx = queue.indexOf(hit);
        queue.splice(idx, 1);
        return hit;
      }
      await new Promise((r) => setTimeout(r, 20));
    }
    throw new Error(`Timeout waiting for MCP response id=${id} method=${method}`);
  }

  function notify(method, params) {
    child.stdin.write(
      `${JSON.stringify({ jsonrpc: "2.0", method, ...(params !== undefined ? { params } : {}) })}\n`,
    );
  }

  function close() {
    child.stdin.end();
    child.kill("SIGTERM");
  }

  return { rpc, notify, close, child };
}

describe("ollanet mcp", () => {
  /** @type {Awaited<ReturnType<typeof startMock>>} */
  let mock;
  /** @type {Awaited<ReturnType<typeof makeSandbox>>} */
  let sandbox;

  before(async () => {
    mock = await startMock({ models: ["fake:1b"], reply: "mcp-ok" });
    sandbox = await makeSandbox({
      discovery: { localhost: false, tailscale: false, lan: false },
      hosts: [{ name: "mockhost", host: "127.0.0.1", port: mock.port }],
      defaultModels: { mockhost: "fake:1b" },
    });
  });

  after(async () => {
    await mock.close();
    await sandbox.cleanup();
  });

  it("initializes and lists tools", async () => {
    const mcp = startMcp(sandbox);
    try {
      const init = await mcp.rpc("initialize", {
        protocolVersion: "2024-11-05",
        capabilities: {},
        clientInfo: { name: "test", version: "0.0.0" },
      });
      assert.equal(init.result.serverInfo.name, "ollanet");
      assert.ok(init.result.capabilities.tools);
      mcp.notify("notifications/initialized");

      const listed = await mcp.rpc("tools/list", {}, 2);
      const names = listed.result.tools.map((t) => t.name).sort();
      assert.deepEqual(names, [
        "ollanet_get_chat",
        "ollanet_list_chats",
        "ollanet_prompt",
        "ollanet_ps",
        "ollanet_pull",
        "ollanet_rm",
        "ollanet_scan",
        "ollanet_show",
      ]);
    } finally {
      mcp.close();
    }
  });

  it("scan + prompt + list_chats round-trip", async () => {
    const mcp = startMcp(sandbox);
    try {
      await mcp.rpc("initialize", {
        protocolVersion: "2024-11-05",
        capabilities: {},
        clientInfo: { name: "test", version: "0.0.0" },
      });
      mcp.notify("notifications/initialized");

      const scan = await mcp.rpc(
        "tools/call",
        { name: "ollanet_scan", arguments: {} },
        10,
      );
      assert.equal(scan.result.isError, undefined);
      const scanBody = JSON.parse(scan.result.content[0].text);
      assert.ok(scanBody.servers.some((s) => s.ip === "127.0.0.1"));
      assert.ok(scanBody.servers[0].models.some((m) => m.name === "fake:1b"));

      const last = await mcp.rpc(
        "tools/call",
        { name: "ollanet_scan", arguments: { last: true } },
        15,
      );
      assert.equal(last.result.isError, undefined);
      const lastBody = JSON.parse(last.result.content[0].text);
      assert.ok(lastBody.scanned_at);
      assert.ok(lastBody.servers.some((s) => s.ip === "127.0.0.1"));

      const prompt = await mcp.rpc(
        "tools/call",
        {
          name: "ollanet_prompt",
          arguments: {
            machine: "mockhost",
            model: "fake:1b",
            prompt: "hello from mcp",
          },
        },
        11,
      );
      assert.equal(prompt.result.isError, undefined);
      const promptBody = JSON.parse(prompt.result.content[0].text);
      assert.equal(promptBody.content, "mcp-ok");
      assert.ok(promptBody.chat_id);

      const listed = await mcp.rpc(
        "tools/call",
        { name: "ollanet_list_chats", arguments: {} },
        12,
      );
      const chats = JSON.parse(listed.result.content[0].text);
      assert.ok(chats.some((c) => c.id === promptBody.chat_id));

      const got = await mcp.rpc(
        "tools/call",
        { name: "ollanet_get_chat", arguments: { chat_id: promptBody.chat_id } },
        13,
      );
      const chat = JSON.parse(got.result.content[0].text);
      assert.equal(chat.id, promptBody.chat_id);
      assert.ok(chat.messages.some((m) => m.role === "user" && m.content.includes("hello from mcp")));

      const pulled = await mcp.rpc(
        "tools/call",
        {
          name: "ollanet_pull",
          arguments: { machine: "mockhost", model: "gemma3:12b" },
        },
        14,
      );
      assert.equal(pulled.result.isError, undefined);
      const pullBody = JSON.parse(pulled.result.content[0].text);
      assert.equal(pullBody.model, "gemma3:12b");
      assert.equal(pullBody.status, "success");
      assert.equal(mock.pulls().at(-1).model, "gemma3:12b");
    } finally {
      mcp.close();
    }
  });

  it("show / ps / rm (rm requires confirm)", async () => {
    const mcp = startMcp(sandbox);
    try {
      await mcp.rpc("initialize", {
        protocolVersion: "2024-11-05",
        capabilities: {},
        clientInfo: { name: "test", version: "0.0.0" },
      });
      mcp.notify("notifications/initialized");

      const shown = await mcp.rpc(
        "tools/call",
        { name: "ollanet_show", arguments: { machine: "mockhost", model: "fake:1b" } },
        20,
      );
      assert.equal(shown.result.isError, undefined);
      const showBody = JSON.parse(shown.result.content[0].text);
      assert.equal(showBody.model, "fake:1b");
      assert.equal(showBody.tuned, false);

      const refused = await mcp.rpc(
        "tools/call",
        { name: "ollanet_rm", arguments: { machine: "mockhost", model: "fake:1b" } },
        21,
      );
      assert.equal(refused.result.isError, true);
      assert.match(refused.result.content[0].text, /confirm/);

      const removed = await mcp.rpc(
        "tools/call",
        {
          name: "ollanet_rm",
          arguments: { machine: "mockhost", model: "fake:1b", confirm: true },
        },
        22,
      );
      assert.equal(removed.result.isError, undefined);
      assert.equal(JSON.parse(removed.result.content[0].text).deleted, true);
      assert.equal(mock.deletes().at(-1).model, "fake:1b");

      const ps = await mcp.rpc(
        "tools/call",
        { name: "ollanet_ps", arguments: { machine: "mockhost" } },
        23,
      );
      assert.equal(ps.result.isError, undefined);
      const psBody = JSON.parse(ps.result.content[0].text);
      assert.equal(psBody.hosts[0].machine, "mockhost");
    } finally {
      mcp.close();
    }
  });
});
