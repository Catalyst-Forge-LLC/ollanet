# ollanet.dev

Marketing + docs site for [ollanet](https://github.com/Catalyst-Forge-LLC/ollanet), built with [FilePress](https://getfilepress.com) (`getfilepress` on npm).

```bash
pnpm install
pnpm docs:build    # Markdown → docs/dist (Svelte-style shell)
pnpm dev           # docs build + FilePress preview
pnpm build         # → build/ (includes /docs mount)
```

Docs source: `docs/*.md` + `_nav.json`. FilePress mounts `docs/dist` at `/docs` via `paths` in `filepress.config.ts` (requires getfilepress **≥ 0.1.3**). Local pin: `link:../../filepress`.

If [LocalBerth](https://www.npmjs.com/package/localberth) is installed, this site stays on **5182** as `ollanet-site` (loopback; not ollanet `--lan`).

Optional: edit `theme.css` next to `filepress.config.ts`.

## Deploy (Cloudflare Pages)

**Use one pipeline only.** Dual deploys overwrite each other.

```bash
pnpm ship
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

Pin `getfilepress` to a published `^0.1.3` or a git tag that includes path mounts (a `link:` dependency will not resolve on CF Pages).
