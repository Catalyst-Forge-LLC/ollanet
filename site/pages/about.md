---
title: Ollama over your network
description: Discover Ollama hosts, prompt models, continue chats by hash, and hand the mesh to agents over MCP.
order: 1
---

**ollanet** is a small CLI for using [Ollama](https://ollama.com) wherever you can reach it — localhost, LAN, Tailscale, VPN, or a raw IP. No browser UI required.

## What you get

- **Discover** hosts from config, env, Tailscale, and optional LAN scan
- **Prompt** any machine by name or IP, with streaming replies
- **Continue** conversations later with a short chat hash — across devices
- **Bench** models for tok/s and light quality checks
- **MCP** — `ollanet mcp` exposes scan/prompt/chats to agents over stdio

## Quick start

```bash
npm install -g ollanet
ollanet scan
ollanet prompt localhost "What is MagicDNS?"
```

More detail on the [install](/install) page. Source and full flag reference: [GitHub](https://github.com/Catalyst-Forge-LLC/ollanet).

## The Finetuna loop

On the machine that *runs* Ollama, use **[Finetuna](https://github.com/Catalyst-Forge-LLC/finetuna)** to shape a GPU-tuned named variant. ollanet discovers and uses it from anywhere on the network.

## For agents

Point your MCP host at:

```json
{
  "mcpServers": {
    "ollanet": {
      "command": "npx",
      "args": ["-y", "ollanet", "mcp"]
    }
  }
}
```

Tools: `ollanet_scan`, `ollanet_prompt`, `ollanet_list_chats`, `ollanet_get_chat`.

Built by [Catalyst Forge LLC](https://github.com/Catalyst-Forge-LLC).
