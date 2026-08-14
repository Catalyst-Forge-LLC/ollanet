# Pull a model onto a host (0.5.0)

**Status:** Implemented  
**Spec kind:** Feature

## Problem

New models land in the Ollama library constantly. ollanet can already find a host and chat with whatever is already there, but adding or updating a model meant SSH + `ollama pull`, or a raw `curl` to `/api/pull`. The mesh client should be able to ask the GPU box to download.

## Goals

- `ollanet pull <machine> <model>` — same host resolution as `prompt` / `bench`.
- The **named machine** downloads from the registry onto its own disk. ollanet does not upload weights.
- Re-pull updates when the registry has a newer digest.
- MCP tool `ollanet_pull` and library `pullModel()` for agents and apps.
- Progress on stderr; `--json` for the final result.

## Non-goals

- Uploading a local GGUF / blob (`/api/create` + `/api/blobs`) — Finetuna’s territory for named variants.
- Delete / copy / push as part of *this* spec (`rm` / `show` / `ps` live in [models-spec.md](./models-spec.md)).
- Auth for Ollama (none exists by default; same as scan/prompt).
- Defaulting the model from `defaultModels` — pull must name what to fetch.

## Approach

`POST /api/pull` with `{ model, stream, insecure? }`. Stream NDJSON progress (`status`, `digest`, `total`, `completed`). Timeout default **0** (none); override with `OLLAMA_PULL_TIMEOUT_MS`.

`<machine>` is a discovered name, MagicDNS name, hostname, or IP[:port] — e.g. `studio` in `ollanet pull studio gemma3:12b`.

## Acceptance criteria

- [x] CLI: `ollanet pull studio gemma3:12b` POSTs `/api/pull` to that host.
- [x] `--json`, `--no-stream`, `--insecure`.
- [x] Unknown host / missing model / Ollama error fail loudly.
- [x] `import { pullModel } from "ollanet"`.
- [x] MCP `ollanet_pull` (`machine`, `model`, optional `insecure`).
- [x] Publish `0.5.0` (workflow_dispatch / Release — not a version-bump trigger).
