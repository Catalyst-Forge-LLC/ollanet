---
title: Network
---

ollanet talks to Ollama endpoints you configure or select. A reachable host is not a trusted host. `--lan` stays opt-in. Authentication and network protection depend on how that Ollama host is deployed.

This package does not include vendor telemetry. Commands still cause network traffic to the hosts you name. The table covers operations inspected in this repo. It does not prove every possible data path is listed.

## By operation

| Operation | Client sends | Remote host may do | Stored where | Changes the remote host? |
| --- | --- | --- | --- | --- |
| `scan` | Health and model-list probes | Answer with tags | Last scan on this machine | No |
| `scan --lan` | Extra TCP probes on local `/24`s, port `11434` | Same, if something answers | Same | No |
| `prompt` | Prompt text, plus prior turns when you continue a chat | Run inference | `responses/<hash>.json` unless `--no-save` | No model install or delete |
| `compare` | The same prompt to 2–5 models | Run inference | `compares/` unless `--no-save` | No, unless you pass `--unload` |
| `bench` | Suite prompts for speed and light checks | Run inference | `benchmarks/` when you `--save` | Loaded-model state if you use `--hot` or `--cold-load` |
| `pull` | `POST /api/pull` | Fetch the model from the Ollama registry onto that host | Model files on the remote host | Yes |
| `show`, `ps` | Read requests | Return metadata or loaded-model rows | Nothing new on disk | No |
| `rm` | Delete request (`--yes`) | Remove that model | Model removed on the remote host | Yes |
| `alias` | None to Ollama | None | Local `config.json` | No |
| `chats` | None to Ollama | None | Reads local transcripts | No |

Other machines see a saved chat only if they share the responses directory (or the same `~/.ollanet/` when installed).

## Trust

Discovery is not a security boundary. A LAN is not inherently safe. Choose hosts the way you would choose any inference endpoint you send prompt text to.
