/**
 * Head-to-head: one prompt, 2–5 models on the same host.
 *
 *   ollanet compare studio gemma3:12b llama3.2:3b --prompt "Explain MagicDNS"
 *   ollanet compare studio m1 m2 --file task.md
 */

import {
  configFromPartial,
  loadConfig,
  lookupAlias,
  machineSettingsForHost,
  mergeSettings,
  settingsFromEnv,
  type AppConfig,
  type GenerateSettings,
} from "./config.ts";
import { envInt, ollamaBaseUrl, shortName } from "./hosts.ts";
import { consumeSettingsFlag, failUsage, isHelpFlag, printHelp, takeFlag, takeValue } from "./argv.ts";
import { resolveTarget } from "./target.ts";
import {
  ollamaChat,
  ollamaTags,
  ollamaUnload,
  waitUntilUnloaded,
  type ChatChunk,
} from "./ollama-chat.ts";
import { assemblePrompt, readPromptFile } from "./prompt-input.ts";
import { comparesDir, newCompareId, saveCompare } from "./compare-store.ts";

const MIN_MODELS = 2;
const MAX_MODELS = 5;

/** Used when --prompt, --file, and stdin are all omitted. */
export const DEFAULT_COMPARE_PROMPT =
  "In 6–10 sentences, explain how you’d pick an Ollama host on a mixed LAN/Tailscale mesh " +
  "for a 12B chat model. Then give one failure mode (wrong host, cold load, or VRAM spill) " +
  "and how you’d confirm it. Be specific.";

function compareTimeoutMs(): number {
  return envInt("OLLAMA_COMPARE_TIMEOUT_MS", envInt("OLLAMA_PROMPT_TIMEOUT_MS", 600_000));
}

function unloadWaitMs(): number {
  return envInt("OLLAMA_COMPARE_UNLOAD_WAIT_MS", 60_000);
}

export function helpText(): string {
  return `Usage:
  ollanet compare <machine> <model> <model> [model...]
  ollanet compare <machine> <model> <model> [model...] --prompt <text>
  ollanet compare <machine> <model> <model> [model...] --file <path.txt|.md>

Examples:
  ollanet compare studio gemma3:12b llama3.2:3b
  ollanet compare studio gemma3:12b llama3.2:3b --prompt "Explain MagicDNS"
  ollanet compare studio gemma3:12b qwen2.5:7b llama3.2:3b --file ./task.md

Runs the same prompt on 2–5 models on one host. Prints a summary table and
writes compares/<id>.md plus .json (prompt, replies, stats). Not a bench suite.
Omit --prompt/--file to use the built-in mesh-host tasting prompt.

Options:
  --prompt <text>        Prompt text (default: built-in mesh-host prompt)
  --file <path>          Prompt from a .txt or .md file
  --system <text>        System prompt
  --temperature <n>
  --num-predict <n>
  --num-ctx <n>
  --keep-alive <value>
  --think / --no-think
  --unload               Unload each model before the next (fairer tok/s)
  --no-save              Do not write compares/*
  --json                 Emit the full record on stdout`;
}

function usage(): never {
  failUsage(helpText());
}

function parseArgs(argv: string[]): {
  machine?: string;
  models: string[];
  prompt?: string;
  file?: string;
  json: boolean;
  save: boolean;
  unload: boolean;
  settings: GenerateSettings;
} {
  const args = [...argv];
  let prompt: string | undefined;
  let file: string | undefined;
  let json = false;
  let save = true;
  let unload = false;
  const settings: GenerateSettings = {};
  const positional: string[] = [];

  while (args.length > 0) {
    const arg = args.shift()!;
    if (arg === "--") continue;
    if (isHelpFlag(arg)) printHelp(helpText());
    if (arg === "--json") {
      json = true;
      continue;
    }
    if (arg === "--no-save") {
      save = false;
      continue;
    }
    if (arg === "--unload") {
      unload = true;
      continue;
    }
    if (
      consumeSettingsFlag(arg, args, settings, usage, {
        temperature: true,
        numPredict: true,
        system: true,
      })
    ) {
      continue;
    }
    if (arg === "-p" || arg === "--prompt" || arg.startsWith("--prompt=")) {
      prompt = arg === "-p" ? takeValue(args, "--prompt", usage) : takeFlag(arg, "--prompt", args, usage);
      continue;
    }
    if (arg === "-f" || arg === "--file" || arg.startsWith("--file=")) {
      file = arg === "-f" ? takeValue(args, "--file", usage) : takeFlag(arg, "--file", args, usage);
      continue;
    }
    if (arg.startsWith("-")) {
      console.error(`Unknown flag: ${arg}`);
      usage();
    }
    positional.push(arg);
  }

  const machine = positional[0];
  const models = positional.slice(1);
  return { machine, models, prompt, file, json, save, unload, settings };
}

