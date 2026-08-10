---
title: Ollama over your network.
description: Discover Ollama hosts, prompt models, continue chats by hash, and hand the mesh to agents over MCP.
order: 1
---

AI models on your LAN and Tailscale shouldn’t mean babysitting IPs or opening a browser. **ollanet** is the small CLI that finds Ollama hosts, talks to them, and keeps conversations alive across machines — including as MCP tools for your agents.

<div class="cta-row">
  <a class="cta cta-primary" href="/install">Install ollanet →</a>
  <a class="cta cta-secondary" href="https://github.com/Catalyst-Forge-LLC/ollanet">View on GitHub</a>
</div>

<p class="kicker">npm · npx · Node 20+ · zero runtime deps</p>

## What you get

- **Discover** — config, env, Tailscale, optional LAN scan; JSON for routers and agents
- **Prompt** — any host by name or IP, streaming replies, sane defaults per machine
- **Continue** — short chat hashes that survive laptops, desktops, and agent handoffs
- **Bench** — tok/s + light quality checks across your fleet
- **MCP** — `ollanet mcp` exposes scan / prompt / chats over stdio

## Quick start

```bash
npm install -g ollanet
ollanet scan
ollanet prompt localhost "What is MagicDNS?"
```

Full flags and config live on the [install](/install) page.

## The Finetuna loop

<div class="mesh-panel">
  <p>On the machine that <em>runs</em> Ollama, <a href="https://github.com/Catalyst-Forge-LLC/finetuna"><strong>Finetuna</strong></a> shapes a GPU-tuned named variant. ollanet discovers it from anywhere on the network and starts the session.</p>
  <p>Host tunes the model. Network finds and uses it. Same API, closed loop.</p>
</div>

## For agents

Point your MCP host at the stdio server — then route work to whatever’s alive on the mesh:

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

<div class="cta-row">
  <a class="cta cta-primary" href="/install">Get started →</a>
  <a class="cta cta-secondary" href="/writing">Read the posts</a>
</div>

Built by [Catalyst Forge LLC](https://www.catalystforge.com).
