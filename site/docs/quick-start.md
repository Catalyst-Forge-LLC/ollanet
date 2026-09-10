---
title: Quick start
---

Discover, then alias, then prompt. `alias` is local. `prompt` sends text to the selected host. `pull` and `rm` change that host.

```bash
ollanet scan
ollanet alias add desk studio gemma3:12b
ollanet prompt desk "What is MagicDNS?"
```

## Find hosts

```bash
ollanet scan
ollanet scan --lan          # TCP-scan local /24s (opt-in)
ollanet scan --json
ollanet scan --last         # replay last scan, no network
```

`--lan` is opt-in. A host that answers is reachable. It is not automatically trusted.

## Put a model on a machine

`pull` asks the named machine to download or update a library model. That host fetches it. `rm` deletes a model on that host.

```bash
ollanet pull studio gemma3:12b
ollanet show studio gemma3:12b
ollanet ps studio
```

## Talk

```bash
ollanet alias add desk studio gemma3:12b
ollanet prompt desk "What is MagicDNS?"
ollanet prompt studio gemma3:12b "Summarize Tailscale ACL tips"
ollanet prompt --chat a1b2c3d4e5f6 "Tell me more"
```

## Compare and bench

```bash
ollanet compare studio gemma3:12b llama3.2:3b
ollanet bench studio gemma3:12b --hot --runs 5
ollanet bench studio --suite full
```

## Agents

```bash
ollanet mcp
```

Point your MCP host at that stdio server. See [MCP](/docs/mcp).

Host-first CLI: `ollanet <cmd> <machine> …`. `studio` is the **machine** (MagicDNS / config name / IP), or an **alias** for a machine + model pair.
