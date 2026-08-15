---
title: Compare
---

Same prompt on **2–5 models** on one host. Not a fixed bench suite.

```bash
ollanet compare <machine> <model> <model> [model...]
ollanet compare studio gemma3:12b llama3.2:3b --prompt "Explain MagicDNS"
ollanet compare studio gemma3:12b llama3.2:3b --file ./notes.md
```

Prints a tok/s table and writes `compares/<id>.md` plus `.json`. Omit `--prompt` / `--file` to use the built-in mesh-host tasting prompt.

| Flag | Meaning |
|---|---|
| `--prompt` / `-p` | Prompt text |
| `--file` / `-f` | Prompt from `.txt` or `.md` |
| `--unload` | Unload each model before the next |
| `--think` / `--no-think` | Thinking (default off) |
| `--no-save` / `--json` | Persistence / stdout |

Override dir with `OLLANET_COMPARES_DIR`.