function tokPerSec(chunk: ChatChunk): number | undefined {
  if (chunk.eval_count == null || chunk.eval_duration == null || chunk.eval_duration <= 0) {
    return undefined;
  }
  return chunk.eval_count / (chunk.eval_duration / 1e9);
}

function resolveModelName(available: string[], query: string): string | undefined {
  const q = query.toLowerCase();
  const exact = available.find((n) => n.toLowerCase() === q);
  if (exact) return exact;
  const prefix = available.filter(
    (n) => n.toLowerCase().startsWith(`${q}:`) || q.startsWith(`${n.toLowerCase()}:`),
  );
  return prefix.length === 1 ? prefix[0] : undefined;
}

export interface CompareModelResult {
  model: string;
  content?: string;
  thinking?: string;
  tok_s?: number;
  eval_count?: number;
  eval_duration?: number;
  total_duration?: number;
  load_duration?: number;
  wall_ms?: number;
  done_reason?: string;
  error?: string;
}

export interface CompareRecord {
  id: string;
  created_at: string;
  machine: string;
  endpoint: string;
  prompt: string;
  /** True when the built-in default prompt was used. */
  default_prompt: boolean;
  system?: string;
  results: CompareModelResult[];
  files?: { json: string; md: string };
}

export interface CompareOptions {
  machine: string;
  models: string[];
  prompt?: string;
  file?: string;
  settings?: GenerateSettings;
  save?: boolean;
  unload?: boolean;
  writeStdout?: boolean;
  quiet?: boolean;
  config?: Partial<AppConfig>;
  timeoutMs?: number;
}

function printSummary(record: CompareRecord): void {
  const nameWidth = Math.max(8, ...record.results.map((r) => r.model.length));
  process.stderr.write(
    `Compare on ${record.machine}  ${record.results.length} models  ${record.prompt.length} char prompt\n`,
  );
  process.stderr.write(
    `${"model".padEnd(nameWidth)}  ${"tok/s".padStart(7)}  ${"tokens".padStart(6)}  ${"wall".padStart(7)}  done\n`,
  );
  for (const r of record.results) {
    if (r.error) {
      process.stderr.write(`${r.model.padEnd(nameWidth)}  ERROR  ${r.error}\n`);
      continue;
    }
    const toks = r.tok_s != null ? r.tok_s.toFixed(1) : "—";
    const tokens = r.eval_count != null ? String(r.eval_count) : "—";
    const wall = r.wall_ms != null ? `${(r.wall_ms / 1000).toFixed(2)}s` : "—";
    process.stderr.write(
      `${r.model.padEnd(nameWidth)}  ${toks.padStart(7)}  ${tokens.padStart(6)}  ${wall.padStart(7)}  ${r.done_reason ?? "—"}\n`,
    );
  }
}

