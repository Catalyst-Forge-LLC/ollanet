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
| `--no-stream` / `--no-save` / `--json` | Output / persistence |

## Transcripts

Chats are stored as `responses/<hash>.json` with topic, machine, model, and timestamps. List them with `ollanet chats` (`--id <hash>`, `--json`).

Continue from any device that shares the responses dir (or the same `~/.ollanet/` when installed).
