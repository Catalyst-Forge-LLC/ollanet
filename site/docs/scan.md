---
title: Scan
---

`ollanet scan` probes reachable Ollama hosts and lists models.

```bash
ollanet scan
ollanet scan --json
ollanet scan --all          # also probe offline Tailscale peers
ollanet scan --lan          # scan local LAN CIDRs
ollanet scan --last         # print last saved scan (no network)
```

## Discovery sources

| Source | When |
|---|---|
| localhost | Always (unless disabled) |
| `config.hosts` | Always when configured |
| `OLLANET_HOSTS` | Env comma/space list |
| Tailscale | If `tailscale status --json` works |
| LAN scan | `--lan` or `discovery.lan: true` |

Deduped by `ip:port`. Last successful scan is saved for `--last` (`~/.ollanet/last-scan.json` when installed).

Finetuna-style names (`*-ctx32k`, `*-flash`, `*finetuna*`) are marked `[tuned]` in scan output.
