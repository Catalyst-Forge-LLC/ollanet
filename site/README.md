# ollanet.dev

Marketing + notes site for [ollanet](https://github.com/Catalyst-Forge-LLC/ollanet), built with [FilePress](https://getfilepress.com) (`getfilepress` on npm).

```bash
pnpm install
pnpm dev          # local preview
pnpm build        # → build/
```

Optional: edit `theme.css` next to `filepress.config.ts`.

## Deploy (Cloudflare Pages)

**Use one pipeline only.** Dual deploys overwrite each other and can surface intermittent SvelteKit `500 Internal Error` pages when asset hashes disagree mid-rollout.

```bash
pnpm deploy
# = pnpm build && wrangler pages deploy build --project-name=ollanet
```

Then attach **ollanet.dev** in the Cloudflare dashboard.

### Git-connected Pages

| Setting | Value |
| --- | --- |
| Root directory | `site` |
| Build command | `pnpm install && pnpm build` |
| Output directory | `build` |
| Node | 20+ |

Engine pin (already in `package.json`):

```json
"getfilepress": "^0.1.2"
```
