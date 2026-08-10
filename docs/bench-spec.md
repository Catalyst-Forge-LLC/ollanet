# Spec: `ollanet bench` — model benchmarking

**Status:** draft (not implemented) — revised after measurement-validity review  
**Target:** `0.2.0`  
**Goal:** From one Ollama host, run a small fixed prompt suite against selected models (or all) and report **credible speed** + a lightweight **quality** signal in one table.

Keep it sharp: not an eval harness, not LMSYS. Discover → prompt → compare. Primary use case: **Finetuna before/after** — did a tune move tok/s or break instruction-following?

---

## Why

`scan` tells you what models exist. `prompt` lets you poke one. There is no way to answer:

- How fast is `gemma4:12b` vs `qwen3.6:35b` on *this* machine?
- Did the small model actually answer, or just mumble?
- After a Finetuna tune, did tok/s move — and by more than noise?

---

## CLI

```bash
ollanet bench <machine|ip> [model...] [options]
ollanet bench <machine|ip> --all [options]
```

### Examples

```bash
# Host default model, quick suite, 3 runs
ollanet bench localhost

# Explicit models
ollanet bench localhost llama3.2:1b gemma4:12b

# Every model from /api/tags (prints count + ETA first)
ollanet bench mycroftone --all

# More repeats for a tighter Finetuna comparison
ollanet bench localhost my-model-finetuna --runs 5

# Cold-load measurement + machine-readable
ollanet bench localhost --all --cold-load --json

# Optional judge (model REQUIRED — no silent self-judge default)
ollanet bench localhost gemma4:12b --judge --judge-model llama3.2:1b
```

### Options

| Flag | Meaning |
|---|---|
| `--all` | Benchmark every model from `/api/tags` |
| `--suite <name>` | Prompt suite: `quick` (default) or `full` |
| `--runs <n>` | Repeats per throughput case (default **3**, min 1) |
| `--warmup` | Discarded short call per model before timed cases (default **on**) |
| `--no-warmup` | Skip warmup |
| `--cold-load` | Explicit cold-load measurement via unload + `/api/ps` poll (default **off**) |
| `--keep-alive <value>` | Passed through for timed cases (default inherit config / `5m`) |
| `--num-predict <n>` | Override pin for the throughput case only (default **256**) |
| `--num-ctx <n>` | Context window override |
| `--no-think` / `--think` | Same semantics as `prompt` (default off) |
| `--judge` | Optional second pass: judge model scores answers 1–5 |
| `--judge-model <name>` | **Required** with `--judge` — no default |
| `--json` | Emit full result JSON on stdout |
| `--save` / `--no-save` | Persist under `benchmarks/` (default **on**) |
| `--fail-fast` | Stop remaining models after first hard model error |
| `--fail-on-error` | Exit nonzero if any model/case errored (for CI; see Exit codes) |

Positional models are resolved against `/api/tags` (name / prefix match). Unknown model → error listing available names.

If neither `[model...]` nor `--all` is given: use `defaultModels[host]` if set, else error asking for a model or `--all`. (Same least-surprise rule as `prompt`.)

**Not exposed as knobs for checked cases:** `temperature` and `seed` are fixed by the suite (`temperature: 0`, `seed: 0`) so pass/fail reflects the model, not the sample. Throughput case also pins `num_predict` (see below).

---

## Measurement validity (non-negotiable)

### Repeats — highest-value requirement

`--runs <n>` (default **3**) applies to the **throughput** case (and any other generative speed case). Report for tok/s:

- **median** (headline)
- **min / max** (or IQR when `runs ≥ 4`)

A Finetuna “improvement” smaller than the observed spread is **no difference** — say so in the table notes rather than implying a ranking. Without repeats, a 5% swing is indistinguishable from thermal drift.

Quality cases (`ping`, `math`, …) also benefit from repeats: with three cases × three runs, `pass_rate` has enough granularity to mean something. Aggregate: pass_rate = passed attempts / total attempts across runs.

### Pin generated length for throughput

`tok/s` falls as context grows. A model that freely writes 600 tokens is not comparable to one that writes 200. The throughput case **must** set `options.num_predict` to a fixed value (default **256**) so every model generates the same amount. Suite cases that are instruction-checks may use a lower cap (e.g. `ping` → 8).

### Determinism for checked cases

