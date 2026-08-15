/**
 * Pull a model onto a reachable Ollama host.
 *
 *   ollanet pull studio gemma3:12b
 *
 * `studio` is the machine (discovered name, MagicDNS, hostname, or IP).
 * The *server* downloads from the registry; ollanet only sends POST /api/pull.
 */

import type { AppConfig } from "./config.ts";
import { expandMachineModel, loadConfig } from "./config.ts";
import { envInt, ollamaBaseUrl, shortName } from "./hosts.ts";
import { ollamaPull, type PullChunk } from "./ollama-chat.ts";
import { failUsage, isHelpFlag, printHelp, takeFlag } from "./argv.ts";
import { resolveTarget } from "./target.ts";

/** Pull HTTP timeout (ms). 0 = none. Large models can take hours. */
function pullTimeoutMs(): number {
  return envInt("OLLAMA_PULL_TIMEOUT_MS", 0);
}

export function helpText(): string {
  return `Usage:
  ollanet pull <machine> <model>
  ollanet pull <alias>
  ollanet pull --machine <name> --model <name>

Examples:
  ollanet pull studio gemma3:12b
  ollanet pull desk
  ollanet pull localhost llama3.2:1b
  ollanet pull 192.168.1.50 gemma3:12b --json

The named machine downloads the model onto its own disk. ollanet does not
upload weights. Re-pulling the same name updates it when the registry has a
newer digest. A single alias name expands to that alias's machine + model.

Options:
  --machine <name>   Host (discovered name, MagicDNS, hostname, or IP[:port])
  --model <name>     Model to pull (e.g. gemma3:12b)
  --insecure         Allow HTTP / self-signed model registries
  --no-stream        Wait for a single final response (no progress chunks)
  --json             Emit result JSON on stdout`;
}

function usage(): never {
  failUsage(helpText());
}

function parseArgs(argv: string[]): {
  machine?: string;
  model?: string;
  insecure: boolean;
  stream: boolean;
  json: boolean;
} {
  const args = [...argv];
  let machineFlag: string | undefined;
  let modelFlag: string | undefined;
  let insecure = false;
  let stream = true;
  let json = false;
  const positional: string[] = [];

  while (args.length > 0) {
    const arg = args.shift()!;
    if (arg === "--") continue;
    if (isHelpFlag(arg)) printHelp(helpText());
    if (arg === "--insecure") {
      insecure = true;
      continue;
    }
    if (arg === "--no-stream") {
      stream = false;
      continue;
    }
    if (arg === "--json") {
      json = true;
      continue;
    }
    const machine = takeFlag(arg, "--machine", args, usage);
    if (machine !== undefined) {
      machineFlag = machine;
      continue;
    }
    const model = takeFlag(arg, "--model", args, usage);
    if (model !== undefined) {
      modelFlag = model;
      continue;
    }
    if (arg.startsWith("-")) {
      console.error(`Unknown flag: ${arg}`);
      usage();
    }
    positional.push(arg);
  }

  const machine = machineFlag ?? positional[0];
  const model = modelFlag ?? (machineFlag ? positional[0] : positional[1]);
  if (positional.length > 2 || (machineFlag && modelFlag && positional.length > 0)) {
    console.error("Too many arguments.");
    usage();
  }

  return { machine, model, insecure, stream, json };
}

function formatBytes(n: number): string {
  if (n < 1024) return `${n} B`;
  if (n < 1024 ** 2) return `${(n / 1024).toFixed(1)} KB`;
  if (n < 1024 ** 3) return `${(n / 1024 ** 2).toFixed(1)} MB`;
  return `${(n / 1024 ** 3).toFixed(2)} GB`;
}

function shortDigest(digest: string): string {
  const hex = digest.replace(/^sha256:/, "");
  return hex.slice(0, 12);
}

