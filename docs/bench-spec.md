# Spec: `ollanet bench` — model benchmarking

**Status:** draft (not implemented)  
**Target:** `0.2.0`  
**Goal:** From one Ollama host, run a small fixed prompt suite against selected models (or all) and report **speed** + a lightweight **quality** signal in one table.

Keep it sharp: not an eval harness, not LMSYS. Discover → prompt → compare.

---

## Why

`scan` tells you what models exist. `prompt` lets you poke one. There is no way to answer:

- How fast is `gemma4:12b` vs `qwen3.6:35b` on *this* machine?
- Did the small model actually answer, or just mumble?
- After a Finetuna tune, did tok/s or answer quality move?

---

## CLI

```bash
ollanet bench <machine|ip> [model...] [options]
ollanet bench <machine|ip> --all [options]
```

### Examples

```bash
# Default suite against the host's default model (config / first available)
ollanet bench localhost

# Explicit models
ollanet bench localhost llama3.2:1b gemma4:12b

# Every model reported by /api/tags
ollanet bench mycroftone --all

# Machine-readable
ollanet bench localhost --all --json

# Shorter / longer suite
ollanet bench localhost --all --suite quick
ollanet bench localhost gemma4:12b --suite full
```

### Options

| Flag | Meaning |
|---|---|
| `--all` | Benchmark every model from `/api/tags` |
| `--suite <name>` | Prompt suite: `quick` (default) or `full` |
| `--warmup` | One discarded short call per model before timing (default **on**) |
| `--no-warmup` | Skip warmup |
| `--keep-alive <value>` | Passed through to Ollama (default inherit config / `5m`) |
| `--num-predict <n>` | Cap generation (per-prompt suite defaults may be lower) |
| `--num-ctx <n>` | Context window override |
| `--temperature <n>` | Sampling (suite default `0.2` for repeatability) |
| `--no-think` / `--think` | Same semantics as `prompt` (default off) |
| `--judge` | Optional second pass: ask a judge model to score each answer 1–5 |
| `--judge-model <name>` | Model for `--judge` (default: host default, or largest available) |
| `--json` | Emit full result JSON on stdout |
| `--save` | Write `benchmarks/<id>.json` (default **on** when not `--json`-only? → **on** by default, `--no-save` to skip) |
| `--no-save` | Do not persist |
| `--fail-fast` | Stop remaining models after first hard error |

Positional models are resolved against `/api/tags` the same way `prompt` peels models (name / prefix match). Unknown model → error listing available names.

If neither `[model...]` nor `--all` is given: use `defaultModels[host]` if set, else error asking for a model or `--all`.

---

## Prompt suites

Built-in, versioned in code (not user files for v1). Each case has an id, prompt text, and optional quality checks.

### `quick` (default) — ~3 prompts, cheap

| id | Prompt (summary) | Quality checks |
|---|---|---|
| `ping` | `Reply with exactly: OK` | Exact / trimmed match `OK` |
| `math` | `What is 17 * 19? Reply with only the number.` | Contains `323` |
| `haiku` | `Write a haiku about ferrets.` | Non-empty, ≥3 lines (loose) |

### `full` — quick + a few more

| id | Prompt (summary) | Quality checks |
|---|---|---|
| *(all of quick)* | | |
| `json` | `Return JSON: {"animal":"ferret","legs":4}` | Parseable JSON with those keys/values |
| `reason` | Short multi-step word problem; ask for final number only | Contains expected number |
| `long` | ~2-paragraph explain request | Non-empty, ≥ N chars; mainly for sustained tok/s |

Suite strings live in `src/bench-suite.ts` so they stay reviewable in PRs. Do **not** load arbitrary prompts from disk in v1 (keeps results comparable).

---

## Execution model

For each model, in order:

1. **Optional warmup** — `ping`-like one-shot with `num_predict` small; discard timing (still log load if useful).
2. **For each suite case:**
   - `POST /api/chat` with `stream: false` (simpler stats; bench is not a UX stream).
   - Record wall time + Ollama metrics from the response.
   - Run quality checks locally (no network).
   - If `--judge`, one extra chat call to the judge model with a fixed rubric; parse integer score.
3. **Unload policy:** do **not** force `keep_alive: 0` between cases (same lesson as topic gen). Between *models*, optionally send `keep_alive: 0` for the previous model so VRAM is fair — **yes for v1** when benchmarking multiple models on one host.

Concurrency: **serial only** in v1 (one model, one prompt at a time). Parallel would wreck GPU numbers.

Timeouts: reuse `OLLAMA_PROMPT_TIMEOUT_MS`. On timeout/error, record the case as `error` and continue (unless `--fail-fast`).

Settings precedence for bench: CLI flags → env → `machineDefaults` → `defaults`, but force `temperature` default `0.2` and `think: false` unless overridden (repeatability).

---

## Metrics (per case)

| Field | Source |
|---|---|
| `wall_ms` | Client stopwatch around `fetch` |
| `total_duration` / `load_duration` / `prompt_eval_count` / `eval_count` / `eval_duration` | Ollama chat response |
| `tok_s` | `eval_count / (eval_duration / 1e9)` when both present |
| `ttft_ms` | Optional later (needs streaming); **omit in v1** |
| `quality.pass` | All local checks passed |
| `quality.checks[]` | `{ id, ok, detail? }` |
| `quality.judge_score` | 1–5 if `--judge`, else omitted |
| `content` | Full reply text (truncated in human table; full in JSON/save) |
| `error` | Message if the call failed |

