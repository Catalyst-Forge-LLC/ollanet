---
title: Scan
---

`ollanet scan` probes Ollama hosts you can contact and lists models. A response means the port answered. It does not mean the host is trusted. `--lan` is an opt-in TCP sweep.

```bash
ollanet scan
ollanet scan --json
ollanet scan --all          # also list offline Tailscale peers (not probed)
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

IPv6 hosts get bracketed endpoints (`http://[fd7a:115c::1]:11434`) in output and `--json`.

Last successful scan is saved for `--last` (`~/.ollanet/last-scan.json` when installed).

Hosts that were probed but did not answer as Ollama are listed after the servers with a short reason, such as `timeout after 2500ms`, `connection refused (ECONNREFUSED)`, or `HTTP 404, no /api/tags (not Ollama?)`. Offline Tailscale peers (listed with `--all`) collapse to a count. `--json` keeps them under `failures`, each with `name`, `ip`, `port`, `error`, and a short `code`: `timeout`, `refused`, `reset`, `unreachable`, `dns`, `http`, `not-ollama`, `offline`, or `error`.

Finetuna-style names (`*-ctx32k`, `*-flash`, `*finetuna*`) are marked `[tuned]` in scan output.
