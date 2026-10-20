---
title: Prompt and chats
---

```bash
ollanet prompt <machine|ip|alias> [model] <prompt...>
ollanet prompt --chat <hash> <prompt...>
ollanet prompt <machine|ip> --file <path.txt|.md>
```

Machine can be a discovered name, hostname, FQDN, IP (`192.168.1.50`, `host:11434`), or an **alias** from `ollanet alias` / `config.aliases`. Direct addresses work even if they were never scanned.

```bash
ollanet alias add desk studio gemma3:12b
ollanet prompt desk "hello"
```

## Common flags

| Flag | Meaning |
|---|---|
| `--chat <hash>` | Continue a saved chat |
| `--machine` / `--model` | Explicit host / model |
| `--system <text>` | System prompt |
| `--temperature` / `--num-predict` / `--num-ctx` / `--keep-alive` | Generate options |
| `--think` / `--no-think` | Thinking tokens (default **off**) |
| `--file <path>` | Prompt from `.txt` or `.md` |
| `--stdin` / `-` | Wait for stdin to close and use it as the prompt |
| `--no-stream` / `--no-save` / `--json` | Output / persistence |
| `-q` / `--quiet` | Reply only on stdout; no host line, chat id, or stats on stderr |

## Piped stdin

Piped stdin joins the prompt (after argv and `--file`). Without a flag, ollanet uses stdin only if data arrives within 100ms, so an agent or CI pipe that never closes cannot hang the command. For a slow producer, pass `--stdin` (or `-`) to wait for end of input with no cutoff:

```bash
git diff | ollanet prompt desk "Review this diff" --stdin
```

The selected host receives the prompt text, and the prior turns when you continue a chat. This package does not include vendor telemetry. Prompt traffic still goes to that Ollama endpoint.

## Transcripts

Chats are stored as `responses/<hash>.json` with topic, machine, model, and timestamps. List them with `ollanet chats` (`--id <hash>`, `--json`). Use `--no-save` to skip writing a transcript.

Continue from any device that shares the responses dir (or the same `~/.ollanet/` when installed). Other machines do not receive chats automatically.
