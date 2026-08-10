#!/usr/bin/env node
/**
 * ollanet bench — speed + lightweight quality suite against Ollama models.
 */
import {
  defaultModelForHost,
  loadConfig,
  machineSettingsForHost,
  mergeSettings,
  settingsFromEnv,
  type GenerateSettings,
} from "./config.ts";
import {
  comparabilityKey,
  getSuiteCases,
  median,
  suiteRevision,
  type BenchCase,
  type SuiteName,
} from "./bench-suite.ts";
import { benchmarksDir, newBenchId, saveBenchmark } from "./bench-store.ts";
import { readFile } from "node:fs/promises";
import {
  discoverHosts,
  envInt,
  ollamaBaseUrl,
  resolveHost,
  shortName,
  type HostTarget,
} from "./hosts.ts";
import { projectPath } from "./paths.ts";
import {
  contextLengthForModel,
  isCompletionCapable,
  isVisionCapable,
  ollamaChat,
  ollamaShow,
  ollamaTags,
  ollamaUnload,
  ollamaVersion,
  ollamaPs,
  psHasModel,
  shouldWarnNoThinking,
  vramForModel,
  waitUntilUnloaded,
  type OllamaModelInfo,
} from "./ollama-chat.ts";

const MODEL_COL = 34;

const BENCH_TIMEOUT_MS = envInt("OLLAMA_BENCH_TIMEOUT_MS", 60_000);
const UNLOAD_WAIT_MS = envInt("OLLAMA_BENCH_UNLOAD_WAIT_MS", 60_000);

interface AttemptResult {
  run: number;
  wall_ms: number;
  tok_s?: number;
  done_reason?: string;
  early_stop?: boolean;
  quality?: { pass: boolean; checks: Array<{ id: string; ok: boolean; detail?: string }> };
  content?: string;
  ollama?: Record<string, unknown>;
  error?: string;
  judge_score?: number;
}

interface CaseResult {
  id: string;
  role: string;
  attempts: AttemptResult[];
}

interface ModelResult {
  name: string;
  digest?: string;
  parameter_size?: string;
  quantization_level?: string;
  /** Omitted / empty from /api/show means unknown (treated as completion-capable). */
  capabilities?: string[];
  size_vram?: number;
  /** From /api/ps while loaded — actual context in effect for this run. */
  context_length?: number;
  cold_load: {
    load_ms: number;
    ollama?: Record<string, unknown>;
    ps_poll_ms?: number;
    error?: string;
  } | null;
  summary: {
    tok_s_median: number | null;
    tok_s_min: number | null;
    tok_s_max: number | null;
    early_stop_count: number;
    pass_rate: number | null;
    load_ms: number | null;
    self_judge: boolean;
  };
  error?: string;
  cases: CaseResult[];
}

function usage(): never {
  console.error(`Usage:
  ollanet bench <machine|ip> [model...] [options]
  ollanet bench <machine|ip> --all [options]

Options:
  --all                 Every completion-capable model from /api/tags
  --exclude-vision      With --all, skip models that advertise vision
  --suite quick|full    Prompt suite (default quick)
  --runs <n>            Throughput repeats (default 3)
  --warmup / --no-warmup
  --cold-load           Measure cold load via unload + /api/ps
  --num-predict <n>     Pin throughput length (default 256)
  --num-ctx <n>
  --keep-alive <value>
  --think / --no-think
  --judge --judge-model <name>
  --json                Machine-readable stdout
  --save / --no-save
  --fail-fast
  --fail-on-error       Exit 2 if any model/case errored

See docs/bench-spec.md for measurement rules.`);
  process.exit(1);
}

function takeValue(args: string[], flag: string): string {
  const value = args.shift();
  if (!value) {
    console.error(`${flag} requires a value`);
    usage();
  }
  return value;
}

