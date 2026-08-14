# Spec: `ollanet bench` — model benchmarking

**Status:** implemented (see `src/bench.ts` + `test/bench*.mjs`)  
**Target release:** `0.2.0` (+ `0.2.1` display/vision-default fixes)  
**Goal:** From one Ollama host, run a small fixed prompt suite against selected **completion** models and report **credible speed** + a lightweight **quality** signal in one table.

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
# Host default model, quick suite, 3 throughput runs
ollanet bench localhost

# Explicit models
ollanet bench localhost llama3.2:1b gemma4:12b

# Every completion-capable model from /api/tags (skips embeddings)
ollanet bench mycroftone --all

# More throughput repeats for a tighter Finetuna comparison
ollanet bench localhost my-model-finetuna --runs 5

# Steady-state tok/s: discard the first throughput run, keep the model loaded
ollanet bench localhost my-model-finetuna --hot --runs 5

# Cold-load measurement + machine-readable
ollanet bench localhost --all --cold-load --json

# Optional judge (model REQUIRED — no silent self-judge default)
ollanet bench localhost gemma4:12b --judge --judge-model llama3.2:1b
```

### Options

| Flag | Meaning |
|---|---|
| `--all` | Benchmark every **completion-capable** model from `/api/tags` (see Capability filter) |
| `--suite <name>` | Prompt suite: `quick` (default) or `full`. `full` adds json/reason checks plus one 1024-token prose throughput case. |
| `--runs <n>` | Repeats for the **256-token throughput** case only (default **3**, min 1). With `--hot`, these are the **counted** hot runs after the discarded first shot. Does **not** repeat `throughput_long`. |
| `--hot` | Steady-state tok/s: run throughput `--runs + 1` times, **discard the first** from median/spread, and **do not unload** between models. The discarded full generation is the warmup (short `--warmup` is off unless you pass `--warmup` too). |
| `--warmup` | Discarded short call per model before timed cases (default **on**, **off** under `--hot`) |
| `--no-warmup` | Skip warmup |
| `--cold-load` | Explicit cold-load measurement via unload + `/api/ps` poll (default **off**) |
| `--keep-alive <value>` | Passed through for timed cases (default inherit config / `5m`) |
| `--num-predict <n>` | Override pin for the **256-token** throughput case only (default **256**). Does not change `throughput_long` (1024). |
| `--num-ctx <n>` | Context window override |
| `--no-think` / `--think` | Same semantics as `prompt` (default off) |
| `--judge` | Optional second pass: judge model scores answers 1–5 |
| `--judge-model <name>` | **Required** with `--judge` — no default |
| `--json` | Emit full result JSON on stdout |
| `--save` / `--no-save` | Persist under `benchmarks/` (default **on**) |
| `--fail-fast` | Stop remaining models after first hard model error |
| `--fail-on-error` | Exit nonzero if any model/case errored (for CI; see Exit codes) |

Positional models are resolved against `/api/tags` (name / prefix match). Unknown model → error listing available names. Explicit positional models that lack `completion` capability → error (or hard skip with message); do not silently 400 mid-suite.

If neither `[model...]` nor `--all` is given: use `defaultModels[host]` if set, else error asking for a model or `--all`.

**Pinned for all suite cases (not user knobs for checks):** `temperature: 0`, `seed: 0`. Throughput also pins `num_predict` (overridable via `--num-predict`).

---

## Capability filter (`--all` and friends)

`/api/tags` lists **everything**, including embedding models (`nomic-embed-text`, `all-minilm`, …). `/api/chat` on those returns 400 (“does not support generate”), so naïve `--all` fills the table with permanent failures that look like ollanet is broken.

Before benchmarking a model, call `POST /api/show` and read `capabilities` (e.g. `completion`, `embedding`, `tools`, `vision`, `thinking`, …).

- **`--all`:** include models that are completion-capable.  
  **`capabilities` is omitempty** — if the key is missing or the array is empty, treat as completion-capable and proceed. Only skip when a **present, non-empty** array lacks `completion`.  
- **Skipped models:** report separately, not as failed rows:

```text
Skipped 2 non-completion models: nomic-embed-text, all-minilm
```

- Persist skipped names under `skipped_models[]` in the JSON.  
- One `/api/show` per candidate is fine for v1.  
- Bonus: if `--think` is set and a **present** capabilities array lacks `thinking`, **warn before the call**. Absent/empty capabilities → do not warn, do not block.

Mock harness: configurable `capabilities` per model (including omit-key) so the filter is testable without a GPU.

---

## Measurement validity (non-negotiable)

### Repeats — throughput only

`--runs <n>` (default **3**) applies **only** to the **throughput** case. With `--hot`, `--runs` is the number of **counted** shots after a discarded first generation. Report for tok/s:

- **median** (headline)
- **min / max** (or IQR when `runs ≥ 4`)

A Finetuna “improvement” smaller than the observed spread is **no difference** — say so in notes. Without repeats, a 5% swing is indistinguishable from thermal drift.

**Check / live cases run once** (not `--runs` times). Rationale: with `temperature: 0` and `seed: 0`, repeats are the same call — the denominator grows but information does not. GPU batching can make them non-bit-identical, so repeats would only detect flakiness; v1 does not pay that cost by default. If we later add optional check repeats, report them as `3/3 consistent` (nondeterminism detector), **not** folded into `pass_rate`.

### Pin generated length + early-stop flag

Throughput sets `options.num_predict` to a fixed value (default **256**). But a model that emits EOS at token 90 yields tok/s over 90 tokens — a different measurement (shorter gens often look faster per token).

Ollama returns `done_reason` on the final chunk (`"length"` when the cap was hit, `"stop"` for EOS, etc.). **Record `done_reason` per throughput attempt.**

For headline tok/s median/spread:

- Prefer attempts where `done_reason === "length"` (full pin reached).  
- If an attempt has `done_reason !== "length"`, **exclude it from the median** and **visibly flag** it in the table/details (`early-stop`, show `eval_count`).  
- If **no** attempt reached `length`, show tok/s as unavailable / provisional and note why — do not silently compare a 90-token run to a 256-token run.

Mock: configurable `done_reason` (+ `eval_count`) per response.

### Determinism for checked cases

`temperature: 0` and `options.seed: 0` on all suite cases (including throughput in v1).

### Load column — only with `--cold-load`

Default warmup leaves the model resident, so timed-case `load_duration ≈ 0`. **Do not show a load column unless `--cold-load` was passed.** Never populate `load_ms` from a post-warmup case.

Cold-load procedure (per model, once) — **before warmup**:

1. **Poll `/api/ps` first.** If the model is already absent, skip the unload request (do not load-just-to-unload).
2. If resident: send unload (`keep_alive: 0`), then poll `/api/ps` until absent (bounded wait, e.g. 60s).
3. Time a 1-token (`num_predict: 1`) request; read `load_duration` from **that** response only.
4. Store under `models[].cold_load` — not inside suite `cases[]`.
5. **Then** warmup + timed suite cases.

**Anti-stub checks:**

- With `--cold-load` + default `--warmup`, `cold_load.load_ms` must be **> 0** on a real GPU when the model was not already resident.  
- Mock: probe canned `load_duration` non-zero; post-warmup cases `0`; assert saved `load_ms` equals the probe.  
- Unload+ps timeout → `cold_load.error`, omit load column (no fallback to timed-case load).

### `--hot` — discard first, keep loaded

Default bench already **does not** unload between throughput repeats of the same model. The short `--warmup` (`hi`, 8 tokens) only gets weights into VRAM; the first *full* throughput generation is often still the slow one (kernels, cache, thermal).

`--hot` measures **steady-state** tok/s:

1. Skip the short warmup unless `--warmup` is also passed.
2. Run the throughput case `--runs + 1` times.
3. Mark the first attempt `discarded: true` (`run: 0`). Exclude it from median / min / max / `early_stop_count`.
4. **Do not unload** between models (weights stay resident). `--cold-load` still unloads *that* model for its probe.

`--hot` is part of `comparability_key`. Do not compare a hot median to a default (unloaded-between-models) median.

VRAM: `--all --hot` can leave several models resident. Prefer `--hot` on one model (Finetuna before/after).

### Unload between models (async + shared-host warning)

When ≥2 models are benchmarked **and `--hot` is off**, after model A: unload → poll `/api/ps` until gone → start B. Do **not** unload between cases of the same model.

**Shared-host warning:** ollanet’s premise is remote machines on a tailnet. `keep_alive: 0` (between models and during cold-load) evicts models that may be serving someone else. When the resolved target is **not** localhost / loopback, print a preflight warning:

```text
Note: benchmarking unloads each model before the next and unloads for --cold-load on studio.
```

Nothing to change in the design — just don’t surprise people.

### Per-case timeout + preflight (no scary fake ETA)

Bench default per-case timeout: `OLLAMA_BENCH_TIMEOUT_MS` = **60_000** (not the 600s prompt timeout).

Preflight prints **counts and timeout**, not a multi-hour “estimate” that people read as the forecast:

```text
Bench: 10 completion models (skipped 2 embedding) × suite=quick × runs=3
Cases: ~40 chat calls   timeout: 60s/case   worst-case ceiling: ~40m if every call times out
Note: benchmarking unloads each model before the next on studio.
Proceeding…
```

Optional (nice): after the **first** model finishes, print an updated typical estimate (`elapsed/models_done × remaining`). Do **not** lead with worst-case alone as if it were the ETA.

---

## Prompt suites

Built-in only. Live in `src/bench-suite.ts`.

**`suite_revision`:** content hash of canonical prompt texts + check ids (automatic).

**`comparability_key`:** hash of `suite_revision` **plus** the settings that change the number:

- `throughput_num_predict` (including `--num-predict` override)
- `seed`, `temperature`
- `think`
- `num_ctx` (if set / inherited into the run)

Store both. Finetuna before/after compares **one field**; mismatch → refuse the diff. Matching `suite_revision` alone is **not** enough (user-facing `--num-predict` would otherwise silently invalidate comparisons).

### Case roles

| Role | Purpose | Speeds? | Attempts |
|---|---|---|---|
| `check` | Instruction-following / correctness | No | **1** |
| `live` | Liveness only (not quality) | No | **1** |
| `throughput` | Headline tok/s (256-token peak) | Yes | **`--runs`** (default 3) |
| `throughput` (`throughput_long`) | Sustained / chat-shaped tok/s | Yes | **1** (`full` only) |

### `quick` (default)

| id | Role | Prompt (summary) | Check |
|---|---|---|---|
| `ping` | check | `Reply with exactly: OK` | Take the **last whitespace-delimited token**, lowercase, strip wrapping punctuation; equals `ok`. So `OK.`, `Sure — OK`, and `ok` pass; measures instruction-following. |
| `math` | check | `What is 17 * 19? Reply with only the number.` | Take the **last non-empty line**, extract all integers from it; pass if `323` is **among them**. (Avoids failing on `323 (i.e., 17×19)` where “last integer” is `19`.) |
| `haiku` | live | `Write a haiku about ferrets.` | Non-empty, ≥3 lines — **liveness only**. |
| `throughput` | throughput | Enumerative prompt that resists EOS (e.g. count 1…400, one integer per line) | No content check; `num_predict` pinned; `--runs` repeats; record `done_reason`. Must hit `done_reason=length` with `eval_count === num_predict` on small and large models — if not, the prompt is wrong. |

### `full` — quick +

| id | Role | Prompt (summary) | Check |
|---|---|---|---|
| `json` | check | Ask for a **structure** (do not embed the answer JSON) | `format: "json"` and/or strip \`\`\` fences; assert keys/values |
| `reason` | check | Short multi-step word problem; final number only | Same integer rule as `math`: last line, expected value among integers |
| `throughput_long` | throughput | Chat-shaped briefing (headings, lists, a table); keep writing, do not stop | No content check; **1024** tokens; **one** attempt (not `--runs`); `--num-predict` does not apply. Timeout floors at 8 tok/s (`max(60s, 128s)`). |

---

## Execution model (per model)

1. Resolve candidates; `/api/show` for capabilities; filter/skip non-completion; warn on `--think` without `thinking`.  
2. Record identity from `/api/tags` + capabilities from show; `/api/version` once per host.  
3. If `--cold-load`: ps-first unload (if needed) → poll → 1-token probe → `cold_load`.  
4. If warmup: short discarded call. (`--hot` skips this unless `--warmup` is explicit.)  
5. Run suite cases:
   - `check` / `live`: **once** each (`temperature: 0`, `seed: 0`).  
   - `throughput`: `--runs` times with pinned `num_predict`; record `done_reason`. With `--hot`, one extra discarded first attempt.  
   - `throughput_long` (`full` only): **once**, 1024 tokens, no `--hot` discard.  
   - Errors: per-attempt; continue unless `--fail-fast`.  
   - Optional `--judge` after successful check/live (excluded from tok/s).  
6. If more models and not `--hot`: unload → ps poll → next.

Concurrency: **serial only**.

---

## Identity — record what you compare

| Field | Source |
|---|---|
| `name` | tag name |
| `digest` | from `/api/tags` (**required** for before/after) |
| `parameter_size` / `quantization_level` / `size` | tags details |
| `capabilities` | `/api/show` |

Once per run / host: `ollama_version` (`/api/version`). Per model while loaded (after timed cases, before unload): `size_vram` and `context_length` from `/api/ps` — so a Finetuna diff can show same `comparability_key`, new digest, context 4096→32768, tok/s change.

---

## Metrics

### Stored shape: per-attempt for throughput; single attempt for checks

```text
models[].cases[]
  cases[].attempts[]     length === runs for peak throughput (runs+1 when --hot); length === 1 for check/live and throughput_long
    attempt.run            1..n counted; 0 when discarded
    attempt.discarded?     true on the --hot first throughput shot
    attempt.wall_ms
    attempt.tok_s?         throughput
    attempt.done_reason?   throughput (and any chat final)
    attempt.early_stop?    true when throughput && done_reason !== "length"
    attempt.quality?
    attempt.content?
    attempt.ollama?
    attempt.error?
