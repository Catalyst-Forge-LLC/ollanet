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
  LONG_THROUGHPUT_NUM_PREDICT,
  median,
  suiteRevision,
  type BenchCase,
  type SuiteName,
} from "./bench-suite.ts";
import { benchmarksDir, newBenchId, saveBenchmark } from "./bench-store.ts";
import { readFile } from "node:fs/promises";
import { envInt, ollamaBaseUrl, shortName, type HostTarget } from "./hosts.ts";
import { consumeSettingsFlag, failUsage, isHelpFlag, parseNumberFlag, printHelp, takeFlag } from "./argv.ts";
import { resolveTarget } from "./target.ts";
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
  /** First throughput shot under --hot; excluded from median/spread. */
  discarded?: boolean;
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
    tok_s_long_median: number | null;
    tok_s_long_min: number | null;
    tok_s_long_max: number | null;
    early_stop_count: number;
    pass_rate: number | null;
    load_ms: number | null;
    self_judge: boolean;
  };
  error?: string;
  cases: CaseResult[];
}

export function helpText(): string {
  return `Usage:
  ollanet bench <machine|ip> [model...] [options]
  ollanet bench <machine|ip> --all [options]

Examples:
  ollanet bench studio gemma3:12b --runs 5
  ollanet bench studio gemma3:12b --hot --runs 5
  ollanet help bench

Fixed suite (not compare). Checks run once; 256-token throughput repeats --runs times.
Median tok/s excludes early-stops. Unload is between models, not between repeats.
full adds json/reason checks plus one 1024-token prose generation (tok/s long).

Options:
  --all                 Every completion-capable model from /api/tags
  --exclude-vision      With --all, skip models that advertise vision
  --suite quick|full    Prompt suite (default quick)
  --runs <n>            Counted 256-token throughput repeats (default 3)
  --hot                 Discard first 256-token throughput run; keep models loaded
  --warmup              Short discarded call before timed cases (default on)
  --no-warmup           Skip the short warmup (--hot implies this)
  --cold-load           Measure cold load via unload + /api/ps
  --num-predict <n>     Pin 256-token throughput length (default 256; not the long case)
  --num-ctx <n>         Context window override
  --keep-alive <value>  Keep model loaded (e.g. 5m, 0, -1)
  --think / --no-think  Thinking tokens (default off)
  --judge               Second pass: score check answers 1–5
  --judge-model <name>  Required with --judge (no default)
  --json                Machine-readable stdout
  --save / --no-save    Persist under benchmarks/ (default on)
  --fail-fast           Stop remaining models after the first hard error
  --fail-on-error       Exit 2 if any model/case errored

See docs/bench-spec.md for measurement rules.`;
}

