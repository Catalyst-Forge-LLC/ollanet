---
title: "Hello from ollanet.dev"
date: 2026-08-10
description: The site is live — CLI, MCP, and a place for notes as the mesh grows.
tags: [meta, releases]
---

Today **ollanet.dev** stands up as the home for the project: install notes, short posts, and a public face for a tool that began as a Tailscale convenience script earlier the same day.

What shipped so far:

- **Discover** Ollama hosts (config, env, Tailscale; LAN scan only with `--lan`)
- **Prompt** any machine by name or IP, with hash-addressed chat continuity
- **Bench** models for tok/s and light quality checks
- **MCP** — `ollanet mcp` exposes scan/prompt/chats to agents over stdio

Install with `npm i -g ollanet`, or see [/install](/install). The companion host-side tuner is [Finetuna](https://github.com/Catalyst-Forge-LLC/finetuna).

This site is built with [FilePress](https://getfilepress.com) — git-native Markdown, static HTML, Cloudflare Pages — and will grow as the mesh does.
