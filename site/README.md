# ollanet.dev

Marketing + notes site for [ollanet](https://github.com/Catalyst-Forge-LLC/ollanet), built with [Downpress](https://github.com/Catalyst-Forge-LLC/downpress).

```bash
# once in the engine (sibling checkout)
cd ../../downpress && pnpm install

# in this folder
pnpm install
pnpm dev          # local preview
pnpm build        # → build/
```

Optional: edit `theme.css` next to `downpress.config.ts`.

## Deploy (Cloudflare Pages)

**Use one pipeline only.** Dual deploys (local `pages deploy` + GitHub Workers Builds with `wrangler deploy`) overwrite each other and can surface intermittent SvelteKit `500 Internal Error` pages when asset hashes disagree mid-rollout.

Until Downpress is public, deploy only from a machine with the sibling engine:

```bash
pnpm deploy
# = pnpm build && wrangler pages deploy build --project-name=ollanet
```

Then attach **ollanet.dev** in the Cloudflare dashboard.

If you created a **Workers Builds / GitHub** app for this repo earlier, **pause or delete that build** until the dependency is CI-reachable — CI cannot resolve `"downpress": "link:../../downpress"`.

### Git-connected Pages (later)

| Setting | Value |
| --- | --- |
| Root directory | `site` |
| Build command | `pnpm install && pnpm build` |
| Output directory | `build` |

Switch the dependency to a **git pin** first:

```json
"downpress": "github:Catalyst-Forge-LLC/downpress#v0.1.0"
```