For all quality-checked cases: `temperature: 0` and `options.seed: 0` (Ollama’s seed defaults to `-1`). Near-deterministic output makes pass/fail about the model. Throughput case uses the same seed/temp unless we later find greedy decoding skews speed on some backends — v1 keeps them pinned everywhere for simplicity.

### Load column — only with `--cold-load`

Default warmup leaves the model resident, so `load_duration ≈ 0` on timed cases. **Do not show a load column unless `--cold-load` was passed.**

Cold-load procedure (per model, once):

1. Ensure model is unloaded: chat/generate with `keep_alive: 0` (or equivalent), then **poll `GET /api/ps` until the model is absent** (bounded wait, e.g. 60s).
2. Time a 1-token (or `num_predict: 1`) request; read `load_duration` from the response.
3. That value is the load metric. Warmup for throughput runs afterward as usual.

### Unload between models is async

When ≥2 models are benchmarked, after finishing model A:

1. Send unload (`keep_alive: 0`).
2. **Poll `/api/ps` until A is gone** (bounded wait).
3. Only then start model B.

Skipping the poll loads B alongside A and skews B’s numbers. Do **not** force `keep_alive: 0` between cases of the *same* model (keep_alive lesson from topic gen).

### Per-case timeout (bench-specific)

Do **not** reuse the 600s prompt timeout as the only bound. Bench gets its own default **per-case** timeout (e.g. `OLLAMA_BENCH_TIMEOUT_MS`, default **60_000**). Override via env or a `--timeout` flag if cheap.

Before starting, print:

```text
Bench: 12 models × suite=quick × runs=3  (~N cases, timeout 60s/case)
Rough upper bound: ~Xm if every case hits the timeout.
Proceeding…
```

`--all` on a fat host must not silently become a multi-hour VRAM churn with no warning.

---

## Prompt suites

Built-in only (no user prompt files in v1). Live in `src/bench-suite.ts`.

**`suiteRevision`:** SHA-256 (or truncated hex) of the canonical prompt texts + check ids for the suite. Recomputed automatically — **never** a manually bumped integer. Stored on every result file so Finetuna before/after refuses naïve comparison across suite edits.

### Case roles

| Role | Purpose | Speeds? | Notes |
|---|---|---|---|
| `check` | Instruction-following / correctness | No (exclude from tok/s) | Short `num_predict` |
| `live` | Liveness only | No | Explicitly not “quality” |
| `throughput` | Headline tok/s | Yes | Pinned `num_predict` (256), repeated `--runs` times |

### `quick` (default)

| id | Role | Prompt (summary) | Check |
|---|---|---|---|
| `ping` | check | `Reply with exactly: OK` | Normalize case + strip trailing punctuation; match `ok`. Measures **instruction-following**, not capability. Chatty `OK.` / `Sure — OK` should pass. |
| `math` | check | `What is 17 * 19? Reply with only the number.` | Extract the **last** integer in the reply; must equal `323`. (Avoids pass-on-restating-the-problem.) |
| `haiku` | live | `Write a haiku about ferrets.` | Non-empty and ≥3 lines — **liveness only**, labeled as such in output. |
| `throughput` | throughput | Fixed filler prompt that invites long generation (e.g. explain a simple topic in detail) | No content check; `num_predict: 256`; repeated `--runs` times |

### `full` — quick + 

