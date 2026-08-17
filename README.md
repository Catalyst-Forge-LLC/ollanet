<p align="center">
  <img src="https://raw.githubusercontent.com/Catalyst-Forge-LLC/ollanet/main/assets/ollanet-logo.png" alt="ollanet logo" width="360">
</p>

# ollanet

Talk to **Ollama** on any network you can reach: LAN, localhost, Tailscale, VPN, or a raw IP.

**CLI** for humans · **MCP** for agents · **Node** for apps.

Scan for hosts, send a prompt, continue a chat by a short hash. No browser UI. **Node 20+ · zero runtime deps.**

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

Host-first: `ollanet <cmd> <machine> …`. The machine is a MagicDNS name, a config name, an IP, or an alias for a machine + model pair.

## What you get

Discover hosts. `pull` / `show` / `rm` / `ps`. Aliases. Prompt and hash-addressed chats. Compare. Bench. MCP. Node library. Flags and config live in the [docs](https://ollanet.dev/docs).

## Finetuna

On the machine that *runs* Ollama, **[Finetuna](https://finetuna.net)** shapes a GPU-tuned named variant. ollanet finds that name from anywhere on the network.

## Development

```bash
pnpm install
pnpm test
pnpm ollanet -- help
```

Site (FilePress + docs mount): `pnpm --dir site ship`

## License

MIT · [Catalyst Forge LLC](https://www.catalystforge.com)
