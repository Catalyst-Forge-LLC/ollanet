---
title: "Find, manage, and use Ollama models across your machines."
description: "Discover your Ollama hosts, give models short names, manage their installation, and prompt or compare them from one place. ollanet provides a CLI, an MCP server for agents, and a Node library for applications."
order: 1
---

<section class="value-hero" aria-label="ollanet overview"><div class="value-intro"><p class="value-kind">CLI, MCP server, and Node library for Ollama</p><h1 class="hero-phrased"><span class="hero-phrase">Find, manage, and use</span> <span class="hero-phrase">Ollama models</span> <span class="hero-phrase">across your machines.</span></h1><p class="value-lede">Discover your Ollama hosts, give models short names, manage their installation, and prompt or compare them from one place. ollanet provides a CLI, an MCP server for agents, and a Node library for applications.</p><div class="cta-row"><a class="cta cta-primary" href="/install">Install ollanet</a><a class="cta cta-secondary" href="#quick-start">See a named-host example</a></div><p class="value-limit">Prompts go to the host you select. A reachable host is not automatically trusted. LAN scanning stays opt-in.</p></div><figure class="value-proof"><figcaption>Illustrative example</figcaption><p><strong>Starting point</strong><br>You want to use the model on your studio computer from your laptop.</p><div class="value-result"><p><strong>What you get</strong><br>An alias names the machine and model: <code>desk → studio / gemma3:12b</code>.</p></div><p>Prompt that alias without keeping a separate host URL in every command.</p><p class="value-note">Illustrative configuration. The named host must already be available and trusted.</p></figure></section>

## Three jobs

**Discover.** Probe localhost, config, env, and Tailscale. `--lan` is an opt-in TCP sweep of your subnet on port `11434`. Dead hosts stay off the list.

**Manage.** `pull`, `show`, `rm`, and `ps` on a named machine. `pull` asks that host to download a library model. The server fetches it. `rm` deletes a model on that host (`--yes`). `show` and `ps` only read.

**Use.** Aliases map a short name to a machine and model. Prompt, continue a chat by hash, compare, or bench. MCP and the Node library use the same inventory. `ollanet serve` gives agents off your network a read-only list of your models.

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

An agent that runs elsewhere, such as a cloud agent, can read which models you have through `ollanet serve`: a token-gated, read-only catalog on loopback, optionally published with Tailscale Funnel. It returns model names and capabilities under opaque host labels, never hostnames or IPs, and it does not run prompts. See [Serve](/docs/serve).

```bash
ollanet serve token add cloud-agent --expires 30d
ollanet serve --funnel
```

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