function usage(): never {
  failUsage(helpText());
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

function pinnedNumPredict(caseDef: BenchCase, throughputNumPredict: number): number {
  if (caseDef.role === "throughput") {
    return caseDef.num_predict ?? throughputNumPredict;
  }
  return caseDef.num_predict ?? 32;
}

/** At least the global timeout; longer pins need room to finish at ~8 tok/s. */
function attemptTimeoutMs(numPredict: number): number {
  return Math.max(BENCH_TIMEOUT_MS, Math.ceil(numPredict / 8) * 1000);
}

function caseReps(caseDef: BenchCase, runs: number, hot: boolean): number {
  if (caseDef.role !== "throughput") return 1;
  if (caseDef.repeats != null) return caseDef.repeats;
  return runs + (hot ? 1 : 0);
}

function discardFirstThroughput(caseDef: BenchCase, hot: boolean): boolean {
  return hot && caseDef.role === "throughput" && caseDef.repeats == null;
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
  let warmupSet = false;
  let hot = false;
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
    if (isHelpFlag(arg)) printHelp(helpText());
    if (arg === "--") usage();
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
      warmupSet = true;
      continue;
    }
    if (arg === "--no-warmup") {
      warmup = false;
      warmupSet = true;
      continue;
    }
    if (arg === "--hot") {
      hot = true;
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
    if (arg === "--judge") {
      judge = true;
      continue;
    }
    if (consumeSettingsFlag(arg, args, settings, usage)) {
      continue;
    }
    const suiteRaw = takeFlag(arg, "--suite", args, usage);
    if (suiteRaw !== undefined) {
      if (suiteRaw !== "quick" && suiteRaw !== "full") {
        console.error(`Unknown suite "${suiteRaw}" (use quick|full)`);
        usage();
      }
      suite = suiteRaw;
      continue;
    }
    const runsRaw = takeFlag(arg, "--runs", args, usage);
    if (runsRaw !== undefined) {
      runs = Math.max(1, Math.trunc(parseNumberFlag(runsRaw, "--runs", usage)));
      continue;
    }
    const predictRaw = takeFlag(arg, "--num-predict", args, usage);
    if (predictRaw !== undefined) {
      throughputNumPredict = Math.trunc(parseNumberFlag(predictRaw, "--num-predict", usage));
      continue;
    }
    const judgeRaw = takeFlag(arg, "--judge-model", args, usage);
    if (judgeRaw !== undefined) {
      judgeModel = judgeRaw;
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
    warmup: hot && !warmupSet ? false : warmup,
    hot,
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
  const numPredict = pinnedNumPredict(opts.caseDef, opts.throughputNumPredict);

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
      timeoutMs: attemptTimeoutMs(numPredict),
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

function countedAttempts(attempts: AttemptResult[]): AttemptResult[] {
  return attempts.filter((a) => !a.discarded);
}

function speedFrom(cases: CaseResult[], id: string) {
  const counted = countedAttempts(cases.find((c) => c.id === id)?.attempts ?? []);
  const fullLen = counted.filter((a) => !a.error && !a.early_stop && a.tok_s != null);
  const toks = fullLen.map((a) => a.tok_s!);
  return {
    median: median(toks) ?? null,
    min: toks.length ? Math.min(...toks) : null,
    max: toks.length ? Math.max(...toks) : null,
  };
}

function summarizeModel(cases: CaseResult[], cold: ModelResult["cold_load"], selfJudge: boolean) {
  const peak = speedFrom(cases, "throughput");
  const long = speedFrom(cases, "throughput_long");
  const throughputAttempts = cases
    .filter((c) => c.role === "throughput")
    .flatMap((c) => countedAttempts(c.attempts));
  const earlyStopCount = throughputAttempts.filter(
    (a) => a.early_stop || (a.done_reason && a.done_reason !== "length"),
  ).length;

  const checkAttempts = cases
    .filter((c) => c.role === "check")
    .flatMap((c) => c.attempts)
    .filter((a) => !a.error && a.quality);
  const passed = checkAttempts.filter((a) => a.quality?.pass).length;
  const passRate = checkAttempts.length > 0 ? passed / checkAttempts.length : null;

  return {
    tok_s_median: peak.median,
    tok_s_min: peak.min,
    tok_s_max: peak.max,
    tok_s_long_median: long.median,
    tok_s_long_min: long.min,
    tok_s_long_max: long.max,
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
  hot: boolean,
) {
  const lines: string[] = [];
  lines.push(
    `Bench: ${models.length} completion model(s) × suite=${suite} × runs=${runs}` +
      (hot ? " (hot: first discarded)" : ""),
  );
  lines.push(`comparability_key=${compKey}   suite_revision=${revision}   timeout: ${BENCH_TIMEOUT_MS}ms/case`);
  if (coldLoad) lines.push("Cold-load: on");
  if (hot) lines.push("Hot: first throughput run discarded; models stay loaded");
  if (suite === "full") lines.push("full: tok/s long is one 1024-token prose generation");
  lines.push("");

  const showLong = suite === "full";
  const header = coldLoad
    ? pad("Model", MODEL_COL) +
      pad("tok/s (med)", 12) +
      pad("spread", 12) +
      (showLong ? pad("tok/s long", 12) : "") +
      pad("load", 8) +
      pad("pass", 8) +
      "notes"
    : pad("Model", MODEL_COL) +
      pad("tok/s (med)", 12) +
      pad("spread", 12) +
      (showLong ? pad("tok/s long", 12) : "") +
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
    const tokLong =
      m.summary.tok_s_long_median != null ? m.summary.tok_s_long_median.toFixed(1) : "—";
    const pass =
      m.summary.pass_rate != null
        ? `${Math.round(m.summary.pass_rate * checkDenom(m))}/${checkDenom(m)}`
        : "—";
    const notes: string[] = [];
    if (m.error) notes.push(m.error.slice(0, 60));
    if (m.summary.early_stop_count > 0) notes.push(`${m.summary.early_stop_count}× early-stop`);
    if (hot) notes.push("hot");
    if (m.summary.self_judge) notes.push("self-judge");
    const load =
      m.summary.load_ms != null && m.summary.load_ms > 0
        ? `${(m.summary.load_ms / 1000).toFixed(1)}s`
        : "—";
    const row = coldLoad
      ? pad(m.name, MODEL_COL) +
        pad(tok, 12) +
        pad(spread, 12) +
        (showLong ? pad(tokLong, 12) : "") +
        pad(load, 8) +
        pad(pass, 8) +
        notes.join("; ")
      : pad(m.name, MODEL_COL) +
        pad(tok, 12) +
        pad(spread, 12) +
        (showLong ? pad(tokLong, 12) : "") +
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
  const host = await resolveTarget(parsed.machine, config);
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
    hot: parsed.hot,
  });

  const suiteCases = getSuiteCases(parsed.suite);
  const caseCount =
    selected.length *
    suiteCases.reduce((n, c) => n + caseReps(c, parsed.runs, parsed.hot), 0);
  const worstCaseMs =
    selected.length *
    suiteCases.reduce((n, c) => {
      const pin = pinnedNumPredict(c, parsed.throughputNumPredict);
      return n + caseReps(c, parsed.runs, parsed.hot) * attemptTimeoutMs(pin);
    }, 0);

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
        ` × suite=${parsed.suite} × runs=${parsed.runs}` +
        (parsed.hot ? " (hot: +1 discarded)" : ""),
    );
    console.error(
      `Cases: ~${caseCount} chat calls   timeout: ${BENCH_TIMEOUT_MS}ms/case` +
        (parsed.suite === "full"
          ? ` (long case ≥${attemptTimeoutMs(LONG_THROUGHPUT_NUM_PREDICT)}ms)`
          : "") +
        `   worst-case ceiling: ~${Math.ceil(worstCaseMs / 60000)}m if every call times out`,
    );
    if (!parsed.hot && !isLoopback(host) && (selected.length >= 2 || parsed.coldLoad)) {
      const bits = [
        selected.length >= 2 ? "unloads each model before the next" : "",
        parsed.coldLoad ? "unloads for --cold-load" : "",
      ].filter(Boolean);
      console.error(`Note: benchmarking ${bits.join(" and ")} on ${machineLabel}.`);
    }
    console.error("Proceeding…");
  }

  if (parsed.hot) {
    console.error(
      "Hot: discarding the first throughput run; models stay loaded (no unload between models).",
    );
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
      const discardFirst = discardFirstThroughput(caseDef, parsed.hot);
      const reps = caseReps(caseDef, parsed.runs, parsed.hot);
      for (let i = 0; i < reps; i += 1) {
        const discarded = discardFirst && i === 0;
        const attempt = await runCaseAttempt({
          baseUrl,
          model,
          caseDef,
          run: discarded ? 0 : discardFirst ? i : i + 1,
          settings: baseSettings,
          throughputNumPredict: parsed.throughputNumPredict,
          judgeModel,
          selfJudge,
        });
        if (discarded) attempt.discarded = true;
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

    // Unload before next model when ≥2 models remain after this one / multi-model run.
    // --hot keeps weights resident so the discarded first shot warms the rest.
    if (!parsed.hot && selected.length >= 2 && mi < selected.length - 1) {
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
      throughput_long_num_predict:
        parsed.suite === "full" ? LONG_THROUGHPUT_NUM_PREDICT : null,
      num_ctx: baseSettings.num_ctx ?? null,
      warmup: parsed.warmup,
      hot: parsed.hot,
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
      parsed.hot,
    );
    if (parsed.save) console.error(`benchmarks dir: ${benchmarksDir()}`);
  }

  if (parsed.failOnError && anyError) {
    process.exitCode = 2;
  }
}
