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

Local / CLI (after `pnpm build`):

```bash
pnpm exec wrangler pages deploy build --project-name=ollanet
```

Then attach the custom domain **ollanet.dev** in the Cloudflare dashboard.

### Git-connected Pages

| Setting | Value |
| --- | --- |
| Root directory | `site` |
| Build command | `pnpm install && pnpm build` |
| Output directory | `build` |

`link:../../downpress` only works on your machine. After Downpress is on GitHub under Catalyst-Forge-LLC, switch the dependency to a **git pin** (and ensure CI can clone it — public repo, or a deploy key / access token if still private):

```json
"downpress": "github:Catalyst-Forge-LLC/downpress#v0.1.0"
```

Until then, deploy with `wrangler pages deploy` from a machine that has the sibling engine linked.
