---
title: Configuration
---

Edit `~/.ollanet/config.json` (installed) or `config.json` (checkout) — or set `OLLANET_CONFIG`.

No config file is required: without one, ollanet probes localhost and Tailscale with built-in defaults. In a checkout, `config.json` is gitignored; copy `config.example.json` to start.

```json
{
  "hosts": [
    "192.168.1.50",
    { "name": "studio", "host": "studio.tail1234.ts.net" }
  ],
  "defaultModels": {
    "studio": "gemma3:12b"
  },
  "aliases": {
    "desk": { "machine": "studio", "model": "gemma3:12b" }
  },
  "defaults": {
    "temperature": 0.7,
    "num_ctx": 8192
  },
  "discovery": {
    "localhost": true,
    "tailscale": true,
    "lan": false
  }
}
```

## Aliases

Frequent machine + model pairs:

```bash
ollanet alias add desk studio gemma3:12b
ollanet alias list
ollanet prompt desk "hello"
ollanet alias rm desk
```

`aliases` in the JSON is the same store. An alias used as the first token expands both host and model (unless you pass an explicit model).

## Environment

| Variable | Role |
|---|---|
| `OLLANET_CONFIG` | Config file path |
| `OLLANET_HOSTS` | Extra hosts |
| `OLLANET_RESPONSES_DIR` | Chat transcripts |
| `OLLANET_LAST_SCAN` | Last-scan snapshot |
| `OLLANET_COMPARES_DIR` / `OLLANET_BENCHMARKS_DIR` | Compare / bench output |
| `OLLAMA_*_TIMEOUT_MS` | Per-operation timeouts |
| `OLLANET_PROGRESS` | `1` forces `compare` / `bench` progress lines (`→ model (1/2)`) on, `0` off. Default: only when stderr is a terminal |

Per-machine defaults in config merge under generate settings for `prompt`, `compare`, and `bench`.
