---
title: Introduction
---

**ollanet** finds [Ollama](https://ollama.com) hosts you configure or select, manages models on those machines, and talks to them through a CLI, MCP server, or Node library.

**CLI** for humans · **MCP** for agents · **Node** for apps. **Node 20+ · zero runtime deps.**

## Three jobs

- **Discover** Ollama on localhost, config, Tailscale, or an optional LAN scan
- **Manage** with pull / show / rm / ps on a named machine
- **Use** prompt, hash-addressed chats, compare, bench, and the same inventory over MCP

A reachable host is not a trusted host. `--lan` stays opt-in. See [Network](/docs/network) for what each command sends.

It is **not** Open WebUI. No browser chat product: discovery, talk, and continue.

## Finetuna

**ollanet** is the network client. [Finetuna](https://finetuna.net) can shape a GPU-tuned named variant on the machine that runs Ollama. The pairing is optional. Each tool works alone.

1. On the host, if you want a named variant: `finetuna` → something like `gemma4-ctx32k`
2. From a client: `ollanet scan` → `ollanet prompt that-host gemma4-ctx32k "…"`

You can skip Finetuna and prompt any model already on the host.

## Next

- [Install](/docs/install): npm, npx, or a checkout
- [Quick start](/docs/quick-start): scan, alias, prompt
- [Network](/docs/network): traffic, storage, and what modifies a host
- [Commands](/docs/commands): full reference
