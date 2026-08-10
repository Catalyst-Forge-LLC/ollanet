# ollanet

Chat with **Ollama** servers on **any network you can reach** — LAN, localhost, Tailscale, VPN, or a raw IP.

Scan for models, fire prompts, and continue conversations later by a short hash. No browser UI required.

## Origin

This started as a selfish little script. I had Ollama running on a laptop on my Tailscale network and wanted an easy way to discover it, poke at the models, and actually talk to them from another machine — without babysitting IPs or opening a browser. One scan/prompt tool later, chats by hash showed up, LAN discovery crept in, and the thing grew into **ollanet**: a tiny CLI for using Ollama over whatever network you already have.

## Features

- **Discover** Ollama hosts from localhost, `config.hosts`, `OLLANET_HOSTS`, optional Tailscale, and optional LAN scan
- **Prompt** any hostname/IP/model with streaming replies
- **Persist** chats as `responses/<hash>.json` with topic, machine, model, timestamps
- **Continue** any thread with `--chat <hash>`
- **Configure** per-machine defaults (model, temperature, context, …)

## Requirements

- Node.js 20+
- [pnpm](https://pnpm.io)
- One or more [Ollama](https://ollama.com) servers reachable on port `11434` (or a custom port)

Tailscale is optional. If the `tailscale` CLI is present, peers are included automatically.

## Install

```bash
cd ollanet
pnpm install
pnpm link --global   # optional: put `ollanet` on your PATH
```

Without a global link:

```bash
pnpm ollanet -- help
pnpm scan
pnpm prompt -- localhost "hello"
pnpm chats
```

## Quick start

```bash
# Find Ollama servers (localhost + configured hosts + Tailscale if available)
ollanet scan

# Also TCP-scan your local /24s for open Ollama ports
ollanet scan --lan

# Talk to a machine by name, MagicDNS name, or IP
ollanet prompt localhost "What is MagicDNS?"
ollanet prompt 192.168.1.50 gemma4:12b "Hello from the LAN"

# Continue later
ollanet prompt --chat a1b2c3d4e5f6 "Give a concrete example"

# Browse saved chats
ollanet chats
ollanet chats --id a1b2c3d4e5f6
```

## Commands

| Command | Description |
|---|---|
| `ollanet scan` | Probe known/discovered hosts for Ollama + list models |
| `ollanet prompt …` | Send a prompt / continue a chat |
| `ollanet chats` | List or inspect saved transcripts |

### `scan` options

- `--json` — machine-readable output
- `--all` — also probe offline Tailscale peers
- `--lan` — scan local LAN CIDRs for open Ollama ports

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
| `--no-stream` | Buffer the full reply |
| `--no-save` | Do not write a transcript |
| `--json` | Emit JSON (includes chat id when saved) |

Machine can be a discovered name, hostname, FQDN, or IP (`192.168.1.50`, `host:11434`). Direct addresses work even if they were never scanned.

### `chats` options

- `--json` — list summary JSON
- `--id <hash>` — show one chat (full JSON with `--json`)

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

Edit `config.json` (or point `OLLANET_CONFIG` at another file):

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
    "keep_alive": "5m"
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
| `OLLAMA_TIMEOUT_MS` | HTTP scan/probe timeout |
| `OLLAMA_CONCURRENCY` | Scan concurrency |

## Chat transcripts

Each saved chat is a JSON file:

```text
responses/<hash>.json
```

Fields include `id`, `topic`, `machine`, `model`, `system`, `created_at`, `updated_at`, and a `messages[]` array (`role`, `content`, `timestamp`, plus assistant `stats`).

The first turn asks the model for a short topic title (falls back to the prompt text).

## Project layout

```text
ollanet/
  bin/ollanet.mjs     # CLI entry
  src/
    cli.ts            # subcommand router
    hosts.ts          # discovery + host resolution
    scan.ts
    prompt.ts
    chats.ts
    chat-store.ts
    config.ts
  config.json
  responses/          # gitignored chat history
```

## Development

```bash
pnpm install
pnpm typecheck
pnpm ollanet -- scan
```

## License

MIT
