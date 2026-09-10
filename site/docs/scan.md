---
title: Scan
---

`ollanet scan` probes Ollama hosts you can contact and lists models. A response means the port answered. It does not mean the host is trusted. `--lan` is an opt-in TCP sweep.

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

Deduped by `ip:port`, then folded when several addresses are this machine (loopback, Tailscale Self, local NICs). One `[this device]` row keeps the extra IPs under `also`. `localhost`, the MagicDNS name, and either IP all resolve to that host.

Last successful scan is saved for `--last` (`~/.ollanet/last-scan.json` when installed).

Finetuna-style names (`*-ctx32k`, `*-flash`, `*finetuna*`) are marked `[tuned]` in scan output.
