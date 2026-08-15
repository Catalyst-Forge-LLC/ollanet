---
title: Bench
---

Fixed suite for **credible speed** plus a lightweight quality signal. Primary use: Finetuna before/after on one host.

```bash
ollanet bench <machine> [model...]
ollanet bench studio --all
ollanet bench studio gemma3:12b --hot --runs 5
ollanet bench studio --suite full
```

## Suites

| Suite | Speed | Quality |
|---|---|---|
| `quick` (default) | 256-token count, `--runs` times → **tok/s (med)** | ping, math, haiku |
| `full` | that, plus one 1024-token prose shot → **tok/s long** | + json, reason |

The 256-token case is enumerative on purpose so models hit `num_predict` instead of early EOS. It is peak pinned decode — not “how a long chat feels.” Use `--suite full` for the chat-shaped column.

## Useful flags

| Flag | Meaning |
|---|---|
| `--runs <n>` | Counted 256-token repeats (default 3) |
| `--hot` | Discard first 256-token run; keep models loaded |
| `--num-predict <n>` | Pin for the 256-token case only (not the long case) |
| `--cold-load` | Measure cold load via unload + `/api/ps` |
| `--json` / `--save` | Machine-readable / persist under `benchmarks/` |

See [`docs/bench-spec.md`](https://github.com/Catalyst-Forge-LLC/ollanet/blob/main/docs/bench-spec.md) for measurement rules.
