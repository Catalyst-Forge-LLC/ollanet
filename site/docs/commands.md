---
title: Commands
---

| Command | Description |
|---|---|
| `ollanet scan` | Probe hosts + list models |
| `ollanet pull <machine> <model>` | Download / update a library model on that host |
| `ollanet show <machine> <model>` | Inspect Modelfile / params / capabilities |
| `ollanet rm <machine> <model> --yes` | Delete a model from that host’s disk |
| `ollanet ps [machine]` | Models loaded in VRAM, with CPU/GPU % |
| `ollanet prompt …` | Send a prompt / continue a chat |
| `ollanet compare …` | Same prompt on 2–5 models |
| `ollanet chats` | List or inspect saved transcripts |
| `ollanet bench …` | Benchmark tok/s + light quality checks |
| `ollanet alias …` | Add / list / remove machine+model shortcuts |
| `ollanet mcp` | Stdio MCP server for agents |
| `ollanet help [command]` | Overview, or one command’s flags |

## Per-command help

```bash
ollanet help bench
ollanet bench --help
ollanet bench help
```

Intentional help prints to stdout and exits 0. Usage errors go to stderr with exit 1.

## Quiet output

Results go to stdout. Informational lines (the `→ host model=` line, chat ids and continue hints, saved paths, the default-prompt notice, bench plans, pull progress and hints) go to stderr. Pass `-q` / `--quiet` to any command, or set `OLLANET_QUIET=1`, to drop them so stderr only carries real errors and warnings. `--think` reasoning still streams to stderr because you asked for it. This keeps agent and PowerShell runs clean (`2>&1` shows no NativeCommandError noise).

```bash
ollanet compare studio gemma3:12b llama3.2:3b --prompt "hi" -q
git diff | ollanet prompt desk "Review this" --stdin -q
```

`pull` and `rm` modify the remote host. `prompt`, `compare`, and `bench` send prompt text to that host. See [Network](/docs/network).

Deep pages: [Scan](/docs/scan), [Prompt](/docs/prompt), [Models](/docs/models), [Compare](/docs/compare), [Bench](/docs/bench), [Network](/docs/network), [MCP](/docs/mcp), [Library](/docs/library), [Configuration](/docs/config).
