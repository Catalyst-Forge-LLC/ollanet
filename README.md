<p align="center">
  <img src="https://raw.githubusercontent.com/Catalyst-Forge-LLC/ollanet/main/assets/ollanet-logo.png" alt="ollanet logo" width="360">
</p>

# ollanet

Find the models. Talk to them. Keep the thread.

Chat with **Ollama** servers on **any network you can reach** — LAN, localhost, Tailscale, VPN, or a raw IP.

**CLI** for humans · **MCP** for agents · **Node** for apps. Same mesh.

Scan for models, fire prompts, and continue conversations later by a short hash. No browser UI required. **Node 20+ · zero runtime deps.**

**Docs:** [ollanet.dev/docs](https://ollanet.dev/docs) · **Site:** [ollanet.dev](https://ollanet.dev)

## Install

```bash
npm install -g ollanet
ollanet scan
```

Or one-off: `npx ollanet scan`

## Quick start

```bash
ollanet scan
ollanet alias add desk studio gemma3:12b
ollanet prompt desk "What is MagicDNS?"
ollanet bench desk --hot
ollanet mcp
```

Host-first: `ollanet <cmd> <machine> …` — the machine is MagicDNS / config name / IP, or an alias for a machine+model pair.

## What you get

Discover hosts · pull / show / rm / ps · aliases · prompt + hash-addressed chats · compare · bench · MCP · Node library. Full flags and configuration live in the [docs](https://ollanet.dev/docs).

## Finetuna

On the machine that *runs* Ollama, use **[Finetuna](https://finetuna.net)** to shape a GPU-tuned named variant. ollanet finds and chats with it from anywhere on the mesh.

Host tunes the model. Network finds and uses it.

## Development

```bash
pnpm install
pnpm test
pnpm ollanet -- help
```

Site (FilePress + docs mount): `pnpm --dir site ship`

## License

MIT · [Catalyst Forge LLC](https://www.catalystforge.com)