function parseNumberFlag(raw: string, flag: string): number {
  const n = Number(raw);
  if (!Number.isFinite(n)) {
    console.error(`${flag} must be a number (got "${raw}")`);
    usage();
  }
  return n;
}

function isLoopback(host: HostTarget): boolean {
  return (
    host.source === "localhost" ||
    host.ip === "127.0.0.1" ||
    host.ip === "::1" ||
    shortName(host).toLowerCase() === "localhost"
  );
}

function resolveModelName(tags: OllamaModelInfo[], query: string): string | undefined {
  const q = query.toLowerCase();
  const exact = tags.find((t) => t.name.toLowerCase() === q);
  if (exact) return exact.name;
  const prefix = tags.find(
    (t) => t.name.toLowerCase().startsWith(`${q}:`) || q.startsWith(`${t.name.toLowerCase()}:`),
  );
  return prefix?.name;
}

function tokPerSec(chunk: { eval_count?: number; eval_duration?: number }): number | undefined {
  if (chunk.eval_count == null || chunk.eval_duration == null || chunk.eval_duration <= 0) {
    return undefined;
  }
  return chunk.eval_count / (chunk.eval_duration / 1e9);
}

function parseJudgeScore(content: string): number | undefined {
  const m = content.trim().match(/\b([1-5])\b/);
  if (!m) return undefined;
  return Number(m[1]);
}

function parseArgs(argv: string[]) {
  const args = [...argv];
  let suite: SuiteName = "quick";
  let runs = 3;
  let all = false;
  let excludeVision = false;
  let warmup = true;
  let coldLoad = false;
  let json = false;
  let save = true;
  let failFast = false;
  let failOnError = false;
  let judge = false;
  let judgeModel: string | undefined;
  let throughputNumPredict = 256;
  const settings: GenerateSettings = {};
  const positional: string[] = [];

  while (args.length > 0) {
    const arg = args.shift()!;
    if (arg === "--" || arg === "--help" || arg === "-h") usage();
    if (arg === "--all") {
      all = true;
      continue;
    }
    if (arg === "--exclude-vision") {
      excludeVision = true;
      continue;
    }
    // Back-compat no-op: 0.2.0 defaulted to skipping vision; prefer --exclude-vision.
    if (arg === "--include-vision") {
      excludeVision = false;
      continue;
    }
    if (arg === "--json") {
      json = true;
      continue;
    }
    if (arg === "--save") {
      save = true;
      continue;
    }
    if (arg === "--no-save") {
      save = false;
      continue;
    }
    if (arg === "--warmup") {
      warmup = true;
      continue;
    }
    if (arg === "--no-warmup") {
      warmup = false;
      continue;
    }
    if (arg === "--cold-load") {
      coldLoad = true;
      continue;
    }
    if (arg === "--fail-fast") {
      failFast = true;
      continue;
    }
    if (arg === "--fail-on-error") {
      failOnError = true;
      continue;
    }
    if (arg === "--think") {
      settings.think = true;
      continue;
    }
    if (arg === "--no-think") {
      settings.think = false;
      continue;
    }
    if (arg === "--judge") {
      judge = true;
      continue;
    }
    if (arg === "--suite" || arg.startsWith("--suite=")) {
      const raw = arg.includes("=") ? arg.slice("--suite=".length) : takeValue(args, "--suite");
      if (raw !== "quick" && raw !== "full") {
        console.error(`Unknown suite "${raw}" (use quick|full)`);
        usage();
      }
      suite = raw;
      continue;
    }
    if (arg === "--runs" || arg.startsWith("--runs=")) {
      const raw = arg.includes("=") ? arg.slice("--runs=".length) : takeValue(args, "--runs");
      runs = Math.max(1, Math.trunc(parseNumberFlag(raw, "--runs")));
      continue;
    }
    if (arg === "--num-predict" || arg.startsWith("--num-predict=")) {
      const raw = arg.includes("=")
        ? arg.slice("--num-predict=".length)
        : takeValue(args, "--num-predict");
      throughputNumPredict = Math.trunc(parseNumberFlag(raw, "--num-predict"));
      continue;
    }
    if (arg === "--num-ctx" || arg.startsWith("--num-ctx=")) {
      const raw = arg.includes("=") ? arg.slice("--num-ctx=".length) : takeValue(args, "--num-ctx");
      settings.num_ctx = Math.trunc(parseNumberFlag(raw, "--num-ctx"));
      continue;
    }
    if (arg === "--keep-alive" || arg.startsWith("--keep-alive=")) {
      const raw = arg.includes("=")
        ? arg.slice("--keep-alive=".length)
        : takeValue(args, "--keep-alive");
      const asNum = Number(raw);
      settings.keep_alive =
        raw.trim() !== "" && Number.isFinite(asNum) && String(asNum) === raw ? asNum : raw;
      continue;
    }
    if (arg === "--judge-model" || arg.startsWith("--judge-model=")) {
      judgeModel = arg.includes("=")
        ? arg.slice("--judge-model=".length)
        : takeValue(args, "--judge-model");
      continue;
    }
    if (arg.startsWith("-")) {
      console.error(`Unknown flag: ${arg}`);
      usage();
    }
    positional.push(arg);
  }

  if (positional.length < 1) usage();
  const machine = positional[0]!;
  const models = positional.slice(1);
  if (judge && !judgeModel) {
    console.error("--judge requires --judge-model <name> (no default).");
    process.exit(1);
  }
  if (throughputNumPredict < 64) {
    console.error(
      `Warning: --num-predict ${throughputNumPredict} is very short; tok/s will be mostly overhead. Prefer ≥64 (default 256).`,
    );
  }

  return {
    machine,
    models,
    all,
    excludeVision,
    suite,
    runs,
    warmup,
    coldLoad,
    json,
    save,
    failFast,
    failOnError,
    judge,
    judgeModel,
    throughputNumPredict,
    settings,
  };
}

