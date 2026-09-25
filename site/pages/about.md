---
title: Find, manage, and use Ollama hosts you choose.
description: Discover hosts, manage models, and prompt them through a CLI, MCP server, or Node library.
order: 1
---

You have Ollama on a laptop, a studio box, maybe a closet PC. **ollanet** discovers the hosts you configure or select, manages models on those machines, and lets you prompt, compare, or bench them.

**CLI** for humans · **MCP** for agents · **Node** for apps.

A reachable host is not a trusted host. `--lan` stays opt-in.

<div class="cta-row">
  <a class="cta cta-primary" href="/docs">Read the docs →</a>
  <a class="cta cta-secondary" href="/install">Install ollanet</a>
  <a class="cta cta-secondary" href="https://github.com/Catalyst-Forge-LLC/ollanet">View on GitHub</a>
</div>

<p class="kicker">npm · npx · Node 20+ · zero runtime deps</p>

## Three jobs

**Discover.** Probe localhost, config, env, and Tailscale. `--lan` is an opt-in TCP sweep of your subnet on port `11434`. Dead hosts stay off the list.

**Manage.** `pull`, `show`, `rm`, and `ps` on a named machine. `pull` asks that host to download a library model. The server fetches it. `rm` deletes a model on that host (`--yes`). `show` and `ps` only read.

**Use.** Aliases map a short name to a machine and model. Prompt, continue a chat by hash, compare, or bench. MCP and the Node library use the same inventory.

Compare and bench are existing deeper workflows. See [Compare](/docs/compare) and [Bench](/docs/bench).

## Quick start

```bash
npm install -g ollanet
ollanet scan
ollanet alias add desk studio gemma3:12b
ollanet prompt desk "What is MagicDNS?"
```

`alias` writes local config. `prompt` sends that text to the selected host. `pull` and `rm` modify the remote host. `scan`, `show`, `ps`, and `alias` do not install or delete models.

Full flags live in the [docs](/docs). Network effects by command: [Network](/docs/network).

## Reachability and trust

Prompts go only to the host you pick, and ollanet sends no telemetry. A scan lists any Ollama host that answers on your network, including ones someone else runs, so only use hosts you set up or know. A scan that gets an answer means the port responded. It does not mean you should send prompts or pull models there. Authentication and network protection depend on how that Ollama host is deployed. Discovery is not a security boundary, and a LAN is not inherently safe.

## Finetuna

<div class="mesh-panel">
  <p><a href="https://finetuna.net"><strong>Finetuna</strong></a> can shape a GPU-tuned named variant on the machine that runs Ollama. The pairing is optional. Each tool works alone.</p>
  <p>Host side: Finetuna writes a name such as <code>gemma4-ctx32k</code>. Client side: <code>ollanet show</code> or <code>ollanet prompt</code> that existing name. After <code>pull</code>, ollanet prints the next step.</p>
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

Hard-coding `http://127.0.0.1:11434` treats Ollama like a local daemon. ollanet discovers hosts you configure or select. The app does not own the GPUs. Requires **ollanet ≥ 0.4.0**. Node only. Keep LAN opt-in.

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