function formatPullLine(chunk: PullChunk): string {
  const status = chunk.status ?? "pulling";
  if (chunk.total && chunk.total > 0) {
    const pct = Math.min(100, Math.floor((100 * (chunk.completed ?? 0)) / chunk.total));
    const digest = chunk.digest ? ` ${shortDigest(chunk.digest)}` : "";
    return `${status}${digest}  ${pct}%  ${formatBytes(chunk.completed ?? 0)} / ${formatBytes(chunk.total)}`;
  }
  return status;
}

interface ProgressState {
  lastStatus: string;
  usedCarriage: boolean;
}

function emitProgress(chunk: PullChunk, state: ProgressState, tty: boolean): void {
  if (chunk.total && chunk.total > 0 && tty) {
    process.stderr.write(`\r${formatPullLine(chunk).padEnd(80)}`);
    state.usedCarriage = true;
    state.lastStatus = chunk.status ?? state.lastStatus;
    return;
  }
  if (chunk.status && chunk.status !== state.lastStatus) {
    if (state.usedCarriage) {
      process.stderr.write("\n");
      state.usedCarriage = false;
    }
    process.stderr.write(`${chunk.status}\n`);
    state.lastStatus = chunk.status;
  }
}

export interface PullOptions {
  machine: string;
  model: string;
  insecure?: boolean;
  stream?: boolean;
  /** Progress on stderr. Default true for CLI; pass false for MCP / apps. */
  writeStdout?: boolean;
  quiet?: boolean;
  /** In-memory config; skips the config file when set. */
  config?: Partial<AppConfig>;
  timeoutMs?: number;
  onProgress?: (chunk: PullChunk) => void;
}

export interface PullResult {
  machine: string;
  model: string;
  status: string;
  endpoint: string;
  next: { hint: string; site: string };
}

/** Programmatic pull used by the CLI, MCP, and apps. */
export async function pullModel(opts: PullOptions): Promise<PullResult> {
  const model = (opts.model ?? "").trim();
  const machineQuery = (opts.machine ?? "").trim();
  if (!machineQuery) throw new Error("Machine is required.");
  if (!model) throw new Error("Model is required.");

  const host = await resolveTarget(machineQuery, opts.config);

  const writeProgress = opts.writeStdout !== false;
  const quiet = opts.quiet === true || !writeProgress;
  const state: ProgressState = { lastStatus: "", usedCarriage: false };
  const tty = Boolean(process.stderr.isTTY);

  if (!quiet) {
    console.error(`→ ${shortName(host)} (${host.ip})  pulling ${model}`);
  }

  const pulled = await ollamaPull({
    baseUrl: ollamaBaseUrl(host),
    model,
    insecure: opts.insecure === true,
    stream: opts.stream !== false,
    timeoutMs: opts.timeoutMs ?? pullTimeoutMs(),
    onProgress: (chunk) => {
      opts.onProgress?.(chunk);
      if (!quiet) emitProgress(chunk, state, tty);
    },
  });

  if (!quiet && state.usedCarriage) {
    process.stderr.write("\n");
  }

  const machine = shortName(host);
  return {
    machine,
    model,
    status: pulled.status,
    endpoint: ollamaBaseUrl(host),
    next: {
      hint: `On ${machine}: finetuna --model ${model}  → then ollanet show ${machine} <tuned-name>`,
      site: "https://finetuna.net",
    },
  };
}

export async function main(): Promise<void> {
  const parsed = parseArgs(process.argv.slice(2));
  const config = await loadConfig();
  const expanded = expandMachineModel(config, parsed.machine, parsed.model);
  if (!expanded.machine || !expanded.model) {
    if (!expanded.machine) console.error("Machine is required.");
    else console.error("Model is required.");
    usage();
  }

  const result = await pullModel({
    machine: expanded.machine,
    model: expanded.model,
    insecure: parsed.insecure,
    stream: parsed.stream,
    writeStdout: true,
    quiet: false,
    config,
  });

  if (parsed.json) {
    process.stdout.write(`${JSON.stringify(result, null, 2)}\n`);
    return;
  }
  process.stdout.write(`pulled ${result.model} on ${result.machine}\n`);
  process.stderr.write(`${result.next.hint}\n${result.next.site}\n`);
}
