---
title: Ollama over your network.
description: Discover Ollama hosts, prompt models, continue chats by hash, and hand the mesh to agents over MCP.
order: 1
---

AI models on your LAN and Tailscale shouldn’t mean babysitting IPs or opening a browser. **ollanet** is the small CLI that finds Ollama hosts, talks to them, and keeps conversations alive across machines — including as MCP tools for your agents, and as a Node library for apps. Nothing leaves the networks you already trust.

<div class="cta-row">
  <a class="cta cta-primary" href="/install">Install ollanet →</a>
  <a class="cta cta-secondary" href="https://github.com/Catalyst-Forge-LLC/ollanet">View on GitHub</a>
</div>

<p class="kicker">npm · npx · Node 20+ · zero runtime deps</p>

## What you get

- **Discover** — config, env, and Tailscale first; `--lan` is opt-in (probes your subnet for `:11434`, never the default). Dead hosts just don’t show up. JSON for routers and agents.
- **Prompt** — any host by name or IP, streaming replies, sane defaults per machine
- **Continue** — short chat hashes that survive laptops, desktops, and agent handoffs
- **Bench** — median tok/s across runs (early-stopped samples dropped) plus light quality checks
- **MCP** — `ollanet mcp` exposes scan / prompt / chats over stdio
- **Library** — `import { scanNetwork } from "ollanet"` for apps (Node 20+, not the browser)

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

## For apps

Hard-coding `http://127.0.0.1:11434` treats Ollama like a local daemon. ollanet treats it like a private inference mesh — any machine you can already reach. The app does not own the GPUs; it discovers them. Requires **ollanet ≥ 0.4.0**. Node only; keep LAN opt-in.

```ts
import { scanNetwork } from "ollanet";

const { servers } = await scanNetwork({ lanScan: false });
```

Same inventory MCP wraps. Health checks can stay on localhost; scan is a user action.

<div class="cta-row">
  <a class="cta cta-primary" href="/install">Get started →</a>
  <a class="cta cta-secondary" href="/writing">Read the posts</a>
</div>

Built by [Catalyst Forge LLC](https://www.catalystforge.com).
