<p align="center">
  <img src="https://raw.githubusercontent.com/Catalyst-Forge-LLC/ollanet/main/assets/ollanet-logo.png" alt="ollanet logo" width="360">
</p>

# ollanet

Find the models. Talk to them. Keep the thread.

Chat with **Ollama** servers on **any network you can reach** — LAN, localhost, Tailscale, VPN, or a raw IP. CLI for humans, MCP for agents, **Node library for apps**.

Scan for models, fire prompts, and continue conversations later by a short hash. No browser UI required. **Node 20+ · zero runtime deps.**

**Site:** [ollanet.dev](https://ollanet.dev) — FilePress + Cloudflare Pages (`site/`).

## Origin

This started as a personal little script. I had Ollama running on a laptop on my Tailscale network and wanted an easy way to discover it, poke at the models, and actually talk to them from another machine — without babysitting IPs or opening a browser. One scan/prompt tool later, chats by hash showed up, LAN discovery crept in, and the thing grew into **ollanet**: a tiny CLI for using Ollama over whatever network you already have.

## Related: Finetuna

**ollanet** is the client-side / network tool. On the machine that *runs* Ollama, use **[Finetuna](https://finetuna.net)** to turn a stock model into a GPU-tuned, named variant (context, batch, Modelfile, auto-tune).

Typical loop:

1. On the host: `finetuna` → create something like `gemma4-ctx32k`
2. From anywhere on the network: `ollanet scan` → `ollanet prompt that-host gemma4-ctx32k "…"`

They share the same Ollama API; Finetuna shapes the models, ollanet finds and chats with them. Host tunes the model. Network finds and uses it. Same API, closed loop.

## Features

- **Discover** Ollama hosts from localhost, `config.hosts`, `OLLANET_HOSTS`, optional Tailscale, and optional LAN scan (`--lan`, off by default)
- **Pull** a library model onto a named host (`ollanet pull studio gemma3:12b`) — the server downloads; re-pull updates
- **Show / rm / ps** — inspect a Modelfile, delete a model (`--yes`), see what’s in VRAM. Scan marks Finetuna-style `[tuned]` names
- **Prompt** any hostname/IP/model with streaming replies (`--file` for `.txt` / `.md`)
- **Compare** 2–5 models on one host with the same prompt; summary table + `compares/<id>.md`
- **Persist** chats as `responses/<hash>.json` with topic, machine, model, timestamps
- **Continue** any thread with `--chat <hash>`
- **Configure** per-machine defaults (model, temperature, context, …)
- **MCP** — `ollanet mcp` exposes scan/prompt/compare/pull/show/rm/ps/chats as Model Context Protocol tools for agents
- **Library** — `import { scanNetwork } from "ollanet"` for apps (Node 20+, not the browser)

## Use cases

The core idea: turn “I have to remember which IP has which models loaded” into a discoverable, stateful, network-native primitive. That unlocks more than interactive chat:

**For agents and automation** — prefer `ollanet mcp` (stdio MCP). The same flows also work via CLI flags:

- **Live model inventory / routing** — `ollanet_scan` (or `scan --json`) lists reachable hosts and models. Route each sub-task to the best host: the big-VRAM box for reasoning, the laptop for quick lookups.
- **Put a new model on a box** — `ollanet_pull` (or `pull studio gemma3:12b`) asks that host to download from the registry. Re-pull updates. Then `show` / `ps` / `rm` manage what’s on that disk and in VRAM.
- **Conversations that survive machines** — chats are stored by short hash with full history. Start a long thread on the GPU box, continue it later with `ollanet_prompt` + `chat_id` (or `--chat <hash>`).
- **A “talk to any Ollama on my network” tool** — `ollanet_prompt` / `prompt … --json --no-stream`; no hard-coded endpoints.
- **Embed in an app** — same scan + pick + call as a library. The app does not own the GPUs; it discovers them (FilePress, CLIs, Electron, a local companion for a hosted product).
- **Fleet health and speed checks** — periodic `ollanet bench <host> --json` builds a record of which model on which machine is currently fastest (or has silently gone offline). Saved results live in `benchmarks/`.
- **The Finetuna loop** — [Finetuna](https://finetuna.net) shapes a GPU-tuned named variant on the host; ollanet `scan` / `show` / `prompt` it from anywhere on the network. After `pull`, ollanet prints the next step (`finetuna --model …`).

**For humans:**

- **Tailscale-native access** — prompt any machine by MagicDNS name from a laptop or phone (Termux) without babysitting IPs or opening a browser.
- **A private model mesh** — everyone on a shared tailnet or LAN can discover and use the same Ollama hosts, no public exposure, no central UI.
- **Multi-GPU lab** — `scan --lan` treats several machines as a pool of inference endpoints; `bench` compares the same model across hardware.
- **Audit trail / notes** — persisted chat JSON doubles as a research log you can resume from any device.

## Requirements

- Node.js 20+
- One or more [Ollama](https://ollama.com) servers reachable on port `11434` (or a custom port)

Tailscale is optional. If the `tailscale` CLI is present, peers are included automatically.

## Install

Run without installing:

```bash
npx ollanet scan
npx --allow-git=all github:Catalyst-Forge-LLC/ollanet scan        # straight from GitHub
```

> npm 12+ blocks git dependencies by default, hence `--allow-git=all` for the
> GitHub form (npm ≤11 doesn't need it). Note that npx runs a one-off command —
> it does not put `ollanet` on your PATH.

Or install globally, which puts the `ollanet` command on your PATH:

```bash
npm install -g ollanet
npm install -g --allow-git=all github:Catalyst-Forge-LLC/ollanet  # from GitHub
ollanet scan
```

When installed this way, config lives at `~/.ollanet/config.json` and chats are
saved to `~/.ollanet/responses/`.

Releases can publish from GitHub Actions via npm **trusted publishing** (OIDC + provenance). Setup notes: [docs/trusted-publishing.md](docs/trusted-publishing.md).

### From a checkout (development)

```bash
cd ollanet
pnpm install         # also builds dist/ via the prepare hook
pnpm link --global   # optional: put `ollanet` on your PATH

# Or without a global link:
pnpm ollanet -- help
pnpm scan
pnpm prompt -- localhost "hello"
pnpm chats
```

A checkout uses the repo-local `config.json` and `responses/` instead of `~/.ollanet/`.

## Quick start

```bash
# Find Ollama servers (localhost + configured hosts + Tailscale if available)
ollanet scan

# Also TCP-scan your local /24s for open Ollama ports
ollanet scan --lan

# Put a library model on a named machine (that host downloads it)
ollanet pull studio gemma3:12b
ollanet show studio gemma3:12b
ollanet ps studio

# Talk to a machine by name, MagicDNS name, or IP
ollanet prompt localhost "What is MagicDNS?"
ollanet prompt localhost --file ./notes.md
ollanet compare studio gemma3:12b llama3.2:3b --prompt "Explain MagicDNS"
ollanet prompt 192.168.1.50 gemma4:12b "Hello from the LAN"

# Continue later
ollanet prompt --chat a1b2c3d4e5f6 "Give a concrete example"

# Browse saved chats
ollanet chats
ollanet chats --id a1b2c3d4e5f6
```

## Use as a library

ollanet is a **Node 20+ library that happens to have a CLI**. Not for the browser — discovery uses `node:net`, `child_process` (`tailscale status`), and `os.networkInterfaces()`. Call it from a dev server, CLI, Electron main, or a Worker with Node, never from Svelte/Vite client code.

Hard-coding `http://127.0.0.1:11434` treats Ollama like a local daemon. This treats it like a **private inference mesh**: any machine you can already reach. The app does not own the GPUs; it discovers them. LAN scan is opt-in so you do not look like a port scanner. Tailscale is automatic if the CLI exists. Config lives in `~/.ollanet` unless you pass `config`.

```ts
import { scanNetwork } from "ollanet";

const { servers, sources } = await scanNetwork({ lanScan: false });
for (const s of servers) {
  console.log(s.endpoint, s.models.map((m) => m.name));
}
```

| Call | What it does | When apps should use it |
|---|---|---|
| `scanNetwork()` | localhost + config + `OLLANET_HOSTS` + Tailscale | Button / first “find servers” |
| `scanNetwork({ lanScan: true })` | plus TCP sweep of local `/24`s on port 11434 | Checkbox; never the default scan, never on every health check |
| `lastScan()` | last saved snapshot, no network | UI “show last inventory” |
| `discoverHosts()` then probe yourself | candidates only, no `/api/tags` | If the app already has its own Ollama client |

Pass `config` to skip the file (useful when the app already has its own config):

```ts
await scanNetwork({
  lanScan: false,
  config: {
    hosts: ["studio.tailnet.ts.net", "192.168.1.50"],
    discovery: { localhost: true, tailscale: true, lan: false },
  },
});
```

`runPrompt({ save: false, writeStdout: false })` is a one-shot call that does not write `~/.ollanet/responses/`.

`pullModel({ machine, model })` asks that host to download (or update) a library model. The bits never transit ollanet. `showModel`, `removeModel({ yes: true })`, and `listLoaded` are the inspect / delete / VRAM trio.

Requires **ollanet ≥ 0.4.0** (library). **Model management (`pull` / `show` / `rm` / `ps`) needs ≥ 0.5.0.** **Compare, `lastScan`, and bench `--hot` need ≥ 0.6.0.** **`resolveTarget` / `listTargets` need ≥ 0.6.1.** Bundlers (Vite / SvelteKit SSR):

```ts
// vite.config.ts
ssr: { external: ["ollanet"] },
optimizeDeps: { exclude: ["ollanet"] },
```

## Commands

| Command | Description |
|---|---|
| `ollanet scan` | Probe known/discovered hosts for Ollama + list models |
| `ollanet pull <machine> <model>` | Ask that host to download / update a library model |
| `ollanet show <machine> <model>` | Inspect Modelfile / params / capabilities (`[tuned]` when it looks like Finetuna) |
| `ollanet rm <machine> <model> --yes` | Delete a model from that host’s disk |
| `ollanet ps [machine]` | Models loaded in VRAM, with CPU/GPU % (omit machine = every discovered host) |
| `ollanet prompt …` | Send a prompt / continue a chat (`--file` for `.txt` / `.md`) |
| `ollanet compare …` | Same prompt on 2–5 models; summary + `compares/<id>.md` |
| `ollanet chats` | List or inspect saved transcripts |
| `ollanet bench …` | Benchmark models for tok/s + lightweight quality checks |
| `ollanet mcp` | Stdio [MCP](https://modelcontextprotocol.io) server for agents |
| `ollanet help [command]` | This overview, or one command’s flags (`ollanet help bench`, `ollanet bench help`) |

### `scan` options

- `--json` — machine-readable output
- `--all` — also probe offline Tailscale peers
- `--lan` — scan local LAN CIDRs for open Ollama ports
- `--last` / `--cached` — print the last saved scan (no network). Written to `~/.ollanet/last-scan.json` when installed, or `./last-scan.json` in a checkout (`OLLANET_LAST_SCAN` overrides).

### `prompt` options

```text
ollanet prompt <machine|ip> [model] <prompt...>
ollanet prompt --chat <hash> <prompt...>
```

| Flag | Meaning |
|---|---|
| `--chat <hash>` | Continue a saved chat |
| `--machine <name>` | Explicit machine (or override when continuing) |
| `--model <name>` | Model override |
| `--system <text>` | System prompt |
| `--temperature <n>` | Sampling temperature |
| `--num-predict <n>` | Max tokens to generate |
| `--num-ctx <n>` | Context window |
| `--keep-alive <value>` | Keep model loaded (`5m`, `0`, `-1`, …) |
| `--format json\|<schema>` | JSON mode / schema |
| `--think` / `--no-think` | Enable/disable model thinking (default **off** so replies aren’t empty on qwen3-style models) |
| `--file <path>` | Prompt from a `.txt` or `.md` file (joins argv / stdin) |
| `--no-stream` | Buffer the full reply |
| `--no-save` | Do not write a transcript |
| `--json` | Emit JSON (includes chat id when saved) |

Machine can be a discovered name, hostname, FQDN, or IP (`192.168.1.50`, `host:11434`). Direct addresses work even if they were never scanned.

### `compare` options

```text
ollanet compare <machine> <model> <model> [model...]
ollanet compare <machine> <model> <model> [model...] --prompt <text>
ollanet compare <machine> <model> <model> [model...] --file <path.txt|.md>
```

Same prompt on **2–5 models** on one host. Prints a tok/s table and writes `compares/<id>.md` (readable) plus `.json`. This is not `bench` (no fixed suite / repeats). Omit `--prompt` / `--file` to use the built-in mesh-host tasting prompt (printed on stderr when used).

| Flag | Meaning |
|---|---|
| `--prompt` / `-p` | Prompt text (default: built-in) |
| `--file` / `-f` | Prompt from `.txt` or `.md` |
| `--system` | System prompt |
| `--temperature` / `--num-predict` / `--num-ctx` / `--keep-alive` | Same as `prompt` |
| `--think` / `--no-think` | Thinking (default off) |
| `--unload` | Unload each model before the next (fairer tok/s) |
| `--no-save` | Do not write `compares/*` |
| `--json` | Full record on stdout |

Override dir with `OLLANET_COMPARES_DIR`.

### `pull` options

```text
ollanet pull <machine|ip> <model>
```

The named machine downloads from the Ollama registry onto **its** disk. Re-pulling the same name updates it. This is not a file upload and not a Finetuna runtime tune.

| Flag | Meaning |
|---|---|
| `--machine <name>` | Host (same resolution as `prompt`) |
| `--model <name>` | Model to pull |
| `--insecure` | Allow HTTP / self-signed registries |
| `--no-stream` | Single final response (no progress chunks) |
| `--json` | Result JSON on stdout |

Timeout default is none (large pulls can take hours). Override with `OLLAMA_PULL_TIMEOUT_MS`. After a successful pull, stderr points at [Finetuna](https://finetuna.net) for a host-side named variant.

### `show` / `rm` / `ps`

```text
ollanet show <machine|ip> <model>
ollanet rm <machine|ip> <model> --yes
ollanet ps [machine]
```

| Flag | Meaning |
|---|---|
| `--yes` / `-y` | Required for `rm` unless you confirm on a TTY |
| `--json` | Result JSON on stdout |
| `--machine` / `--model` | Same host resolution as `prompt` |

`scan` is on-disk inventory and marks `*-ctx32k` / `*-flash` / `*finetuna*` as `[tuned]`. `ps` is what’s resident. `show` reads the Modelfile so you can see a Finetuna bake from another machine.

### `chats` options

- `--json` — list summary JSON
- `--id <hash>` — show one chat (full JSON with `--json`)

### `mcp`

```bash
ollanet mcp
```

Runs a **stdio MCP server** (no extra npm deps). Cursor / Claude Desktop / any MCP host can spawn it and call:

| Tool | What it does |
|---|---|
| `ollanet_scan` | Discover hosts + models (`lan`, `all`, `last` optional) |
| `ollanet_prompt` | Prompt a host or continue with `chat_id` (`file` optional) |
| `ollanet_compare` | Same prompt on 2–5 models (`machine`, `models`; `prompt` / `file` optional) |
| `ollanet_pull` | Pull / update a model on a host (`machine`, `model`) |
| `ollanet_show` | Inspect a model (`machine`, `model`) |
| `ollanet_rm` | Delete a model (`machine`, `model`, `confirm: true`) |
| `ollanet_ps` | Loaded models (`machine` optional) |
| `ollanet_list_chats` | Summarize saved transcripts |
| `ollanet_get_chat` | Load one chat (full history) |

Example Cursor MCP config (`~/.cursor/mcp.json` or project `.cursor/mcp.json`):

```json
{
  "mcpServers": {
    "ollanet": {
      "command": "npx",
      "args": ["-y", "ollanet", "mcp"]
    }
  }
}
```

Or, from a checkout: `"command": "pnpm"`, `"args": ["ollanet", "--", "mcp"]` (with `cwd` set to the repo). Uses the same config/chats dirs as the CLI (`~/.ollanet/` when installed).

### `bench`

```bash
ollanet bench <machine|ip> [model...]
ollanet bench <machine|ip> --all
ollanet bench localhost gemma4:12b --runs 5 --cold-load --json
ollanet bench localhost gemma4:12b --hot --runs 5
```

Runs a built-in suite (`quick` default, or `--suite full`) against one or more **completion**
models: instruction checks once, 256-token throughput repeated (`--runs`, default 3) with
pinned `num_predict` / `seed` / `temperature`. Reports median tok/s + spread.
`--hot` discards the first 256-token run and leaves models loaded so the counted
repeats are already warm (Finetuna steady-state). `--suite full` also runs json/reason
checks and **one** 1024-token prose generation (`tok/s long`) — closer to a long chat
reply. Under `--all`,
skips non-completion models (embeddings); multimodal `completion`+`vision` models stay in
(early-stop / pass_rate handle text-suite failures). Use `--exclude-vision` to drop them.
Saves `benchmarks/<id>.json` (or `~/.ollanet/benchmarks/` when installed).
See [`docs/bench-spec.md`](docs/bench-spec.md) for measurement rules.

`quick` has only two scored checks (`ping`, `math`), so `pass` is a coarse
liveness/sanity gauge (`0/2`, `1/2`, `2/2`) — not “50% broken.” Use `--suite full`
when you care more about the quality signal or want the long tok/s column.

## Discovery

ollanet combines several sources (deduped by `ip:port`):

| Source | When |
|---|---|
| localhost | Always (unless disabled) |
| `config.hosts` | Always when configured |
| `OLLANET_HOSTS` | Env comma/space list of hosts/IPs |
| Tailscale | If `tailscale status --json` works |
| LAN scan | `ollanet scan --lan` or `discovery.lan: true` |

## Configuration

Edit `~/.ollanet/config.json` (installed) or `config.json` (checkout) — or point
`OLLANET_CONFIG` at another file:

```json
{
  "hosts": [
    "192.168.1.50",
    { "name": "studio", "host": "studio.local", "port": 11434 }
  ],
  "discovery": {
    "localhost": true,
    "tailscale": true,
    "lan": false,
    "cidrs": ["192.168.1.0/24"]
  },
  "defaultModels": {
    "localhost": "llama3.2:1b",
    "studio": "gemma4:12b"
  },
  "defaults": {
    "temperature": 0.7,
    "num_predict": 512,
    "keep_alive": "5m",
    "think": false
  },
  "machineDefaults": {
    "studio": { "num_ctx": 16384 }
  }
}
```

**Precedence:** CLI flags → env vars → `machineDefaults` → `defaults`.

### Environment

| Variable | Purpose |
|---|---|
| `OLLANET_CONFIG` | Path to config JSON |
| `OLLANET_RESPONSES_DIR` | Chat transcript directory |
| `OLLANET_HOSTS` | Extra hosts/IPs to include |
| `OLLANET_LAN_TIMEOUT_MS` | Per-IP LAN probe timeout (default `200`) |
| `OLLANET_LAN_CONCURRENCY` | LAN probe concurrency (default `64`) |
| `OLLAMA_PORT` | Default Ollama port (`11434`) |
| `OLLAMA_TEMPERATURE` | Default temperature |
| `OLLAMA_NUM_PREDICT` | Default max tokens |
| `OLLAMA_NUM_CTX` | Default context size |
| `OLLAMA_KEEP_ALIVE` | Default keep-alive |
| `OLLAMA_FORMAT` | Default format (`json` or schema JSON) |
| `OLLAMA_SYSTEM` | Default system prompt |
| `OLLANET_THINK` / `OLLAMA_THINK` | Enable thinking (`true`/`false`; default off) |
| `OLLAMA_TIMEOUT_MS` | HTTP scan/probe timeout |
| `OLLAMA_PROMPT_TIMEOUT_MS` | Prompt/chat HTTP timeout (default `600000`; `0` = none) |
| `OLLAMA_BENCH_TIMEOUT_MS` | Per-case bench timeout (default `60000`) |
| `OLLANET_BENCHMARKS_DIR` | Benchmark result directory |
| `OLLAMA_CONCURRENCY` | Scan concurrency |

## Chat transcripts

Each saved chat is a JSON file:

```text
~/.ollanet/responses/<hash>.json   # installed
responses/<hash>.json              # checkout
```

Fields include `id`, `topic`, `machine`, `model`, `system`, `created_at`, `updated_at`, and a `messages[]` array (`role`, `content`, `timestamp`, plus assistant `stats`).

The first turn asks the model for a short topic title (falls back to the prompt text).

## Project layout

```text
ollanet/
  src/
    index.ts          # public library entry (scan, discover, prompt, ollama helpers)
    cli.ts            # subcommand router (CLI entry)
    hosts.ts          # discovery + host resolution
    scan.ts
    prompt.ts
    chats.ts
    chat-store.ts
    config.ts
    paths.ts          # checkout vs installed path resolution
    ollama-chat.ts    # shared /api/chat (+ tags/show/ps helpers)
    mcp.ts            # stdio MCP server
    bench.ts          # ollanet bench
    bench-suite.ts
    bench-store.ts
  dist/               # compiled output (published to npm)
  docs/bench-spec.md  # bench measurement spec
  docs/library-api-spec.md
  config.json
  responses/          # gitignored chat history
  benchmarks/         # gitignored bench results
```

## Development

```bash
pnpm install          # builds dist/ via prepare
pnpm typecheck
pnpm test             # build dist/, then run node:test suite
pnpm ollanet -- scan  # runs from source via tsx
pnpm build            # compile dist/ manually
```

Tests use Node’s built-in test runner against `dist/` (what gets published), with an
in-process mock Ollama server — no real models or Tailscale required.

## License

MIT