| id | Role | Prompt (summary) | Check |
|---|---|---|---|
| `json` | check | Ask for a **structure** (e.g. “an animal that is a ferret and has 4 legs”) — **do not embed the answer JSON in the prompt** | Prefer `format: "json"`; also strip \`\`\` fences before `JSON.parse`. Assert keys/values. Measures generation, not copying. |
| `reason` | check | Short multi-step word problem; ask for final number only | **Last** integer in the reply equals expected |

---

## Execution model (per model)

1. Record model identity from `/api/tags` (+ `/api/version` once per host). See Identity.
2. If `--cold-load`: unload → poll `/api/ps` → 1-token load probe → record `load_ms`.
3. If warmup (default): short discarded call.
4. Run each suite case:
   - `check` / `live`: `--runs` times (default 3) with `temperature: 0`, `seed: 0`, stream false.
   - `throughput`: `--runs` times with pinned `num_predict`, same seed/temp.
   - On timeout/error: record attempt as `error`; continue unless `--fail-fast`.
   - Local quality checks; optional `--judge` after each successful check/live attempt (judge time **excluded** from tok/s).
5. If more models remain: unload → poll `/api/ps` → next model.

Concurrency: **serial only**.

Settings precedence for allowed overrides: CLI → env → `machineDefaults` → `defaults`, then suite pins win for `temperature`, `seed`, and throughput `num_predict`.

---

## Identity — record what you compare

`"model": "llama3.2:1b"` is not an identity. A re-pull or Finetuna retag silently invalidates comparisons.

From `/api/tags` `ModelDetails` (and related fields), persist per model:

| Field | Source |
|---|---|
| `name` | tag name |
| `digest` | model digest (**required** for before/after) |
| `parameter_size` | details |
| `quantization_level` | details |
| `size` | weights size if present |

Once per run / host:

| Field | Source |
|---|---|
| `ollama_version` | `GET /api/version` |
| `size_vram` | from `GET /api/ps` while the model is loaded (best-effort; omit if unavailable) |

If digest is missing from the API response, warn and still record whatever identity fields exist — but Finetuna docs should say “digest required for trustworthy diffs.”

---

## Metrics

### Per attempt

| Field | Source |
|---|---|
| `wall_ms` | Client stopwatch |
| `total_duration` / `load_duration` / `prompt_eval_count` / `eval_count` / `eval_duration` | Ollama chat response |
| `tok_s` | `eval_count / (eval_duration / 1e9)` when both present; only meaningful for throughput attempts with full `num_predict` |
| `quality.pass` | All local checks passed (check/live roles) |
| `quality.checks[]` | `{ id, ok, detail? }` |
| `quality.judge_score` | 1–5 if judging succeeded; **omit** (do not store 0) if parse fails |
| `content` | Full reply (truncated in table; full in JSON) |
| `error` | Message if failed |

### Per-model summary

- `tok_s_median` / `tok_s_min` / `tok_s_max` from **throughput** attempts only  
- `pass_rate` across check/live attempts  
- `load_ms` only if `--cold-load`  
- `judge_avg` if judging produced ≥1 score  
- `self_judge: true` flag if `--judge-model` equals the subject model  

---

## Human output

Print model count + rough ETA **before** work. Progress on stderr; final table on stdout:

```text
Bench: 3 models × suite=quick × runs=3  (suiteRevision=a1b2c3d4)
Cold-load: off   timeout: 60s/case

Model              tok/s (med)   spread      pass    notes
llama3.2:1b            98.4     96–101     9/9
gemma4:12b             42.1     40–44      8/9     math fail ×1
fake:1b                 —         —        0/9     connection refused

With --cold-load, an extra "load" column appears.

Details (stderr or --verbose):
  llama3.2:1b  digest=sha256:…  params=1B  quant=Q4_0
    ping          pass ×3
    math          pass ×3
    haiku         live ×3
    throughput    98.4 tok/s med (96–101) ×3