/**
 * Raw capabilities from /api/show. `undefined` = key absent / show failed
 * (omitempty) → treat as completion-capable. Empty array is also permissive.
 */
async function fetchCapabilities(
  baseUrl: string,
  name: string,
): Promise<string[] | undefined> {
  try {
    const shown = await ollamaShow(baseUrl, name, Math.min(BENCH_TIMEOUT_MS, 10_000));
    if (!shown || !("capabilities" in shown) || shown.capabilities == null) {
      return undefined;
    }
    return shown.capabilities;
  } catch {
    return undefined;
  }
}

async function runColdLoad(
  baseUrl: string,
  model: string,
  keepAlive: GenerateSettings["keep_alive"],
): Promise<ModelResult["cold_load"]> {
  const started = Date.now();
  try {
    let ps = await ollamaPs(baseUrl, 5000);
    if (psHasModel(ps, model)) {
      await ollamaUnload(baseUrl, model, BENCH_TIMEOUT_MS);
      const waited = await waitUntilUnloaded(baseUrl, model, UNLOAD_WAIT_MS);
      if (!waited.unloaded) {
        return { load_ms: 0, error: `unload timed out after ${waited.waitedMs}ms`, ps_poll_ms: waited.waitedMs };
      }
    }
    const wall0 = Date.now();
    const { chunk } = await ollamaChat({
      baseUrl,
      model,
      messages: [{ role: "user", content: "x" }],
      stream: false,
      writeStdout: false,
      timeoutMs: BENCH_TIMEOUT_MS,
      settings: {
        temperature: 0,
        seed: 0,
        num_predict: 1,
        think: false,
        keep_alive: keepAlive ?? "5m",
      },
    });
    const loadNs = chunk.load_duration ?? 0;
    const loadMs = loadNs / 1e6;
    return {
      load_ms: loadMs,
      ollama: {
        load_duration: chunk.load_duration,
        eval_count: chunk.eval_count,
        total_duration: chunk.total_duration,
      },
      ps_poll_ms: Date.now() - started - (Date.now() - wall0),
    };
  } catch (err) {
    return {
      load_ms: 0,
      error: err instanceof Error ? err.message : String(err),
      ps_poll_ms: Date.now() - started,
    };
  }
}

