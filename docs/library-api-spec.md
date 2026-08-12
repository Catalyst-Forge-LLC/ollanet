# Library API (0.4.0)

**Status:** Implemented  
**Spec kind:** Feature

## Problem

ollanet’s discovery and prompt logic already exist (`scanNetwork`, `discoverHosts`, `runPrompt`, `ollamaChat`), but npm advertises a CLI only: `bin`, no `exports`, no `main`, no `.d.ts`. Apps (FilePress) had to import `ollanet/dist/scan.js`. Vite then failed on `import('ollanet')` because there is no package entry.

MCP is the agent version of the same idea. A public `import` surface is the app version. Hard-coding `http://127.0.0.1:11434` treats Ollama like a local daemon. ollanet should treat it like a **private inference mesh** — any machine the process can already reach.

## Goals

- Publish a real package entry: `import { scanNetwork } from "ollanet"`.
- Emit TypeScript declarations so consumers do not ship shims.
- Node 20+ only; bundler-safe (no work / no throws at import time).
- LAN scan stays opt-in in the library, matching the CLI.
- Optional in-memory `config` so apps need not teach users `~/.ollanet`.
- `runPrompt({ save: false })` is first-class (already true; keep it documented).
- CLI, MCP, and `~/.ollanet` stay unchanged for humans and agents.

## Non-goals

- Browser / Vite client usage (discovery uses `node:net`, `child_process`, `os.networkInterfaces()`).
- Default-exporting `main()` CLI entrypoints, the MCP stdio server, or the bench suite.
- Changing health-check policy in consumers (FilePress health stays on `OLLAMA_HOST`; scan is a user action).

## Proposed approach

### Package entry

`package.json`: `exports["."]` → `dist/index.js` + `dist/index.d.ts`; optional `./scan` subpath; `types`; `files` already `dist` + README + LICENSE. `bin` still `dist/cli.js`. Version **0.4.0**.

`src/index.ts` re-exports library API only (scan, hosts, config, prompt, ollama client helpers). Shebang only on `cli.ts`. `declaration: true` in `tsconfig.build.json`.

### Import-time safety

Do not read/validate `OLLAMA_PORT` (or other numeric env) at module load. Read inside `discoverHosts` / `scanNetwork` / prompt so a bad env var fails the *call*, not `import "ollanet"`.

### Scan contract

| Call | What it does | When apps should use it |
|---|---|---|
| `scanNetwork()` | localhost + config + `OLLANET_HOSTS` + Tailscale | Button / first “find servers” |
| `scanNetwork({ lanScan: true })` | plus TCP sweep of local `/24`s | Checkbox, never on every health check |
| `discoverHosts()` then probe yourself | candidates only, no `/api/tags` | App already has its own Ollama client |

If `config` is passed to `scanNetwork`, skip the config file. If omitted, keep `~/.ollanet/config.json` / `OLLANET_CONFIG`.

### Positioning (apps)

The app does not own the GPUs; it **discovers** them. Same shape as AirPlay / printers / Chromecast, not “set an API key.” Privacy: nothing leaves networks the user already trusts. LAN stays opt-in so apps do not look like a port scanner.

Concrete use cases: design/authoring tools (FilePress), devtools/CLIs, agents (MCP wraps the same scan), routing/failover, team/lab mesh + Finetuna, “bring your own Ollama” products, honest empty states (“localhost down, studio has 8 models”).

## Edge cases

- Bad `OLLAMA_PORT` must not throw on import; CLI `scan` still fails loudly when it runs.
- `scanNetwork({ config })` must not read the config file (hermetic for apps/tests).
- Default export must not include `main`.
- `save: false` must not write `~/.ollanet/responses/`.

## Acceptance criteria

- [x] `import { scanNetwork } from "ollanet"` resolves via `exports` to `dist/index.js` with types.
- [x] `declaration: true`; consumers get `.d.ts`.
- [x] Importing the package with `OLLAMA_PORT=abc` does not throw.
- [x] `scanNetwork({ config, lanScan: false })` skips the file and does not LAN-scan.
- [x] README “Use as a library”: Node-only, LAN opt-in, Vite `ssr.external` / `optimizeDeps.exclude`.
- [x] Tests against `dist/` for the package entry.
- [ ] Publish `0.4.0` (GitHub Actions `workflow_dispatch` / Release — not a version-bump trigger).
