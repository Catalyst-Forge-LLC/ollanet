---
title: Models
---

Manage models on a named host — the server downloads; ollanet does not upload weights.

```bash
ollanet pull <machine> <model>
ollanet show <machine> <model>
ollanet rm <machine> <model> --yes
ollanet ps [machine]
```

## pull

Asks that machine to download or update a library model from the Ollama registry. Re-pull updates. After success, stderr points at [Finetuna](https://finetuna.net) for a host-side named variant.

| Flag | Meaning |
|---|---|
| `--insecure` | Allow HTTP / self-signed registries |
| `--no-stream` | Single final response |
| `--json` | Result JSON on stdout |

## show / rm / ps

| Flag | Meaning |
|---|---|
| `--yes` / `-y` | Required for `rm` unless you confirm on a TTY |
| `--json` | Result JSON |

`scan` is on-disk inventory. `ps` is what’s resident (includes CPU/GPU % matching `ollama ps`). `show` reads the Modelfile so you can inspect a Finetuna bake from another machine.
