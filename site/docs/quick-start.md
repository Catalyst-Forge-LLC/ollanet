---
title: Quick start
---

## Find hosts

```bash
ollanet scan
ollanet scan --lan          # TCP-scan local /24s (opt-in)
ollanet scan --json
ollanet scan --last         # replay last scan, no network
```

## Put a model on a machine

```bash
ollanet pull studio gemma3:12b
ollanet show studio gemma3:12b
ollanet ps studio
```

## Talk

```bash
ollanet prompt localhost "What is MagicDNS?"
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

Point your MCP host at that stdio server — see [MCP](/docs/mcp).

Host-first CLI: `ollanet <cmd> <machine> …` — `studio` is the **machine** (MagicDNS / config name / IP), not a model.
