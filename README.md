# ollanet

Chat with **Ollama** servers across your **Tailnet** from the command line.

Scan peers for models, fire one-shot prompts, and continue conversations later by a short hash — no browser UI required.

## Features

- **Discover** Ollama hosts on your Tailscale network (`tailscale status`)
- **Prompt** any peer/model with streaming replies
- **Persist** chats as `responses/<hash>.json` with topic, machine, model, timestamps
- **Continue** any thread with `--chat <hash>`
- **Configure** per-machine defaults (model, temperature, context, …)

## Requirements

- Node.js 20+
- [pnpm](https://pnpm.io)
- [Tailscale](https://tailscale.com) CLI on `PATH`, logged into your tailnet
- One or more peers running [Ollama](https://ollama.com) on port `11434` (reachable over Tailscale)

## Install

```bash
cd ollanet
pnpm install
pnpm link --global   # optional: put `ollanet` on your PATH
```

Without a global link:

```bash
pnpm ollanet -- help
# or
pnpm scan
pnpm prompt -- mycroftone "hello"
pnpm chats
```

## Quick start

```bash
# See which Tailnet peers expose Ollama + which models they have
ollanet scan

# Start a chat (saves a transcript and prints a hash + topic)
ollanet prompt mycroftone "What is MagicDNS?"

# Continue that chat later
ollanet prompt --chat a1b2c3d4e5f6 "Give a concrete example"

# Browse saved chats
ollanet chats
ollanet chats --id a1b2c3d4e5f6
```

## Commands

| Command | Description |
|---|---|
| `ollanet scan` | Probe Tailnet peers on port 11434 and list models |
| `ollanet prompt …` | Send a prompt / continue a chat |
| `ollanet chats` | List or inspect saved transcripts |

### `scan` options

- `--json` — machine-readable output
- `--all` — also probe offline peers

### `prompt` options

```text
ollanet prompt <machine> [model] <prompt...>
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

Machine names accept MagicDNS short name, hostname, FQDN, or Tailscale IP.

### `chats` options

- `--json` — list summary JSON
- `--id <hash>` — show one chat (full JSON with `--json`)

## Configuration

Edit `config.json` in the project root (or point `OLLANET_CONFIG` at another file):

```json
{
  "defaultModels": {
    "mycroftone": "gemma4:12b",
    "sams-macbook-pro": "qwen3.6:35b-mlx"
  },
  "defaults": {
    "temperature": 0.7,
    "num_predict": 512,
    "keep_alive": "5m"
  },
  "machineDefaults": {
    "mycroftone": { "num_ctx": 8192 },
    "sams-macbook-pro": { "num_ctx": 32768, "temperature": 0.6 }
  }
}
```

**Precedence:** CLI flags → env vars → `machineDefaults` → `defaults`.

### Environment

| Variable | Purpose |
|---|---|
| `OLLANET_CONFIG` | Path to config JSON |
| `OLLANET_RESPONSES_DIR` | Chat transcript directory |
| `OLLAMA_PORT` | Ollama port (default `11434`) |
| `OLLAMA_TEMPERATURE` | Default temperature |
| `OLLAMA_NUM_PREDICT` | Default max tokens |
| `OLLAMA_NUM_CTX` | Default context size |
| `OLLAMA_KEEP_ALIVE` | Default keep-alive |
| `OLLAMA_FORMAT` | Default format (`json` or schema JSON) |
| `OLLAMA_SYSTEM` | Default system prompt |
| `OLLAMA_TIMEOUT_MS` | Scan probe timeout |
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
    scan.ts
    prompt.ts
    chats.ts
    chat-store.ts
    config.ts
    tailnet.ts
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
