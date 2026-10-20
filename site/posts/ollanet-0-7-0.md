---
title: "ollanet 0.7.0"
date: 2026-10-20
description: "A read-only model catalog for agents off your network, -q for clean output, --stdin for slow pipes, and clearer scan failures."
tags: [releases, agents]
---

**ollanet 0.7.0** adds `ollanet serve`, a read-only model catalog for agents that are not on your network. It also adds quieter output for scripts and agents, and scan now says which hosts did not answer and why.

Install or update with `npm i -g ollanet`. Full release notes are on [GitHub](https://github.com/Catalyst-Forge-LLC/ollanet/blob/main/RELEASE_NOTES/v0.7.0.md).

## Highlights

- **`ollanet serve`**: a token-gated, read-only list of the models on your hosts, for a cloud agent or anything else off your network. It binds to `127.0.0.1:11500` by default, and `--funnel` can publish it through Tailscale Funnel. It never returns hostnames, IPs, ports, OS, or paths, and it never runs prompts, pulls, or deletes. See [Serve](/docs/serve).
- **`-q` / `--quiet`** on every command (or `OLLANET_QUIET=1`): results on stdout, stderr only for errors and warnings. See [Commands](/docs/commands).
- **`--stdin` / `-`** for `prompt` and `compare`: waits for stdin to close and uses it as the prompt, for slow producers such as `git diff`. Without the flag, piped stdin is still used only if it arrives within 100ms, so pipes that never close do not hang. See [Prompt](/docs/prompt).

```bash
ollanet serve token add cloud-agent --expires 30d
ollanet serve --funnel
git diff | ollanet prompt desk "Review this" --stdin -q
```

## What else changed

- **scan** lists hosts that were probed but did not answer as Ollama, with a reason such as `timeout after 2500ms` or `connection refused (ECONNREFUSED)`. `--json` failures add `port` and a short `code`. IPv6 hosts get bracketed endpoints. See [Scan](/docs/scan).
- **compare** prints its result table on stdout, as `bench` does. The default-prompt notice prints before the run.
- **compare** and **bench** print `→ model (1/2)` progress lines only when stderr is a terminal.
- **serve tokens**: `token list` shows when each token was last used. `token rm` with no name lets you pick from a list in a terminal. `token prune` removes expired tokens and tokens unused for 30 days, after you confirm.
- **config**: a checkout no longer tracks `config.json`; start from `config.example.json`. New variables: `OLLANET_QUIET`, `OLLANET_PROGRESS`, `OLLANET_SERVE_FILE`, `OLLANET_TAILSCALE_BIN`. See [Configuration](/docs/config).

## Upgrade notes

- **Back up a checkout's `config.json` before you pull.** It is no longer tracked. If yours is unchanged from the committed copy, the pull deletes it. If you edited it, git refuses the pull until you move it aside. Copy it somewhere safe, pull, then put it back. Installs from npm are not affected.
- **The compare table moved from stderr to stdout.** Scripts that read it from stderr should read stdout instead. `--json` is unchanged.
- **Progress lines print only on a terminal.** Set `OLLANET_PROGRESS=1` to force them on when output is piped, or `0` to turn them off.

## Security notes for serve

- **Loopback by default.** A non-loopback `--listen` is refused unless you pass `--allow-remote`. Publish with `--funnel` or `tailscale serve`, which add TLS.
- **Hashed tokens.** A token is printed once. `~/.ollanet/serve.json` stores only its SHA-256 hash, plus creation, expiry, and last-use times. Comparison is constant-time, and expired tokens never match.
- **Read-only.** The catalog has allow-listed model fields under opaque host labels, and it does not proxy prompts, compares, pulls, deletes, or `ps`.
- **Funnel is public.** `--funnel` puts the catalog on a public `https://<device>.<tailnet>.ts.net/` URL and refuses to start until a token exists. Give shared tokens an `--expires`.
- **Prune old tokens.** `ollanet serve token prune` removes expired tokens and tokens unused for 30 days. `token list` shows which ones are still in use.
