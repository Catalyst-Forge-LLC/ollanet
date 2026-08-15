---
title: Install
---

Requires **Node.js 20+**.

## npx (no install)

```bash
npx ollanet scan
npx --allow-git=all github:Catalyst-Forge-LLC/ollanet scan
```

npm 12+ blocks git dependencies by default, hence `--allow-git=all` for the GitHub form. npx does not put `ollanet` on your PATH.

## Global install

```bash
npm install -g ollanet
ollanet scan
```

Config lives at `~/.ollanet/config.json`; chats under `~/.ollanet/responses/`.

## From a checkout

```bash
cd ollanet
pnpm install
pnpm link --global   # optional
pnpm ollanet -- help
```

A checkout uses repo-local `config.json` and `responses/` instead of `~/.ollanet/`.

## Site and docs

This documentation site is [ollanet.dev](https://ollanet.dev). Product marketing lives on FilePress pages; these docs are a path mount at `/docs`.

Publish notes for the npm package: [trusted publishing](https://github.com/Catalyst-Forge-LLC/ollanet/blob/main/docs/trusted-publishing.md).