async function runCaseAttempt(opts: {
  baseUrl: string;
  model: string;
  caseDef: BenchCase;
  run: number;
  settings: GenerateSettings;
  throughputNumPredict: number;
  judgeModel?: string;
  selfJudge: boolean;
}): Promise<AttemptResult> {
  const numPredict =
    opts.caseDef.role === "throughput"
      ? opts.throughputNumPredict
      : (opts.caseDef.num_predict ?? 32);

  const settings = mergeSettings(opts.settings, {
    temperature: 0,
    seed: 0,
    num_predict: numPredict,
    think: opts.settings.think === true,
    ...(opts.caseDef.format ? { format: opts.caseDef.format } : {}),
  });

  const wall0 = Date.now();
  try {
    const { content, chunk } = await ollamaChat({
      baseUrl: opts.baseUrl,
      model: opts.model,
      messages: [{ role: "user", content: opts.caseDef.prompt }],
      stream: false,
      writeStdout: false,
      timeoutMs: BENCH_TIMEOUT_MS,
      settings,
    });
    const wallMs = Date.now() - wall0;
    const doneReason = chunk.done_reason;
    const earlyStop =
      opts.caseDef.role === "throughput" && doneReason != null && doneReason !== "length";
    const tok_s = opts.caseDef.role === "throughput" ? tokPerSec(chunk) : undefined;

    let quality: AttemptResult["quality"];
    if (opts.caseDef.check) {
      const result = opts.caseDef.check(content);
      quality = {
        pass: result.ok,
        checks: [{ id: opts.caseDef.id, ok: result.ok, detail: result.detail }],
      };
    }

    let judge_score: number | undefined;
    if (opts.judgeModel && opts.caseDef.role === "check" && quality?.pass) {
      try {
        const judged = await ollamaChat({
          baseUrl: opts.baseUrl,
          model: opts.judgeModel,
          stream: false,
          writeStdout: false,
          timeoutMs: BENCH_TIMEOUT_MS,
          settings: { temperature: 0, seed: 0, num_predict: 8, think: false },
          messages: [
            {
              role: "user",
              content:
                "Score the assistant reply from 1-5 for correctness and instruction-following. " +
                "Reply with only the integer.\n\n" +
                `User: ${opts.caseDef.prompt}\nAssistant: ${content}`,
            },
          ],
        });
        judge_score = parseJudgeScore(judged.content);
      } catch {
        // omit score
      }
    }

    return {
      run: opts.run,
      wall_ms: wallMs,
      tok_s,
      done_reason: doneReason,
      early_stop: earlyStop || undefined,
      quality,
      content,
      judge_score,
      ollama: {
        eval_count: chunk.eval_count,
        eval_duration: chunk.eval_duration,
        load_duration: chunk.load_duration,
        total_duration: chunk.total_duration,
        prompt_eval_count: chunk.prompt_eval_count,
        done_reason: chunk.done_reason,
      },
    };
  } catch (err) {
    return {
      run: opts.run,
      wall_ms: Date.now() - wall0,
      error: err instanceof Error ? err.message : String(err),
    };
  }
}

