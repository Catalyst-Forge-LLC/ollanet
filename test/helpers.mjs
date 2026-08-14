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
 * @param {Record<string, string[]>} [opts.capabilities] Per-model capabilities for /api/show.
 * @param {string}   [opts.reply]       Assistant content for /api/chat.
 * @param {string[]} [opts.thinking]    Thinking chunks to stream before the reply.
 * @param {string}   [opts.topicReply]  Content for non-streaming (topic) calls.
 * @param {string}   [opts.rawBody]     Send this literal body instead of JSON.
 * @param {number}   [opts.status]      HTTP status for /api/chat.
 * @param {string}   [opts.doneReason]  done_reason on final chat chunk (default length).
 * @param {number}   [opts.evalCount]   eval_count on chat responses.
 * @param {number}   [opts.evalDuration]
 * @param {number}   [opts.loadDuration] load_duration (ns) on chat responses.
 * @param {string}   [opts.version]     /api/version string.
 * @param {string[]} [opts.loaded]      Models already reported by /api/ps.
 * @param {Record<string, object>} [opts.show] Extra /api/show fields keyed by model name.
 * @param {string}   [opts.pullError]   If set, /api/pull returns HTTP 500 with this error.
 * @param {string}   [opts.deleteError] If set, /api/delete returns HTTP 500 with this error.
 * @param {(req: {url: string, body: any}, ctx: object) => object|null} [opts.onChat]
 *        Optional override returning a full JSON body for non-stream chat.
 */
