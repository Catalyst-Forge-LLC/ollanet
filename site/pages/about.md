---
title: Ollama on any host you can reach.
description: CLI for humans, MCP for agents, Node for apps. Discover hosts, prompt models, continue chats by hash.
order: 1
---

You have Ollama on a laptop, a studio box, maybe a closet PC. **ollanet** finds those hosts, manages models, and talks to them without babysitting IPs or opening a browser.

**CLI** for humans · **MCP** for agents · **Node** for apps.

<div class="cta-row">
  <a class="cta cta-primary" href="/docs">Read the docs →</a>
  <a class="cta cta-secondary" href="/install">Install ollanet</a>
  <a class="cta cta-secondary" href="https://github.com/Catalyst-Forge-LLC/ollanet">View on GitHub</a>
</div>

<p class="kicker">npm · npx · Node 20+ · zero runtime deps</p>

## What you get

Discover hosts from config, env, and Tailscale. `--lan` is an opt-in TCP sweep of your subnet on port `11434`. Dead hosts stay off the list. JSON for routers and agents. `--last` reprints the previous scan with no network.

`ollanet pull studio gemma3:12b` asks that machine to download or update a library model. The server fetches it; ollanet does not upload weights.

`show` a Modelfile, `ps` what’s in VRAM (CPU/GPU split, same rule as `ollama ps`), `rm` leftovers (`--yes`). Scan marks Finetuna-style names `[tuned]`.

Aliases map a short name to a machine and model: `ollanet alias add desk studio gemma3:12b`, then `ollanet prompt desk "…"`.

Prompt any host by name, IP, or alias. Stream replies. Defaults per machine. `--file` takes a `.txt` or `.md` prompt. Continue a chat by hash from another laptop.

Compare runs the same prompt on 2–5 models on one host and writes a markdown file. Bench reports median tok/s (early-stops dropped) plus a few quality checks.

`ollanet mcp` exposes scan, prompt, compare, pull, show, rm, ps, and chats over stdio. Apps `import { scanNetwork } from "ollanet"` (Node 20+, not the browser).

## Quick start

```bash
npm install -g ollanet
ollanet scan
ollanet alias add desk studio gemma3:12b
ollanet prompt desk "What is MagicDNS?"
ollanet bench desk --hot
ollanet mcp
```

Full flags live in the [docs](/docs).

## Finetuna

<div class="mesh-panel">
  <p>On the machine that <em>runs</em> Ollama, <a href="https://finetuna.net"><strong>Finetuna</strong></a> shapes a GPU-tuned named variant. From another machine: <code>ollanet scan</code>, then <code>show</code> or <code>prompt</code> that name. After <code>pull</code>, ollanet prints the next step.</p>
</div>

## For agents

Point your MCP host at the stdio server, then route work to whatever is up:

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

Tools: `ollanet_scan`, `ollanet_prompt`, `ollanet_compare`, `ollanet_pull`, `ollanet_show`, `ollanet_rm`, `ollanet_ps`, `ollanet_list_chats`, `ollanet_get_chat`.

## For apps

Hard-coding `http://127.0.0.1:11434` treats Ollama like a local daemon. ollanet treats it like a private inference mesh: any machine you can already reach. The app discovers the GPUs; it does not own them. Requires **ollanet ≥ 0.4.0**. Node only; keep LAN opt-in.

```ts
import { scanNetwork } from "ollanet";

const { servers } = await scanNetwork({ lanScan: false });
```

Health checks can stay on localhost. Scan is a user action.

<div class="cta-row">
  <a class="cta cta-primary" href="/install">Get started →</a>
  <a class="cta cta-secondary" href="/writing">Read the posts</a>
</div>

Built by [Catalyst Forge LLC](https://www.catalystforge.com).