models[].summary         derived from attempts (median excludes early_stop)
models[].cold_load?
skipped_models[]
comparability_key
suite_revision
```

Summaries are derived; JSON must retain attempts so spread is recomputable.

### Per-model summary

- `tok_s_median` / `min` / `max` from **peak** (`throughput`) attempts with `done_reason === "length"` only  
- `tok_s_long_median` / `min` / `max` from `throughput_long` (`full` only; null on `quick`)  
- `early_stop_count` for all throughput attempts (peak + long) that did not hit the pin  
- `pass_rate` from check cases only (exclude `live`)  
- `load_ms` only if `--cold-load` succeeded  
- `self_judge` if judge === subject  

---

## Human output

```text
Bench: 3 completion models (skipped 2 embedding) × suite=quick × runs=3
comparability_key=9f3c…   suite_revision=a1b2…   timeout: 60s/case
Note: benchmarking unloads each model before the next on studio.

Model              tok/s (med)   spread      pass   notes
llama3.2:1b            98.4     96–101     2/2
gemma4:12b             42.1     40–44      1/2    math fail; 1× early-stop
fake:1b                 —         —        0/2    connection refused

Skipped 2 non-completion models: nomic-embed-text, all-minilm
```

`--suite full` adds a `tok/s long` column (one 1024-token prose shot). Peak `tok/s (med)` stays the Finetuna headline.

**Sort:** pass_rate descending, then median tok/s. Failed / zero-pass sink.

After first model (optional): `Typical remaining ≈ …` based on observed pace.

---

## `--judge`

- Requires `--judge-model` (no default).  
- Record judge name + digest; flag `self_judge`.  
- `temperature: 0`, `seed: 0`; omit score on parse failure (never store `0`).  
- Judge latency excluded from tok/s.  

---

## Persistence

| Context | Path |
|---|---|
| Checkout | `benchmarks/<id>.json` |
| Installed | `~/.ollanet/benchmarks/<id>.json` |

`OLLANET_BENCHMARKS_DIR` override. Gitignore `benchmarks/`.

```json
{
  "id": "a1b2c3d4e5f6",
  "version": 1,
  "created_at": "…",
  "ollanet": "0.2.0",
  "suite": "quick",
  "suite_revision": "a1b2c3d4…",
  "comparability_key": "9f3c…",
  "runs": 3,
  "machine": "studio",
  "host": { "ip": "100.64.0.2", "port": 11434 },
  "ollama_version": "0.x.y",
  "settings": {
    "temperature": 0,
    "seed": 0,
    "throughput_num_predict": 256,
    "throughput_long_num_predict": null,
    "num_ctx": null,
    "warmup": true,
    "hot": false,
    "cold_load": false,
    "think": false,
    "bench_timeout_ms": 60000
  },
  "skipped_models": [
    { "name": "nomic-embed-text", "reason": "non-completion", "capabilities": ["embedding"] }
  ],
  "judge": null,
  "models": [
    {
      "name": "llama3.2:1b",
      "digest": "sha256:…",
      "parameter_size": "1.2B",
      "quantization_level": "Q4_K_M",
      "capabilities": ["completion"],
      "size_vram": 123456789,
      "context_length": 8192,
      "cold_load": null,
      "summary": {
        "tok_s_median": 98.4,
        "tok_s_min": 96.0,
        "tok_s_max": 101.2,
        "early_stop_count": 0,
        "pass_rate": 1.0,
        "load_ms": null,
        "self_judge": false
      },
      "cases": [
        {
          "id": "ping",
          "role": "check",
          "attempts": [{ "run": 1, "wall_ms": 120, "quality": { "pass": true }, "content": "Sure — OK" }]
        },
        {
          "id": "throughput",
          "role": "throughput",
          "attempts": [
            {
              "run": 1,
              "wall_ms": 4100,
              "tok_s": 96.0,
              "done_reason": "length",
              "early_stop": false,
              "ollama": { "eval_count": 256, "eval_duration": 2666666666 }
            }
          ]
        }
      ]
    }
  ]
}
```

---

## Exit codes (CI)

| Code | When |
|---|---|
| `0` | Completed; failures OK unless `--fail-on-error` |
| `1` | Usage / config / unknown model / resolve failure / explicit non-completion model requested |
| `2` | `--fail-on-error` or `--fail-fast` abort with errors |

---

## Code layout

```text
src/ollama-chat.ts    # shared chat helper (EXTRACT FIRST — own commit)
src/bench.ts          # CLI + orchestration + table
src/bench-suite.ts    # Suites, checkers, suite_revision + comparability_key
src/bench-store.ts    # Persist under benchmarks/
```

### Build order (mandatory)

1. Extract `ollamaChat()` → own green commit (`pnpm test`).  
2. Extend mock: `/api/ps`, `/api/version`, `/api/show` (capabilities), canned timings, configurable **`done_reason`** and **`capabilities`** — so early-stop flags and `--all` filtering are testable without a GPU.  
3. Suite + bench orchestration.  
4. Gitignore `benchmarks/`; README + help; CHAT_RESTORE.

---

## Non-goals (v1)

- Interactive model picker TUI  
- Multi-host comparison in one command  
- Streaming TTFT charts  
- Custom prompt files / YAML suites  
- Uploading results anywhere  
- Parallel model runs  
- Thinking-level enums  
- Leaderboard / Elo claims  
- Check-case repeats folded into pass_rate  

---

## Acceptance criteria

1. Default run: `--runs 3` on throughput only; checks once; median + spread; digests + `suite_revision` + `comparability_key` saved.  
2. `cases[].attempts[]` retained; throughput length === `--runs` (or `--runs + 1` with `--hot`, first `discarded`); check length === 1; med/min/max recomputable; early-stop and discarded attempts excluded from median and flagged.  
3. `--all` benches only known non-completion exclusions; omitted/empty `capabilities` still benches. Mock covers omit-key.  
4. `--think` warns only when capabilities are present and lack `thinking`.  
5. Cold-load + warmup: probe before warmup; mock asserts `load_ms` === probe non-zero value, not post-warmup zeros; ps-first skip when already unloaded.  
6. Multi-model unload + `/api/ps` poll; non-localhost preflight unload warning. `--hot` skips that unload and prints a hot note instead.  
7. Preflight shows counts + timeout + worst-case ceiling (not a fake “ETA”); optional typical estimate after first model.  
8. `ping` accepts `Sure — OK`; `math` accepts `323 (i.e., 17×19)`.  
9. Changing `--num-predict` changes `comparability_key` even if `suite_revision` matches; warn if `--num-predict` &lt; 64.  
10. `--judge` requires `--judge-model`; self-judge flagged; parse fail omits score.  
11. Sort by pass_rate then tok/s; null tok/s sinks below defined values; `live` excluded from pass_rate.  
12. JSON records `context_length` (+ `size_vram`) from `/api/ps` while loaded.  
13. Manual GPU: on ~1B and ~12B, all three throughput attempts report `done_reason === "length"` and `eval_count === 256` (prompt must resist EOS).  
14. `pnpm test` + typecheck clean; zero new runtime deps; `ollamaChat` extract before bench code.  
15. `--suite full` adds `throughput_long` (1024, one shot); table shows `tok/s long`; `--hot` / `--runs` / `--num-predict` do not change that case.

---

## Resolved decisions

1. **Default model when omitted:** host default, else error.  
2. **Unload between models:** only when ≥2 models and not `--hot`, with `/api/ps` poll + shared-host warning.  
3. **Suite evolution:** `suite_revision` content hash; **comparability** via `comparability_key` including pins/settings (`hot` included).  
4. **`--runs`:** 256-token throughput only. `--hot` adds one discarded first shot. `throughput_long` is one attempt and ignores both.  
5. **`--all`:** completion capability filter via `/api/show`.

---

## Implementation sketch

1. Extract `ollamaChat` + green tests.  
2. Mock `/api/ps`, `/api/version`, `/api/show`, `done_reason`, capabilities, canned timings.  
3. `bench-suite.ts` (checkers + hashes).  
4. `bench.ts` + store + CLI + README.  
5. GPU smoke: completion vs embedding skip; early-stop flag; cold-load non-zero with warmup on; digest change visible after retag.