function summarizeModel(cases: CaseResult[], cold: ModelResult["cold_load"], selfJudge: boolean) {
  const throughput = cases.find((c) => c.id === "throughput");
  const fullLen = throughput?.attempts.filter(
    (a) => !a.error && !a.early_stop && a.tok_s != null,
  ) ?? [];
  const toks = fullLen.map((a) => a.tok_s!);
  const earlyStopCount =
    throughput?.attempts.filter((a) => a.early_stop || (a.done_reason && a.done_reason !== "length"))
      .length ?? 0;

  const checkAttempts = cases
    .filter((c) => c.role === "check")
    .flatMap((c) => c.attempts)
    .filter((a) => !a.error && a.quality);
  const passed = checkAttempts.filter((a) => a.quality?.pass).length;
  const passRate = checkAttempts.length > 0 ? passed / checkAttempts.length : null;

  return {
    tok_s_median: median(toks) ?? null,
    tok_s_min: toks.length ? Math.min(...toks) : null,
    tok_s_max: toks.length ? Math.max(...toks) : null,
    early_stop_count: earlyStopCount,
    pass_rate: passRate,
    load_ms:
      cold && cold.error == null && cold.load_ms > 0 ? cold.load_ms : cold?.error ? null : cold?.load_ms ?? null,
    self_judge: selfJudge,
  };
}

function printTable(
  machine: string,
  suite: SuiteName,
  runs: number,
  revision: string,
  compKey: string,
  models: ModelResult[],
  skipped: Array<{ name: string; reason: string }>,
  coldLoad: boolean,
) {
  const lines: string[] = [];
  lines.push(
    `Bench: ${models.length} completion model(s) × suite=${suite} × runs=${runs}`,
  );
  lines.push(`comparability_key=${compKey}   suite_revision=${revision}   timeout: ${BENCH_TIMEOUT_MS}ms/case`);
  if (coldLoad) lines.push("Cold-load: on");
  lines.push("");

  const header = coldLoad
    ? pad("Model", MODEL_COL) +
      pad("tok/s (med)", 12) +
      pad("spread", 12) +
      pad("load", 8) +
      pad("pass", 8) +
      "notes"
    : pad("Model", MODEL_COL) +
      pad("tok/s (med)", 12) +
      pad("spread", 12) +
      pad("pass", 8) +
      "notes";
  lines.push(header);

  const sorted = [...models].sort((a, b) => {
    const pa = a.summary.pass_rate;
    const pb = b.summary.pass_rate;
    if (pa == null && pb == null) {
      /* both unknown */
    } else if (pa == null) return 1;
    else if (pb == null) return -1;
    else if (pb !== pa) return pb - pa;

    // Unavailable tok/s (all early-stop / errors) intentionally sinks below any
    // defined median, including 0 — same pass_rate cohort, then speed.
    const ta = a.summary.tok_s_median;
    const tb = b.summary.tok_s_median;
    if (ta == null && tb == null) return 0;
    if (ta == null) return 1;
    if (tb == null) return -1;
    return tb - ta;
  });

  for (const m of sorted) {
    const tok =
      m.summary.tok_s_median != null ? m.summary.tok_s_median.toFixed(1) : "—";
    // Match median precision — toFixed(0) on min/max can print "83.8  84–86".
    const spread =
      m.summary.tok_s_min != null && m.summary.tok_s_max != null
        ? `${m.summary.tok_s_min.toFixed(1)}–${m.summary.tok_s_max.toFixed(1)}`
        : "—";
    const pass =
      m.summary.pass_rate != null
        ? `${Math.round(m.summary.pass_rate * checkDenom(m))}/${checkDenom(m)}`
        : "—";
    const notes: string[] = [];
    if (m.error) notes.push(m.error.slice(0, 60));
    if (m.summary.early_stop_count > 0) notes.push(`${m.summary.early_stop_count}× early-stop`);
    if (m.summary.self_judge) notes.push("self-judge");
    const load =
      m.summary.load_ms != null && m.summary.load_ms > 0
        ? `${(m.summary.load_ms / 1000).toFixed(1)}s`
        : "—";
    const row = coldLoad
      ? pad(m.name, MODEL_COL) +
        pad(tok, 12) +
        pad(spread, 12) +
        pad(load, 8) +
        pad(pass, 8) +
        notes.join("; ")
      : pad(m.name, MODEL_COL) +
        pad(tok, 12) +
        pad(spread, 12) +
        pad(pass, 8) +
        notes.join("; ");
    lines.push(row);
  }

  if (skipped.length > 0) {
    lines.push("");
    const byReason = (reason: string) => skipped.filter((s) => s.reason === reason);
    const embed = byReason("non-completion");
    const vision = byReason("vision");
    if (embed.length) {
      lines.push(`Skipped ${embed.length} non-completion model(s): ${embed.map((s) => s.name).join(", ")}`);
    }
    if (vision.length) {
      lines.push(
        `Skipped ${vision.length} vision model(s): ${vision.map((s) => s.name).join(", ")}` +
          " (--exclude-vision)",
      );
    }
  }

  process.stdout.write(`${lines.join("\n")}\n`);
}