### Per-model summary

- Mean / median `tok_s` over successful generative cases (exclude pure `ping` from tok/s average, or weight only cases with `eval_count ≥ 8`)
- `load_duration` from first timed case after warmup (cold-ish) vs later cases (warm)
- `quality.pass_rate` = passed cases / attempted cases
- Optional `judge_avg` if judging

---

## Human output

Stderr progress while running; stdout (or stderr+stdout like today) a final table:

```text
ollanet bench  localhost  suite=quick  models=3

Model              tok/s ↑   load     pass   notes
llama3.2:1b         98.4    0.4s    3/3
gemma4:12b          42.1    2.1s    3/3
fake:1b              —       —      0/3    connection refused

Details:
  llama3.2:1b
    ping    120ms   pass
    math     80ms   pass   323
    haiku   410ms   95 tok/s  pass
```

Sort models by median tok/s descending. Failed models sink to the bottom.

`--json` prints one object to stdout (no table), suitable for CI / Finetuna before-after.

---

## Persistence

Default dir (mirrors chats):

| Context | Path |
|---|---|
| Checkout | `benchmarks/<id>.json` |
| Installed | `~/.ollanet/benchmarks/<id>.json` |

Override: `OLLANET_BENCHMARKS_DIR`.

File shape (v1):

```json
{
  "id": "a1b2c3d4e5f6",
  "version": 1,
  "created_at": "…",
  "machine": "localhost",
  "host": { "ip": "127.0.0.1", "port": 11434 },
  "suite": "quick",
  "ollanet": "0.2.0",
  "settings": { "temperature": 0.2, "think": false, "warmup": true },
  "models": [
    {
      "model": "llama3.2:1b",
      "summary": { "tok_s_median": 98.4, "pass_rate": 1, "load_ms": 400 },
      "cases": [ { "id": "ping", "wall_ms": 120, "quality": { "pass": true, "checks": [] }, "content": "OK", "ollama": {} } ]
    }
  ]
}
```

Add `benchmarks/` to `.gitignore`. No `bench ls` command in v1 — users can open the JSON; a later `ollanet benches` can mirror `chats` if needed.

---

## Quality philosophy (v1)

- **Local checks are mandatory and boring** — exact-ish answers for factual prompts. They catch “model loaded but useless” without another LLM.
- **`--judge` is optional** and explicitly subjective. Rubric: correctness, instruction-following, clarity; score 1–5; judge prompt fixed in code.
- Do **not** claim Elo, MMLU, or leaderboard parity. Label output “ollanet bench suite quick/full”, not “quality score”.

---

## Code layout

```text
src/bench.ts          # CLI: args, orchestration, table / json
src/bench-suite.ts    # Suite definitions + local checkers
src/bench-store.ts    # Persist under benchmarks/ (paths helper)
```

Reuse from existing modules:

- `discoverHosts` / `resolveHost` / `ollamaBaseUrl` / `findDiscoveredHost`
- `loadConfig` / `mergeSettings` / `defaultModelForHost`
- Chat POST helper — **extract** a shared `ollamaChat()` from `prompt.ts` (today `runChat` is private) so bench does not duplicate fetch/AbortSignal/JSON error handling
- `envInt` for timeouts

Wire into `src/cli.ts`:

```text
case "bench":
case "benchmark":
```

Help text + README section once implemented.

---

## Non-goals (v1)

- Interactive model picker TUI
- Multi-host comparison in one command (run twice; join JSON yourself)
- Streaming TTFT charts
- Custom prompt files / YAML suites
- Uploading results anywhere
- Parallel model runs
- Thinking-level enums (`low`/`medium`/`high`) — separate TODO

---

## Acceptance criteria

1. `ollanet bench localhost llama3.2:1b` runs `quick`, prints table, saves JSON under `benchmarks/`.
2. `ollanet bench localhost --all --json` includes every `/api/tags` model; failures are per-model, not process-fatal (unless `--fail-fast`).
3. Unquoted / quoted prompts are irrelevant (suite is built-in); no regression to `prompt` arg joining.
4. Warmup does not appear as a scored case; multi-model runs unload prior model between models.
5. `--judge` adds scores without breaking speed metrics (judge time excluded from `tok_s`).
6. `pnpm typecheck` clean; zero new runtime dependencies.

---

## Open questions

1. **Default model when omitted:** host default only, or refuse and require `--all` / explicit list? *(Spec currently: default model or error.)*
2. **Unload between models:** always, or only with `--all` / ≥2 models? *(Spec: when ≥2 models.)*
3. **Suite evolution:** if we change prompts, bump a `suiteRevision` in the JSON so old runs aren’t compared blindly.

---

## Implementation sketch (when building)

1. Extract `ollamaChat` (+ types) from `prompt.ts`.
2. Add `bench-suite.ts` with `quick` / `full` + checkers.
3. Add `bench.ts` orchestration + table.
4. Add `bench-store.ts` + `defaultBenchmarksDir()` in `paths.ts`.
5. Gitignore `benchmarks/`; README + CLI help; CHAT_RESTORE.
6. Manual test on localhost with 1 small + 1 larger model.
