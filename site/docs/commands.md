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

Deep pages: [Scan](/docs/scan), [Prompt](/docs/prompt), [Models](/docs/models), [Compare](/docs/compare), [Bench](/docs/bench), [MCP](/docs/mcp), [Library](/docs/library), [Configuration](/docs/config).