function checkDenom(m: ModelResult): number {
  return m.cases.filter((c) => c.role === "check").flatMap((c) => c.attempts).length || 0;
}

function pad(s: string, n: number): string {
  return s.length >= n ? `${s.slice(0, n - 1)} ` : s + " ".repeat(n - s.length);
}

export async function main(): Promise<void> {
  const parsed = parseArgs(process.argv.slice(2));
  const config = await loadConfig();
  const { hosts: targets } = await discoverHosts({
    hosts: config.hosts,
    discovery: config.discovery,
  });
  const host = resolveHost(targets, parsed.machine);
  const baseUrl = ollamaBaseUrl(host);
  const machineLabel = shortName(host);

  const tags = await ollamaTags(baseUrl, Math.min(BENCH_TIMEOUT_MS, 15_000));
  if (tags.length === 0) {
    throw new Error(`No models on ${machineLabel} (${baseUrl})`);
  }

  const tagNames = tags.map((t) => t.name);
  const skipped: Array<{ name: string; reason: string; capabilities: string[] }> = [];
  let selected: string[] = [];

  if (parsed.all) {
    for (const t of tags) {
      const caps = await fetchCapabilities(baseUrl, t.name);
      if (!isCompletionCapable(caps)) {
        skipped.push({ name: t.name, reason: "non-completion", capabilities: caps ?? [] });
        continue;
      }
      // Default: completion only (spec). Vision+completion models (gemma3, etc.)
      // stay in --all; early-stop / pass_rate report text-suite failures.
      // Opt out of vision-capable models with --exclude-vision.
      if (parsed.excludeVision && isVisionCapable(caps)) {
        skipped.push({ name: t.name, reason: "vision", capabilities: caps ?? [] });
        continue;
      }
      selected.push(t.name);
    }
  } else if (parsed.models.length > 0) {
    for (const q of parsed.models) {
      const resolved = resolveModelName(tags, q);
      if (!resolved) {
        console.error(`Unknown model "${q}". Available: ${tagNames.join(", ")}`);
        process.exit(1);
      }
      const caps = await fetchCapabilities(baseUrl, resolved);
      if (!isCompletionCapable(caps)) {
        console.error(
          `Model "${resolved}" is not completion-capable (${(caps ?? []).join(", ") || "none"}).`,
        );
        process.exit(1);
      }
      selected.push(resolved);
    }
  } else {
    const def = defaultModelForHost(config, host);
    if (!def) {
      console.error(
        `No model specified for "${machineLabel}". Pass model names, use --all, or set defaultModels.`,
      );
      process.exit(1);
    }
    const name = resolveModelName(tags, def);
    if (!name) {
      console.error(`Default model "${def}" not found on host. Available: ${tagNames.join(", ")}`);
      process.exit(1);
    }
    const caps = await fetchCapabilities(baseUrl, name);
    if (!isCompletionCapable(caps)) {
      console.error(`Default model "${name}" is not completion-capable.`);
      process.exit(1);
    }
    selected = [name];
  }

  if (selected.length === 0) {
    console.error("No completion models to benchmark.");
    process.exit(1);
  }

  let judgeModel: string | undefined;
  if (parsed.judge && parsed.judgeModel) {
    judgeModel = resolveModelName(tags, parsed.judgeModel);
    if (!judgeModel) {
      console.error(`Judge model "${parsed.judgeModel}" not found.`);
      process.exit(1);
    }
  }

  const baseSettings = mergeSettings(
    config.defaults,
    machineSettingsForHost(config, host),
    settingsFromEnv(),
    parsed.settings,
    { think: parsed.settings.think === true ? true : false },
  );

  const revision = suiteRevision(parsed.suite);
  const compKey = comparabilityKey({
    suite: parsed.suite,
    throughputNumPredict: parsed.throughputNumPredict,
    seed: 0,
    temperature: 0,
    think: baseSettings.think === true,
    numCtx: baseSettings.num_ctx ?? null,
  });

  const suiteCases = getSuiteCases(parsed.suite);
  const caseCount =
    selected.length *
    (suiteCases.filter((c) => c.role !== "throughput").length +
      suiteCases.filter((c) => c.role === "throughput").length * parsed.runs);

  if (!parsed.json) {
    const skipBits = [
      skipped.filter((s) => s.reason === "non-completion").length
        ? `${skipped.filter((s) => s.reason === "non-completion").length} embedding/other`
        : "",
      skipped.filter((s) => s.reason === "vision").length
        ? `${skipped.filter((s) => s.reason === "vision").length} vision`
        : "",
    ].filter(Boolean);
    console.error(
      `Bench: ${selected.length} completion model(s)` +
        (skipBits.length ? ` (skipped ${skipBits.join(", ")})` : "") +
        ` × suite=${parsed.suite} × runs=${parsed.runs}`,
    );
    console.error(
      `Cases: ~${caseCount} chat calls   timeout: ${BENCH_TIMEOUT_MS}ms/case` +
        `   worst-case ceiling: ~${Math.ceil((caseCount * BENCH_TIMEOUT_MS) / 60000)}m if every call times out`,
    );
    if (!isLoopback(host)) {
      console.error(
        `Note: benchmarking unloads models on ${machineLabel} between runs` +
          (parsed.coldLoad ? " (and for --cold-load)" : "") +
          ".",
      );
    }
    console.error("Proceeding…");
  }

  if (parsed.settings.think === true) {
    for (const name of selected) {
      const caps = await fetchCapabilities(baseUrl, name);
      if (shouldWarnNoThinking(caps)) {
        console.error(`Warning: ${name} has no thinking capability; --think may 400.`);
      }
    }
  }

  const ollamaVer = await ollamaVersion(baseUrl, 5000);
  const modelResults: ModelResult[] = [];
  let anyError = false;

  for (let mi = 0; mi < selected.length; mi += 1) {
    const model = selected[mi]!;
    const info = tags.find((t) => t.name === model);
    const caps = await fetchCapabilities(baseUrl, model);
    const selfJudge = Boolean(judgeModel && judgeModel === model);

    if (!parsed.json) {
      console.error(`\n→ ${model} (${mi + 1}/${selected.length})`);
    }

    const cold: ModelResult["cold_load"] = parsed.coldLoad
      ? await runColdLoad(baseUrl, model, baseSettings.keep_alive)
      : null;
    if (cold?.error) anyError = true;

    if (parsed.warmup) {
      try {
        await ollamaChat({
          baseUrl,
          model,
          messages: [{ role: "user", content: "hi" }],
          stream: false,
          writeStdout: false,
          timeoutMs: BENCH_TIMEOUT_MS,
          settings: mergeSettings(baseSettings, {
            temperature: 0,
            seed: 0,
            num_predict: 8,
            think: false,
          }),
        });
      } catch {
        // warmup failure will likely repeat on cases
      }
    }

    const cases: CaseResult[] = [];
    let modelError: string | undefined;

    for (const caseDef of suiteCases) {
      const attempts: AttemptResult[] = [];
      const reps = caseDef.role === "throughput" ? parsed.runs : 1;
      for (let r = 1; r <= reps; r += 1) {
        const attempt = await runCaseAttempt({
          baseUrl,
          model,
          caseDef,
          run: r,
          settings: baseSettings,
          throughputNumPredict: parsed.throughputNumPredict,
          judgeModel,
          selfJudge,
        });
        attempts.push(attempt);
        if (attempt.error) {
          anyError = true;
          if (!modelError) modelError = attempt.error;
          if (parsed.failFast) break;
        }
      }
      cases.push({ id: caseDef.id, role: caseDef.role, attempts });
      if (parsed.failFast && modelError) break;
    }

    // Capture VRAM + context while still loaded (after timed cases, before unload).
    const ps = await ollamaPs(baseUrl, 5000);
    const summary = summarizeModel(cases, cold, selfJudge);
    if (cold && !cold.error && cold.load_ms > 0) {
      summary.load_ms = cold.load_ms;
    } else if (!parsed.coldLoad) {
      summary.load_ms = null;
    } else if (cold?.error) {
      summary.load_ms = null;
    }

    modelResults.push({
      name: model,
      digest: info?.digest,
      parameter_size: info?.details?.parameter_size,
      quantization_level: info?.details?.quantization_level,
      ...(caps ? { capabilities: caps } : {}),
      size_vram: vramForModel(ps, model),
      context_length: contextLengthForModel(ps, model),
      cold_load: cold,
      summary,
      error: modelError,
      cases,
    });

    if (parsed.failFast && modelError) break;

    // Unload before next model when ≥2 models remain after this one / multi-model run
    if (selected.length >= 2 && mi < selected.length - 1) {
      try {
        await ollamaUnload(baseUrl, model, BENCH_TIMEOUT_MS);
        await waitUntilUnloaded(baseUrl, model, UNLOAD_WAIT_MS);
      } catch {
        // best-effort
      }
    }
  }

  let ollanetVersion = "0.2.0";
  try {
    const pkg = JSON.parse(await readFile(projectPath("package.json"), "utf8")) as {
      version?: string;
    };
    if (pkg.version) ollanetVersion = pkg.version;
  } catch {
    // keep fallback
  }

  const result = {
    id: newBenchId(),
    version: 1,
    created_at: new Date().toISOString(),
    ollanet: ollanetVersion,
    suite: parsed.suite,
    suite_revision: revision,
    comparability_key: compKey,
    runs: parsed.runs,
    machine: machineLabel,
    host: { ip: host.ip, port: host.port },
    ollama_version: ollamaVer,
    settings: {
      temperature: 0,
      seed: 0,
      throughput_num_predict: parsed.throughputNumPredict,
      num_ctx: baseSettings.num_ctx ?? null,
      warmup: parsed.warmup,
      cold_load: parsed.coldLoad,
      think: baseSettings.think === true,
      bench_timeout_ms: BENCH_TIMEOUT_MS,
    },
    skipped_models: skipped,
    judge: judgeModel
      ? {
          name: judgeModel,
          digest: tags.find((t) => t.name === judgeModel)?.digest,
        }
      : null,
    models: modelResults,
  };

  if (parsed.save) {
    const file = await saveBenchmark(result);
    if (!parsed.json) console.error(`saved ${file}`);
  }

  if (parsed.json) {
    process.stdout.write(`${JSON.stringify(result, null, 2)}\n`);
  } else {
    process.stdout.write("\n");
    printTable(
      machineLabel,
      parsed.suite,
      parsed.runs,
      revision,
      compKey,
      modelResults,
      skipped,
      parsed.coldLoad,
    );
    if (parsed.save) console.error(`benchmarks dir: ${benchmarksDir()}`);
  }

  if (parsed.failOnError && anyError) {
    process.exitCode = 2;
  }
}
