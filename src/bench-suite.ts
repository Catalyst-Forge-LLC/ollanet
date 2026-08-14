/**
 * Built-in ollanet bench suites, checkers, and revision hashes.
 */
import { createHash } from "node:crypto";

export type CaseRole = "check" | "live" | "throughput";

export interface BenchCase {
  id: string;
  role: CaseRole;
  prompt: string;
  /** Cap for this case. Peak throughput uses `--num-predict` when omitted. */
  num_predict?: number;
  /**
   * Throughput attempts. Omit to use `--runs` (and `--hot` discard).
   * Set `1` for a single large shot that does not repeat.
   */
  repeats?: number;
  format?: "json";
  check?: (content: string) => { ok: boolean; detail?: string };
}

/** Pinned length for `full`'s prose throughput case (`throughput_long`). */
export const LONG_THROUGHPUT_NUM_PREDICT = 1024;

export type SuiteName = "quick" | "full";

const MATH_ANSWER = 323;
const REASON_ANSWER = 42;

function lastTokenNormalized(content: string): string {
  const tokens = content.trim().split(/\s+/).filter(Boolean);
  const last = tokens[tokens.length - 1] ?? "";
  return last.toLowerCase().replace(/^[^a-z0-9]+|[^a-z0-9]+$/gi, "");
}

function integersInLastLine(content: string): number[] {
  const lines = content
    .split(/\r?\n/)
    .map((l) => l.trim())
    .filter(Boolean);
  const last = lines[lines.length - 1] ?? content.trim();
  const matches = last.match(/-?\d+/g) ?? [];
  return matches.map((m) => Number(m)).filter((n) => Number.isFinite(n));
}

function stripCodeFences(content: string): string {
  const trimmed = content.trim();
  const fenced = trimmed.match(/^```(?:json)?\s*([\s\S]*?)\s*```$/i);
  return (fenced?.[1] ?? trimmed).trim();
}

function checkPing(content: string): { ok: boolean; detail?: string } {
  const token = lastTokenNormalized(content);
  return token === "ok"
    ? { ok: true, detail: token }
    : { ok: false, detail: `last token=${JSON.stringify(token)}` };
}

function checkExpectedInt(expected: number) {
  return (content: string): { ok: boolean; detail?: string } => {
    const ints = integersInLastLine(content);
    return ints.includes(expected)
      ? { ok: true, detail: String(expected) }
      : { ok: false, detail: `ints=${JSON.stringify(ints)}` };
  };
}

function checkHaikuLive(content: string): { ok: boolean; detail?: string } {
  const lines = content
    .split(/\r?\n/)
    .map((l) => l.trim())
    .filter(Boolean);
  const ok = content.trim().length > 0 && lines.length >= 3;
  return ok ? { ok: true, detail: `${lines.length} lines` } : { ok: false, detail: `${lines.length} lines` };
}

function checkJsonStructure(content: string): { ok: boolean; detail?: string } {
  try {
    const parsed = JSON.parse(stripCodeFences(content)) as Record<string, unknown>;
    const animal = String(parsed.animal ?? "").toLowerCase();
    const legs = Number(parsed.legs);
    const ok = animal.includes("ferret") && legs === 4;
    return ok
      ? { ok: true }
      : { ok: false, detail: `got animal=${JSON.stringify(parsed.animal)} legs=${JSON.stringify(parsed.legs)}` };
  } catch (err) {
    return { ok: false, detail: err instanceof Error ? err.message : "parse error" };
  }
}

const QUICK_CASES: BenchCase[] = [
  {
    id: "ping",
    role: "check",
    prompt: "Reply with exactly: OK",
    num_predict: 16,
    check: checkPing,
  },
  {
    id: "math",
    role: "check",
    prompt: "What is 17 * 19? Reply with only the number.",
    num_predict: 32,
    check: checkExpectedInt(MATH_ANSWER),
  },
  {
    id: "haiku",
    role: "live",
    prompt: "Write a haiku about ferrets.",
    num_predict: 64,
    check: checkHaikuLive,
  },
  {
    id: "throughput",
    role: "throughput",
    // Enumerative on purpose: at temperature 0, prose prompts often EOS well
    // before num_predict. Counting resists early stop so done_reason=length.
    prompt:
      "Count from 1 to 400. Write one integer per line and nothing else. " +
      "Do not stop early. Do not write words.",
    // num_predict pinned by runner
  },
];

const FULL_EXTRA: BenchCase[] = [
  {
    id: "json",
    role: "check",
    prompt:
      'Return a JSON object describing an animal that is a ferret and has 4 legs. ' +
      'Use keys "animal" (string) and "legs" (number).',
    num_predict: 64,
    format: "json",
    check: checkJsonStructure,
  },
  {
    id: "reason",
    role: "check",
    prompt: "Start with 40. Add 7. Subtract 5. Reply with only the final number.",
    num_predict: 48,
    check: checkExpectedInt(REASON_ANSWER),
  },
  {
    id: "throughput_long",
    role: "throughput",
    // Chat-shaped tokens (markdown, lists, a table) at a long pin. Anti-EOS
    // so done_reason=length; one shot (not --runs) so full stays usable.
    prompt:
      "Write a detailed trade-off briefing for a product team choosing a web UI stack. " +
      "Compare at least two options. Use markdown headings, bullet lists, and at least one table. " +
      "Keep adding sections (testing, hiring, migration, failure modes, cost) without wrapping up. " +
      "Do not write a closing recommendation that ends the piece. Do not stop early.",
    num_predict: LONG_THROUGHPUT_NUM_PREDICT,
    repeats: 1,
  },
];

export function getSuiteCases(suite: SuiteName): BenchCase[] {
  if (suite === "full") return [...QUICK_CASES, ...FULL_EXTRA];
  return [...QUICK_CASES];
}

export function suiteRevision(suite: SuiteName): string {
  const cases = getSuiteCases(suite);
  const canonical = cases.map((c) => `${c.id}\n${c.role}\n${c.prompt}`).join("\n---\n");
  return createHash("sha256").update(canonical).digest("hex").slice(0, 16);
}

export function comparabilityKey(opts: {
  suite: SuiteName;
  throughputNumPredict: number;
  seed: number;
  temperature: number;
  think: boolean;
  numCtx: number | null;
  /** Steady-state tok/s: first throughput run discarded, no inter-model unload. */
  hot?: boolean;
}): string {
  const payload = [
    suiteRevision(opts.suite),
    `num_predict=${opts.throughputNumPredict}`,
    `seed=${opts.seed}`,
    `temperature=${opts.temperature}`,
    `think=${opts.think ? 1 : 0}`,
    `num_ctx=${opts.numCtx ?? ""}`,
    ...(opts.hot ? ["hot=1"] : []),
  ].join("|");
  return createHash("sha256").update(payload).digest("hex").slice(0, 16);
}

export function median(values: number[]): number | undefined {
  if (values.length === 0) return undefined;
  const sorted = [...values].sort((a, b) => a - b);
  const mid = Math.floor(sorted.length / 2);
  if (sorted.length % 2 === 0) {
    return (sorted[mid - 1]! + sorted[mid]!) / 2;
  }
  return sorted[mid];
}
