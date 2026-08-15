---
title: Introduction
---

**ollanet** is how humans, agents, and applications address a private [Ollama](https://ollama.com) fleet: find hosts on any network you can reach, manage models, talk to them, and keep the thread.

**CLI** for humans · **MCP** for agents · **Node** for apps. **Node 20+ · zero runtime deps.** Nothing leaves the networks you already trust.

## What it is

- Discover Ollama on localhost, config, Tailscale, or an optional LAN scan
- Pull / show / rm / ps on a named machine
- Prompt and continue chats by short hash
- Compare models, bench tok/s, expose tools over MCP

It is **not** Open WebUI. There is no browser chat product here — only discovery, talk, and continue.

## Finetuna

**ollanet** is the network / client side. On the machine that *runs* Ollama, use **[Finetuna](https://finetuna.net)** to shape a GPU-tuned named variant (context, batch, Modelfile).

1. On the host: `finetuna` → something like `gemma4-ctx32k`
2. From anywhere on the mesh: `ollanet scan` → `ollanet prompt that-host gemma4-ctx32k "…"`

Host tunes the model. Network finds and uses it. Same API, closed loop.

## Next

- [Install](/docs/install) — npm, npx, or a checkout
- [Quick start](/docs/quick-start) — scan, pull, prompt
- [Commands](/docs/commands) — full reference
