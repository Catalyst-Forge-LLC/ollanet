---
title: Introduction
---

**ollanet** finds [Ollama](https://ollama.com) hosts on any network you can reach, manages models, talks to them, and hands the same inventory to agents and apps.

**CLI** for humans · **MCP** for agents · **Node** for apps. **Node 20+ · zero runtime deps.**

## What it is

- Discover Ollama on localhost, config, Tailscale, or an optional LAN scan
- Pull / show / rm / ps on a named machine
- Prompt and continue chats by short hash
- Compare models, bench tok/s, expose tools over MCP

It is **not** Open WebUI. No browser chat product: discovery, talk, and continue.

## Finetuna

**ollanet** is the network client. On the machine that *runs* Ollama, **[Finetuna](https://finetuna.net)** shapes a GPU-tuned named variant (context, batch, Modelfile).

1. On the host: `finetuna` → something like `gemma4-ctx32k`
2. From anywhere on the network: `ollanet scan` → `ollanet prompt that-host gemma4-ctx32k "…"`

## Next

- [Install](/docs/install) — npm, npx, or a checkout
- [Quick start](/docs/quick-start) — scan, alias, prompt
- [Commands](/docs/commands) — full reference