export async function runCompare(opts: CompareOptions): Promise<CompareRecord> {
  const models = opts.models.map((m) => m.trim()).filter(Boolean);
  if (models.length < MIN_MODELS || models.length > MAX_MODELS) {
    throw new Error(`Compare needs ${MIN_MODELS}–${MAX_MODELS} models (got ${models.length}).`);
  }

  let fileText: string | undefined;
  if (opts.file) {
    fileText = await readPromptFile(opts.file);
  }
  const assembled = assemblePrompt({ argv: opts.prompt, file: fileText });
  const defaulted = !assembled;
  const prompt = assembled || DEFAULT_COMPARE_PROMPT;

  const config = opts.config ? configFromPartial(opts.config) : await loadConfig();
  const host = await resolveTarget(opts.machine, config);

  const baseUrl = ollamaBaseUrl(host);
  const timeoutMs = opts.timeoutMs ?? compareTimeoutMs();
  let available: string[] | null = null;
  try {
    available = (await ollamaTags(baseUrl, Math.min(timeoutMs || 5000, 10_000))).map((t) => t.name);
  } catch {
    available = null;
  }

  const resolved: string[] = [];
  for (const name of models) {
    if (available) {
      const hit = resolveModelName(available, name);
      if (!hit) {
        throw new Error(`Unknown model "${name}" on ${shortName(host)}. Available: ${available.join(", ")}`);
      }
      resolved.push(hit);
    } else {
      resolved.push(name);
    }
  }

  const settings = mergeSettings(
    { think: false },
    config.defaults,
    machineSettingsForHost(config, host),
    settingsFromEnv(),
    opts.settings,
  );

  const quiet = opts.quiet === true || opts.writeStdout === false;
  const results: CompareModelResult[] = [];

  for (let i = 0; i < resolved.length; i += 1) {
    const model = resolved[i]!;
    if (!quiet) {
      process.stderr.write(`→ ${model} (${i + 1}/${resolved.length})\n`);
    }
    const started = Date.now();
    try {
      const { content, thinking, chunk } = await ollamaChat({
        baseUrl,
        model,
        messages: [
          ...(settings.system ? [{ role: "system", content: settings.system }] : []),
          { role: "user", content: prompt },
        ],
        stream: false,
        writeStdout: false,
        timeoutMs,
        settings,
      });
      results.push({
        model,
        content,
        thinking: thinking || undefined,
        tok_s: tokPerSec(chunk),
        eval_count: chunk.eval_count,
        eval_duration: chunk.eval_duration,
        total_duration: chunk.total_duration,
        load_duration: chunk.load_duration,
        wall_ms: Date.now() - started,
        done_reason: chunk.done_reason,
      });
    } catch (err) {
      results.push({
        model,
        wall_ms: Date.now() - started,
        error: err instanceof Error ? err.message : String(err),
      });
    }

    if (opts.unload && i < resolved.length - 1) {
      try {
        await ollamaUnload(baseUrl, model, Math.min(timeoutMs || 30_000, 30_000));
        await waitUntilUnloaded(baseUrl, model, unloadWaitMs());
      } catch {
        // Fairness hint only — do not fail the compare.
      }
    }
  }

  const record: CompareRecord = {
    id: newCompareId(),
    created_at: new Date().toISOString(),
    machine: shortName(host),
    endpoint: baseUrl,
    prompt,
    default_prompt: defaulted,
    system: settings.system,
    results,
  };

  if (opts.save !== false) {
    record.files = await saveCompare(record);
  }
  return record;
}

export async function main(): Promise<void> {
  const parsed = parseArgs(process.argv.slice(2));
  if (!parsed.machine) {
    console.error("Machine is required.");
    usage();
  }

  const config = await loadConfig();
  const alias = lookupAlias(config, parsed.machine);
  const machine = alias ? alias.machine : parsed.machine;
  let models = [...parsed.models];
  if (alias && models.length === 1) {
    // `compare desk other:7b` → alias model vs other on alias host
    models = [alias.model, models[0]!];
  }

  const { stdin: stdinStream } = await import("node:process");
  let fromStdin = "";
  if (!stdinStream.isTTY) {
    const chunks: Buffer[] = [];
    for await (const chunk of stdinStream) chunks.push(chunk as Buffer);
    fromStdin = Buffer.concat(chunks).toString("utf8").trim();
  }

  let fileText: string | undefined;
  if (parsed.file) {
    try {
      fileText = await readPromptFile(parsed.file);
    } catch (err) {
      console.error(err instanceof Error ? err.message : err);
      process.exitCode = 1;
      return;
    }
  }

  const prompt = assemblePrompt({ argv: parsed.prompt, file: fileText, stdin: fromStdin });

  const record = await runCompare({
    machine,
    models,
    prompt: prompt || undefined,
    settings: parsed.settings,
    save: parsed.save,
    unload: parsed.unload,
    writeStdout: !parsed.json,
    quiet: parsed.json,
    config,
  });

  if (record.default_prompt) {
    process.stderr.write(
      "Using default compare prompt (pass --prompt or --file to override).\n",
    );
  }

  if (parsed.json) {
    process.stdout.write(`${JSON.stringify(record, null, 2)}\n`);
    return;
  }

  printSummary(record);
  if (record.files) {
    process.stderr.write(`saved ${record.files.md}\n`);
    process.stderr.write(`      ${record.files.json}\n`);
    process.stderr.write(`compares dir: ${comparesDir()}\n`);
  }
}
