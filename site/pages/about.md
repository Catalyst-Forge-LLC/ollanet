---
title: About
description: What ollanet is and why it exists.
order: 2
---

**ollanet** is a small CLI for using [Ollama](https://ollama.com) over whatever network you already have — localhost, LAN, Tailscale, VPN, or a raw IP.

It started as a personal script: Ollama on a laptop on a Tailscale network, and a need to discover it, poke at models, and talk to them from another machine without babysitting IPs or opening a browser. Scan and prompt came first; hash-addressed chats, LAN discovery, fleet benching, and an MCP server followed.

On the machine that *runs* Ollama, use **[Finetuna](https://github.com/Catalyst-Forge-LLC/finetuna)** to shape GPU-tuned named variants. ollanet finds and chats with them from anywhere on the network.

Built by [Catalyst Forge LLC](https://github.com/Catalyst-Forge-LLC). Source: [github.com/Catalyst-Forge-LLC/ollanet](https://github.com/Catalyst-Forge-LLC/ollanet).
