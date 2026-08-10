/**
 * Shared test harness: an in-process mock Ollama server and a CLI spawner.
 *
 * The mock records every request it receives so tests can assert on the exact
 * body ollanet sent (model, keep_alive, think, message contents) rather than
 * only on what got printed.
 */
import { spawn } from "node:child_process";
import http from "node:http";
import { mkdtemp, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";
import { fileURLToPath } from "node:url";

const TEST_DIR = path.dirname(fileURLToPath(import.meta.url));
export const CLI = path.join(TEST_DIR, "..", "dist", "cli.js");

/**
 * Start a fake Ollama server on an ephemeral port.
 *
 * @param {object} [opts]
 * @param {string[]} [opts.models]      Names returned by /api/tags.
 * @param {string}   [opts.reply]       Assistant content for /api/chat.
 * @param {string[]} [opts.thinking]    Thinking chunks to stream before the reply.
 * @param {string}   [opts.topicReply]  Content for non-streaming (topic) calls.
 * @param {string}   [opts.rawBody]     Send this literal body instead of JSON.
 * @param {number}   [opts.status]      HTTP status for /api/chat.
 */
export async function startMock(opts = {}) {
  const {
    models = ["fake:1b", "qwen3:0.6b"],
    reply = "mock reply",
    thinking = [],
    topicReply = "Mock Topic",
    rawBody = null,
    status = 200,
  } = opts;

  /** @type {Array<{url: string, body: any}>} */
  const requests = [];

  const server = http.createServer((req, res) => {
    let raw = "";
    req.on("data", (c) => (raw += c));
    req.on("end", () => {
      let body = null;
      try {
        body = raw ? JSON.parse(raw) : null;
      } catch {
        body = raw;
      }
      requests.push({ url: req.url ?? "", body });

      if (req.url === "/api/tags") {
        res.setHeader("Content-Type", "application/json");
        res.end(JSON.stringify({ models: models.map((name) => ({ name })) }));
        return;
      }

      if (rawBody !== null) {
        res.statusCode = status;
        res.setHeader("Content-Type", "text/html");
        res.end(rawBody);
        return;
      }

      if (status !== 200) {
        res.statusCode = status;
        res.setHeader("Content-Type", "application/json");
        res.end(JSON.stringify({ error: "mock error" }));
        return;
      }

      res.setHeader("Content-Type", "application/x-ndjson");

      // Non-streaming calls are used for the topic pass and --json/--no-stream.
      if (!body?.stream) {
        res.end(
          JSON.stringify({
            message: { content: topicReply },
            done: true,
            eval_count: 3,
            eval_duration: 1e9,
            total_duration: 1e9,
          }),
        );
        return;
      }

      for (const t of thinking) {
        res.write(JSON.stringify({ message: { thinking: t } }) + "\n");
      }
      res.write(JSON.stringify({ message: { content: reply } }) + "\n");
      res.end(
        JSON.stringify({
          done: true,
          eval_count: 5,
          eval_duration: 1e9,
          total_duration: 1e9,
        }) + "\n",
      );
    });
  });

  await new Promise((resolve) => server.listen(0, "127.0.0.1", resolve));
  const { port } = /** @type {import("node:net").AddressInfo} */ (server.address());

  return {
    port,
    /** `127.0.0.1:PORT`, usable directly as an ollanet <machine> argument. */
    address: `127.0.0.1:${port}`,
    requests,
    /** Requests sent to /api/chat, in order. */
    chats: () => requests.filter((r) => r.url === "/api/chat").map((r) => r.body),
    close: () =>
      new Promise((resolve) => {
        // undici holds keep-alive sockets open, which would stall server.close().
        server.closeAllConnections();
        server.close(resolve);
      }),
  };
}

/** Create an isolated config + responses dir so tests never touch ~/.ollanet. */
export async function makeSandbox(config = {}) {
  const dir = await mkdtemp(path.join(tmpdir(), "ollanet-test-"));
  const configFile = path.join(dir, "config.json");
  await writeFile(
    configFile,
    JSON.stringify({
      // Keep discovery hermetic: no Tailscale shellout, no LAN sweep.
      discovery: { localhost: true, tailscale: false, lan: false },
      ...config,
    }),
  );
  return {
    dir,
    configFile,
    responsesDir: path.join(dir, "responses"),
    cleanup: () => rm(dir, { recursive: true, force: true }),
  };
}

/**
 * Run the CLI and capture stdout/stderr separately.
 *
 * @param {string[]} args
 * @param {object} [opts]
 * @param {object} [opts.sandbox] Result of makeSandbox().
 * @param {object} [opts.env]     Extra environment variables.
 * @param {string} [opts.stdin]   Text to pipe on stdin (default: closed, no TTY).
 */
export function runCli(args, opts = {}) {
  const { sandbox, env = {}, stdin = "" } = opts;

  const child = spawn(process.execPath, [CLI, ...args], {
    env: {
      ...process.env,
      ...(sandbox
        ? {
            OLLANET_CONFIG: sandbox.configFile,
            OLLANET_RESPONSES_DIR: sandbox.responsesDir,
          }
        : {}),
      // Don't let a developer's real settings leak into assertions.
      OLLANET_HOSTS: "",
      OLLAMA_KEEP_ALIVE: "",
      OLLAMA_TEMPERATURE: "",
      OLLAMA_SYSTEM: "",
      ...env,
    },
    stdio: ["pipe", "pipe", "pipe"],
  });

  let stdout = "";
  let stderr = "";
  child.stdout.on("data", (d) => (stdout += d));
  child.stderr.on("data", (d) => (stderr += d));
  if (stdin) child.stdin.write(stdin);
  child.stdin.end();

  return new Promise((resolve) => {
    const timer = setTimeout(() => child.kill("SIGKILL"), 20_000);
    child.on("close", (code) => {
      clearTimeout(timer);
      resolve({ code, stdout, stderr });
    });
  });
}
