---
title: Serve (read-only catalog)
---

`ollanet serve` lets an agent that is **not** on your network (for example a cloud agent reaching you through Tailscale Funnel) see which models you have. It is read-only: it never proxies prompts, compares, pulls, deletes, or `ps`.

```bash
ollanet serve token add cloud-agent --expires 30d   # prints the token once
ollanet serve                                        # 127.0.0.1:11500, refresh every 10m
ollanet serve --funnel                               # same, published at https://<device>.<tailnet>.ts.net/
ollanet serve status                                 # local and Funnel URLs of the running server
```

## Endpoints

| Endpoint | Auth | Returns |
|---|---|---|
| `GET /healthz` | none | `ok` |
| `GET /v1/catalog` | `Authorization: Bearer <token>` | Catalog JSON |

Anything else under `/v1/` answers `401` without a valid token, then `404`. Failed auth always returns the same `{"error":"unauthorized"}` body. Each token gets a per-minute request budget (`--rate`, default 60), after which it gets `429` with `Retry-After`.

## Catalog

```json
{
  "generated_at": "2026-10-20T12:40:00.000Z",
  "scanned_at": "2026-10-20T12:39:58.000Z",
  "hosts": [
    {
      "label": "mac",
      "models": [
        {
          "name": "qwen3.8:27b-mlx",
          "size": 17000000000,
          "parameter_size": "27B",
          "quantization_level": "Q4_K_M",
          "family": "qwen3",
          "capabilities": ["completion", "tools"],
          "tuned": false
        }
      ]
    }
  ],
  "aliases": [{ "name": "mac", "host": "mac", "model": "qwen3.8:27b-mlx" }]
}
```

Hosts are grouped under an opaque label: a serve label (`ollanet serve label set <machine> <label>`), else the first alias pointing at that machine, else `host-1`, `host-2`, …. Only allow-listed model fields are copied. The catalog never includes hostnames, MagicDNS names, IPs, ports, OS, endpoints, scan failures, or file paths. Capabilities come from `/api/show` on each host when the catalog is built.

The catalog starts from the last saved scan (`ollanet scan`) and re-scans every `--refresh` interval (default `10m`, `off` to never re-scan). With no saved scan and `--refresh off`, the catalog is empty.

## Tokens

```bash
ollanet serve token add <name> [--expires 30d]
ollanet serve token list [--json]
ollanet serve token rm <name>
```

The token is printed once. `~/.ollanet/serve.json` (override with `OLLANET_SERVE_FILE`) stores only its SHA-256 hash, plus creation and expiry times. Tokens are checked with a constant-time compare, and expired tokens never match. Removing a token takes effect on the next request; no restart needed.

## Tailscale Funnel

`ollanet serve --funnel` publishes the catalog at `https://<device>.<tailnet>.ts.net/` through [Tailscale Funnel](https://tailscale.com/kb/1223/funnel). Funnel URLs are public, so `--funnel` refuses to start until at least one token exists (`ollanet serve token add <name>`).

Funnel needs two admin switches, both one-time per tailnet:

1. **HTTPS Certificates**: turn on at [login.tailscale.com/admin/dns](https://login.tailscale.com/admin/dns) (MagicDNS must be on too).
2. **Funnel node attribute**: allow Funnel for this device. The first `--funnel` run prints Tailscale's approval link (`https://login.tailscale.com/f/funnel?node=…`) and exits; open it, approve, and run again. You can also add the `funnel` attribute under `nodeAttrs` in the [access controls](https://login.tailscale.com/admin/acls).

Before it changes anything, `--funnel` checks `tailscale status --json`: Tailscale installed and running, a MagicDNS name, HTTPS certificates, and the Funnel attribute. Then it runs `tailscale funnel --bg --https=<port> http://127.0.0.1:<port>`. Every tailscale call has a timeout, so an unapproved Funnel never leaves `serve` hanging.

When `serve` exits (Ctrl+C), it runs `tailscale funnel --https=<port> off` for the port it added and nothing else. It never runs `tailscale funnel reset`. If that HTTPS port already points at the same local server, `serve` reuses it and leaves it up. If the port serves something else, `serve` refuses rather than replace it.

| Flag | Meaning |
|---|---|
| `--funnel` | Publish through Tailscale Funnel |
| `--funnel-port <n>` | Public HTTPS port: `443` (default), `8443`, or `10000` |
| `--keep-funnel` | Leave the Funnel up after `serve` exits |

The Funnel and catalog URLs print on stdout (even with `-q`). `OLLANET_TAILSCALE_BIN` overrides the `tailscale` binary.

## Binding

The default bind is `127.0.0.1:11500`. A non-loopback `--listen` is refused unless you pass `--allow-remote`. Prefer the loopback default and publish it with `--funnel` (or `tailscale serve` for tailnet-only access), which adds TLS.

Each request logs `time token-name method path status` to stderr (never the token). `-q` turns off startup and access logs.

## Options

| Flag | Meaning |
|---|---|
| `--listen <host:port>` | Bind address (default `127.0.0.1:11500`) |
| `--allow-remote` | Allow a non-loopback bind |
| `--refresh <interval\|off>` | Re-scan interval (default `10m`; minimum `30s`) |
| `--rate <n>` | Requests per minute per token (default 60) |
| `-q` / `--quiet` | No startup or access log lines |
