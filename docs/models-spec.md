# Model management on a host (0.5.0)

**Status:** Implemented  
**Spec kind:** Feature

## Problem

`pull` can put a library model on a machine. The rest of the loop — inspect a Finetuna variant, see what’s in VRAM, delete leftovers — still meant SSH or raw curl.

## Goals

- `ollanet show <machine> <model>` — `/api/show` (Modelfile, parameters, capabilities). Mark Finetuna-style names `[tuned]`.
- `ollanet rm <machine> <model> --yes` — `/api/delete`. Loud default: `--yes` or TTY confirm. MCP requires `confirm: true`.
- `ollanet ps [machine]` — `/api/ps`. Disk vs resident. Optional host; omit = every discovered host.
- Scan marks tuned names (`-ctx32k`, `-flash`, `finetuna`, or Modelfile text on `show`).
- After `pull`, point at [Finetuna](https://finetuna.net) for a host-side named variant. Do **not** remote-run Finetuna.

## Non-goals

- `create` / blob upload / auto-tune from the laptop (Finetuna).
- `copy` / `push`.
- Calling `/api/show` once per model during `scan` (too slow). Name heuristic only.

## Acceptance criteria

- [x] CLI + library + MCP for show / rm / ps.
- [x] `rm` without `--yes` / `confirm` does not delete.
- [x] `scan --json` includes `models[].tuned`.
- [x] `pull` result includes a Finetuna `next` hint.
- [ ] Publish `0.5.0` (workflow_dispatch / Release).