```

**Sort:** pass_rate descending, then median tok/s descending. Failed / zero-pass models sink. Fast-but-useless must not win the table.

Label clearly: “ollanet bench suite quick/full” — never “quality score” or leaderboard language. Liveness rows say `live`, not `pass`, in detail view (summary pass_rate may still count live checks as soft passes — or exclude live from pass_rate and show separately; **v1: exclude `live` from pass_rate**, show `live_ok` rate in details only).

---

## `--judge`

- `--judge` requires `--judge-model`. **No default** (avoids silent self-preference).
- Record judge model name + digest in the result JSON.
- Flag rows where judge name/digest equals subject (`self_judge: true`).
- Judge calls: `temperature: 0`, `seed: 0`, fixed rubric prompt in code.
- If the 1–5 parse fails: **omit** `judge_score` for that attempt; do not write `0`.
- Judge latency never enters tok/s.

---

## Persistence

| Context | Path |
|---|---|
| Checkout | `benchmarks/<id>.json` |
| Installed | `~/.ollanet/benchmarks/<id>.json` |

Override: `OLLANET_BENCHMARKS_DIR`. Gitignore `benchmarks/`.

```json
{
  "id": "a1b2c3d4e5f6",
  "version": 1,
  "created_at": "…",
  "ollanet": "0.2.0",
  "suite": "quick",
  "suite_revision": "a1b2c3d4e5f6…",
  "runs": 3,
  "machine": "localhost",
  "host": { "ip": "127.0.0.1", "port": 11434 },
  "ollama_version": "0.x.y",
  "settings": {
    "temperature": 0,
    "seed": 0,
    "throughput_num_predict": 256,
    "warmup": true,
    "cold_load": false,
    "think": false,
    "bench_timeout_ms": 60000
  },
  "judge": null,
  "models": [
    {
      "name": "llama3.2:1b",
      "digest": "sha256:…",
      "parameter_size": "1.2B",
      "quantization_level": "Q4_K_M",
      "size_vram": 123456789,
      "summary": {
        "tok_s_median": 98.4,
        "tok_s_min": 96.0,
        "tok_s_max": 101.2,
        "pass_rate": 1.0,
        "load_ms": null,
        "self_judge": false
      },
      "cases": []
    }
  ]
}
```

No `bench ls` in v1.

---

## Exit codes (CI)

| Code | When |
|---|---|
| `0` | Completed; no hard failures, **or** failures present but `--fail-on-error` not set |
| `1` | Usage / config / unknown model / could not resolve host |
| `2` | `--fail-on-error` (or `--fail-fast` abort) and at least one model/case error |

Default without `--fail-on-error`: exit `0` after a completed run even if some models failed (table tells the story). CI should pass `--fail-on-error`.

---

## Code layout

```text
src/ollama-chat.ts    # shared chat helper (EXTRACT FIRST — own commit)
src/bench.ts          # CLI: args, orchestration, table / json
src/bench-suite.ts    # Suites, checkers, suiteRevision hash
src/bench-store.ts    # Persist under benchmarks/
```

Reuse: `discoverHosts` / `resolveHost` / `ollamaBaseUrl`, config merge, `envInt`.

Wire: `case "bench":` / `"benchmark":` in `cli.ts`.

### Build order (mandatory)

1. **Extract `ollamaChat()` from `prompt.ts` into `src/ollama-chat.ts` as its own commit.** Run `pnpm test` — that path is where four shipped bugs lived; the suite must stay green before any bench code lands.
2. Extend the mock harness (`test/helpers.mjs`): `/api/ps`, `/api/version`, and per-model canned `eval_count` / `eval_duration` so unit/CLI tests can assert tok/s math, warmup exclusion, unload+ps poll, and **per-model error isolation** without a GPU.
3. Implement suite + bench orchestration.
4. Gitignore `benchmarks/`; README + help; CHAT_RESTORE.

---

## Non-goals (v1)

- Interactive model picker TUI  
- Multi-host comparison in one command  
- Streaming TTFT charts  
- Custom prompt files / YAML suites  
- Uploading results anywhere  
- Parallel model runs  
- Thinking-level enums (`low` / `medium` / `high`)  
- Claiming Elo / MMLU / leaderboard parity  

---

## Acceptance criteria

1. `ollanet bench localhost llama3.2:1b` runs `quick` with default `--runs 3`, prints median tok/s **and** spread, saves JSON with digests + `suite_revision`.
2. `ollanet bench localhost --all --json` includes every `/api/tags` model; a failure on model 2 does not skip the rest (unless `--fail-fast`). Covered by mock test.
3. Throughput cases use pinned `num_predict`; check cases use `temperature: 0` and `seed: 0`.
4. Load column absent unless `--cold-load`; cold-load polls `/api/ps`.
5. Multi-model runs unload and poll `/api/ps` before the next model.
6. `--judge` without `--judge-model` errors; self-judge rows flagged; failed 1–5 parse omits score.
7. Preflight prints model count and rough upper-bound ETA; per-case timeout defaults to 60s.
8. Sort by pass_rate then tok/s; `live` cases excluded from pass_rate.
9. `suite_revision` changes when prompt text changes (content hash).
10. `pnpm test` + `pnpm typecheck` clean; zero new runtime dependencies.
11. `ollamaChat` extraction lands in a green commit **before** bench feature commits.

---

## Resolved decisions

1. **Default model when omitted:** host default, else error.  
2. **Unload between models:** only when ≥2 models, with `/api/ps` poll.  
3. **Suite evolution:** content hash of prompts/checks — mandatory, automatic.

---

## Implementation sketch

1. Commit: extract `ollamaChat` + keep `pnpm test` green.  
2. Commit: mock `/api/ps` + `/api/version` + canned timings; tests for unload poll helpers if pure.  
3. Commit: `bench-suite.ts` (prompts, checkers, revision hash).  
4. Commit: `bench.ts` + `bench-store.ts` + CLI wiring + README.  
5. Manual GPU smoke: 1 small + 1 larger model, `--runs 3`, Finetuna-style retag digest change visible in JSON.
