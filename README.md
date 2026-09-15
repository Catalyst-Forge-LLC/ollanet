<p align="center">
  <img src="https://raw.githubusercontent.com/Catalyst-Forge-LLC/ollanet/main/assets/ollanet-logo.png" alt="ollanet logo" width="360">
</p>

# ollanet

Find, manage, and use Ollama models on the hosts you choose.

**CLI** for humans · **MCP** for agents · **Node** for apps.

Discover hosts, give models convenient aliases, and prompt or compare them. A reachable host is not a trusted host. LAN scan is opt-in. Node 20+, zero runtime deps.

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
```

`alias` writes local config. `prompt` sends that text to the selected host. `pull` and `rm` change models on the remote host. `scan`, `show`, `ps`, and `alias` do not install or delete models.

Host-first: `ollanet <cmd> <machine> …`. The machine is a MagicDNS name, a config name, an IP, or an alias for a machine + model pair.

## Three jobs

**Discover.** Probe localhost, config, env, and Tailscale. `--lan` is an opt-in TCP sweep of your subnet on port `11434`.

**Manage.** `pull`, `show`, `rm`, and `ps` on a named machine. Comparisons and benches are deeper workflows on [ollanet.dev/docs](https://ollanet.dev/docs).

**Use.** Prompt, continue a chat by hash, or call the same inventory from MCP and the Node library.

## Reachability and trust

ollanet talks to Ollama endpoints you configure or select. A scan that gets an answer means the port responded. It does not mean you should send prompts or pull models there. Authentication and network protection depend on how that Ollama host is deployed. Discovery is not a security boundary, and a LAN is not inherently safe.

## Network effects

This package does not include vendor telemetry. Commands still cause network traffic to the hosts you name.

| Operation | Client sends | Remote host may do | Stored where |
| --- | --- | --- | --- |
| `scan` | Health and model-list probes to discovered or configured hosts | Answer with tags | Last scan on this machine (`last-scan.json`) |
| `scan --lan` | Extra TCP probes on local `/24`s, port `11434` | Same, if something answers | Same |
| `prompt`, `compare`, `bench` | Prompt text, and prior turns when you continue a chat | Run inference | Chats, compares, or benches on this machine unless you pass `--no-save` |
| `pull` | `POST /api/pull` | Fetch the model from the Ollama registry onto that host | Model files on the remote host |
| `show`, `ps` | Read requests | Return metadata or loaded-model rows | Nothing new on disk |
| `rm` | Delete request (`--yes`) | Remove that model from the host | Model removed on the remote host |
| `alias` | None to Ollama | None | Local `config.json` |
| `chats` | None to Ollama | None | Reads local transcripts |

Other machines see a saved chat only if they share the responses directory (or the same `~/.ollanet/` when installed). This table covers the operations inspected in this repo. It does not prove every possible data path is listed.

## Finetuna

[Finetuna](https://finetuna.net) can shape a GPU-tuned named variant on the machine that runs Ollama. That pairing is optional. Each tool works alone.

| Role | Tool | Where |
| --- | --- | --- |
| Host-side runtime settings | Finetuna | The GPU box |
| Client-side discover, manage, use | ollanet | Any machine that can reach that host |

```bash
ollanet show studio gemma4-ctx32k
ollanet prompt studio gemma4-ctx32k "What is MagicDNS?"
ollanet bench studio gemma4-ctx32k --hot --runs 5
```

`bench` `quick` reports median tok/s on a 256-token counted decode, plus ping, math, and haiku checks, for that host, model, suite, and run count. Those checks are not a general quality ranking and do not compare across hardware without the same conditions.

<!-- xfacts-label -->

## xFacts label

- **AppFacts:** [viewer](https://appfacts.dev/v#af1.eNpVkU9LAzEQxb9KeCeF2OI1NymolepFbyKSZqe7sdkkZCbVpfS7S6r1z2nCzLx5P1722MFcakQ7EgxSCDaSQEOm3BqL1VJJSgEaLFYqw8A68TuCRvCOIre1--XT14bbwuwRbOyr7dvkacr06IrPotWd3dmvNzRKjeKPpg-po9kbQ2NILD72zTek2m2CLYSDRkeZYZ73iDAQ_oBGhgF9kKtNoH5d1MYHYvXuZUhVlEtj9sGKTxEH_X1gysQnjPyPUZ3IFdecUxEcXjR4537c_4BpFJgTs9qkorrk6khRjn6KvdBRv64-dC2XbN3W9vQ62mh7auoc89jSJpZG1oqG8zC48XJb1-rKtVusznJdB8_DbBrDecukUE7sJZWpQYhkNvN572Wo65lL43xhxYaJ5eI6lZ4uVqvF_PS7h0996atz) · [raw](https://github.com/Catalyst-Forge-LLC/ollanet/blob/main/APP_FACTS.md)
- **ToolFacts:** [viewer](https://toolfacts.dev/v#tf1.eNrFlstuUzEQhl_F8gqkXAqLLtJVVcQqQNWwq6rKtSc5Vn052OOEKOq78_vkBHoJ0KKi7CJ7Lv83M2fijVzKybuBDMqTnMjonArE4tPZuZhRWlKSA2loSS62-D2RZ4qVW2cWH2NaEC5hkm0MuDoaHY-OcZJZcck4UJrtsto4qynkGv-0Vbqh4fvREY5vbTA487od5l2uVALbKmUj6TvpwtvYLmrlhm2KmnKGGScVchsT4y6zsVHeDaROZAjuyuXqn-hbsTiSk8sr3NIiVV9cMDnyxGkN5xADdYiZbVA1W-7tOcYa53LzqDbXyVdIa-ia5nPSXFGrfyo73kSgrJnm1lFGtcj_SoUQq5hucVBCqm5WM0QOZE9HiDcHAkEDkvg2MqD6M1iV1Maulhfk45KEEj4acmKeohcqiC-Q6ZVoYmYU5Yl6ZPEtPyVYJcu_1541-m9eU_2MgoH2rRzB8ZF0EZPQEc0MpSJmtSQjdKP4RHi1Fm2dOlh1c6CTRYhuRNx6H7NGDpXo8NAXJQhuCDieduhqoWwAii-Obeuow8_jrqkZVTEiEZcUUIUth834JPZ1tjj3UsTXnslzaBBvTFwFF5V5-3M40Ul0GCQenn8b0axVeAoCAPO_OPDtPsD4YNF7LCTRZVM37oHmbVdcN38N2bRlzCcitnWBKCemp5_FV6zQjmQfYRNXhyWcQUHfG6xCZbDWn71B8mGlT2vh-89Dl5Rg5NaizhtWRAzPIKitu67L5KUkezZCD_cvDP3Gurfc7u2zvE_4gra6DyYbRUaJ6c_Sxc1aWCPvrgayiZ5atai-DXObJ-NxzzLCq6ITjNCWY_dnvDNZWG7KzQjrbrx7bwy798ZwOj3bBeheASVoVYeoU3r3Azp1G68) · [raw](https://github.com/Catalyst-Forge-LLC/ollanet/blob/main/TOOL_FACTS.md)

## Development

```bash
pnpm install
pnpm test
pnpm ollanet -- help
```

Site (FilePress + docs mount): `pnpm --dir site ship`

## License

MIT · [Catalyst Forge LLC](https://www.catalystforge.com)
