---
title: Library
---

```ts
import { scanNetwork, runPrompt, listLoaded } from 'ollanet';

const { servers } = await scanNetwork({ lanScan: false });
```

Node **20+** only. Not for the browser. LAN scan is opt-in.

## Floors

| Surface | Version |
|---|---|
| `scanNetwork` / prompt | ≥ 0.4.0 |
| `pull` / `show` / `rm` / `ps` | ≥ 0.5.0 |
| Compare, `lastScan`, bench `--hot` | ≥ 0.6.0 |
| `resolveTarget` / `listTargets` | ≥ 0.6.1 |
| Aliases (`lookupAlias` / `expandMachineModel`) | ≥ 0.6.4 |

## Bundlers (Vite / SvelteKit SSR)

```ts
// vite.config.ts
ssr: { external: ["ollanet"] },
optimizeDeps: { exclude: ["ollanet"] },
```

Hard-coding `http://127.0.0.1:11434` treats Ollama like a local daemon. ollanet treats it like a private inference mesh: any machine you can already reach.
