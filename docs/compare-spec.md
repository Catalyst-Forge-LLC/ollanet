# Head-to-head compare (0.5.0)

**Status:** Implemented  
**Spec kind:** Feature

## Problem

`bench` is a fixed suite for tok/s and light quality. Users want to drop in **their** prompt (typed or a `.txt` / `.md` file), run it on 2–5 models on one host, and keep a file that shows the prompt plus each reply and stats.

## Goals

- `ollanet compare <machine> <m1> <m2> [m3] [m4] [m5] --prompt "…" | --file path`
- 2–5 models, same host resolution as `prompt`
- Summary table (tok/s, tokens, wall, done)
- Write `compares/<id>.md` and `.json`
- `prompt --file` for `.txt` / `.md` only (joins argv / stdin)
- MCP `ollanet_compare` + library `runCompare`

## Non-goals

- Replacing `bench` (no suite, no repeats, no judge)
- More than 5 models
- Binary / `.json` / `.pdf` prompt files
- Saving five chat transcripts (this is a compare record, not `responses/`)

## Acceptance criteria

- [x] Compare requires 2–5 models and a prompt (`--prompt`, `--file`, and/or stdin).
- [x] Saved markdown includes the prompt and each model’s reply + stats.
- [x] `prompt --file` accepts `.txt`/`.md` and rejects other extensions.
- [x] MCP + library.
- [ ] Publish `0.5.0`.