export async function startMock(opts = {}) {
  const {
    models = ["fake:1b", "qwen3:0.6b"],
    capabilities = {},
    reply = "mock reply",
    thinking = [],
    topicReply = "Mock Topic",
    rawBody = null,
    status = 200,
    doneReason = "length",
    evalCount = 5,
    evalDuration = 1e9,
    loadDuration = 0,
    version = "0.9.0-mock",
    pullError = null,
    deleteError = null,
    show = {},
    onChat = null,
  } = opts;

  /** @type {Array<{url: string, body: any, method: string}>} */
  const requests = [];
  /** @type {Set<string>} */
  const loaded = new Set(opts.loaded ?? []);
  /** @type {string | null} */
  let pendingUnload = null;
  let unloadPollsRemaining = 0;
  const coldLoadDuration = opts.coldLoadDuration ?? 2_100_000_000;

  const psModels = () => {
    const names = new Set(loaded);
    if (pendingUnload && unloadPollsRemaining > 0) {
      names.add(pendingUnload);
    }
    return [...names].map((name) => ({
      name,
      model: name,
      size_vram: 123456789,
      context_length: 8192,
      digest: `sha256:digest-${name.replace(/[^a-z0-9]+/gi, "")}`,
    }));
  };

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
      requests.push({ url: req.url ?? "", body, method: req.method ?? "GET" });

      if (req.url === "/api/tags") {
        res.setHeader("Content-Type", "application/json");
        res.end(
          JSON.stringify({
            models: models.map((name) => ({
              name,
              digest: `sha256:digest-${name.replace(/[^a-z0-9]+/gi, "")}`,
              size: 1_000_000,
              details: {
                parameter_size: "1B",
                quantization_level: "Q4_0",
                family: "mock",
              },
            })),
          }),
        );
        return;
      }

      if (req.url === "/api/version") {
        res.setHeader("Content-Type", "application/json");
        res.end(JSON.stringify({ version }));
        return;
      }

      if (req.url === "/api/ps") {
        if (pendingUnload && unloadPollsRemaining > 0) {
          unloadPollsRemaining -= 1;
          if (unloadPollsRemaining <= 0) {
            loaded.delete(pendingUnload);
            pendingUnload = null;
          }
        }
        res.setHeader("Content-Type", "application/json");
        res.end(JSON.stringify({ models: psModels() }));
        return;
      }

      if (req.url === "/api/pull") {
        if (pullError) {
          res.statusCode = 500;
          res.setHeader("Content-Type", "application/json");
          res.end(JSON.stringify({ error: pullError }));
          return;
        }
        if (!body?.stream) {
          res.setHeader("Content-Type", "application/json");
          res.end(JSON.stringify({ status: "success" }));
          return;
        }
        res.setHeader("Content-Type", "application/x-ndjson");
        res.write(JSON.stringify({ status: "pulling manifest" }) + "\n");
        res.write(
          JSON.stringify({
            status: "downloading",
            digest: "sha256:abc123def456",
            total: 1000,
            completed: 500,
          }) + "\n",
        );
        res.end(JSON.stringify({ status: "success" }) + "\n");
        return;
      }

      if (req.url === "/api/delete") {
        if (deleteError) {
          res.statusCode = 500;
          res.setHeader("Content-Type", "application/json");
          res.end(JSON.stringify({ error: deleteError }));
          return;
        }
        res.statusCode = 200;
        res.end();
        return;
      }

      if (req.url === "/api/show") {
        const name = typeof body?.model === "string" ? body.model : "";
        res.setHeader("Content-Type", "application/json");
        const extra = show[name] ?? {};
        // capabilities[name] === null → omit key (omitempty / older servers)
        // undefined → default ["completion"]
        if (Object.prototype.hasOwnProperty.call(capabilities, name) && capabilities[name] === null) {
          res.end(JSON.stringify({ modelfile: "", parameters: "", template: "", ...extra }));
          return;
        }
        const caps = Object.prototype.hasOwnProperty.call(capabilities, name)
          ? capabilities[name]
          : ["completion"];
        res.end(
          JSON.stringify({
            capabilities: caps,
            modelfile: "",
            parameters: "",
            template: "",
            ...extra,
          }),
        );
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

      const modelName = typeof body?.model === "string" ? body.model : "";
      if (modelName) {
        if (body?.keep_alive === 0 || body?.keep_alive === "0") {
          pendingUnload = modelName;
          if (unloadPollsRemaining <= 0) {
            loaded.delete(modelName);
            pendingUnload = null;
          }
        } else {
          loaded.add(modelName);
        }
      }

      if (typeof onChat === "function") {
        const override = onChat({ url: req.url ?? "", body }, { loaded, requests });
        if (override) {
          res.setHeader("Content-Type", "application/json");
          res.end(JSON.stringify(override));
          return;
        }
      }

      res.setHeader("Content-Type", "application/x-ndjson");

      if (!body?.stream) {
        const numPredict = body?.options?.num_predict;
        const isColdProbe = numPredict === 1;
        const isTopic = numPredict === 24;
        const content = isColdProbe ? "x" : isTopic ? topicReply : reply;
        res.end(
          JSON.stringify({
            message: { content },
            done: true,
            done_reason: doneReason,
            eval_count: isColdProbe ? 1 : numPredict === 256 ? 256 : evalCount,
            eval_duration: evalDuration,
            load_duration: isColdProbe ? coldLoadDuration : loadDuration,
            total_duration: evalDuration,
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
          done_reason: doneReason,
          eval_count: evalCount,
          eval_duration: evalDuration,
          load_duration: loadDuration,
          total_duration: evalDuration,
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
    loaded,
    /** Delay how many /api/ps polls still report a model after unload. */
    setUnloadPollDelay(n) {
      unloadPollsRemaining = n;
    },
    /** Requests sent to /api/chat, in order. */
    chats: () => requests.filter((r) => r.url === "/api/chat").map((r) => r.body),
    /** Requests sent to /api/pull, in order. */
    pulls: () => requests.filter((r) => r.url === "/api/pull").map((r) => r.body),
    /** Requests sent to /api/delete, in order. */
    deletes: () => requests.filter((r) => r.url === "/api/delete").map((r) => r.body),
    /** Requests sent to /api/show, in order. */
    shows: () => requests.filter((r) => r.url === "/api/show").map((r) => r.body),
    /** Requests sent to /api/ps, in order. */
    pses: () => requests.filter((r) => r.url === "/api/ps"),
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
    benchmarksDir: path.join(dir, "benchmarks"),
    lastScanFile: path.join(dir, "last-scan.json"),
    comparesDir: path.join(dir, "compares"),
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
            OLLANET_BENCHMARKS_DIR: sandbox.benchmarksDir,
            OLLANET_LAST_SCAN: sandbox.lastScanFile,
            OLLANET_COMPARES_DIR: sandbox.comparesDir,
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
    const timer = setTimeout(() => child.kill("SIGKILL"), 60_000);
    child.on("close", (code) => {
      clearTimeout(timer);
      resolve({ code, stdout, stderr });
    });
  });
}
