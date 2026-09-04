---
app_facts_version: 0.1.0
name: ollanet
type: CLI tool
status: active
license: MIT
homepage: https://ollanet.dev
repository: https://github.com/Catalyst-Forge-LLC/ollanet
stack:
  language: "TypeScript, JavaScript"
  runtime: Node.js
  hosting: Cloudflare
key_dependencies:
  - name: tsx
    purpose: executing TypeScript files without compilation
  - name: typescript
    purpose: TypeScript language support
services:
  - name: Cloudflare
    role: hosting for documentation site
build:
  package_manager: pnpm
  test: test
  ci: "GitHub Actions (publish.yml)"
generated:
  date: 2026-08-20
  generator: "appfacts-cli v0.1.0 (ollama:gemma4:12b)"
  inputs_fingerprint: 2c118220ad6b0b7e
---

# ollanet

`CLI tool` · **active** · MIT

Curated stack label for this repository — aimed at an under-a-minute skim.

**[Open visual label →][appfacts-label]** · or scan `APP_FACTS.png`

[Repository](https://github.com/Catalyst-Forge-LLC/ollanet)

### Stack

| Layer | Choice |
| --- | --- |
| Language | TypeScript, JavaScript |
| Runtime | Node.js |
| Hosting | Cloudflare |

### Key dependencies

- `tsx` — executing TypeScript files without compilation
- `typescript` — TypeScript language support

### Services

- **Cloudflare** — hosting for documentation site

### Build

- **Package Manager** — pnpm
- **Test** — test
- **CI** — GitHub Actions (publish.yml)

---
*Generated with [AppFacts](https://appfacts.dev) · Scan `APP_FACTS.png` or open the [visual label][appfacts-label]*

[appfacts-label]: https://appfacts.dev/v#af1.eNpVUctOwzAQ_BXLJ5DSVFxzQ5WAosKF3hBCjrNNXBzvKl6HRlX_nXUfUE5ejWdnxuO9HnV1V-hgetCVRu9NANaF5okysFgtFSN6QSIbTlEwY9mNIIh3FkLMtJfl-sSwX7raaxFpk2nzzVp03uzgiAv1bEZzmoU8pMDuaPqKDZTbKFiHkV1os6_H1Gy8GUAfCt0AifH7Xge54rgTKskEO7ApL6g_F7VxHqL6dtxhYmWxJ-cNOwwidBYQcrzEoH8Z1SW5iokIB9aHD3nXaH_dr4LJGwQ4Z1YbHFSDNvUQ-OinomM47tfJ-Sb3QtKPiH_2JsiRtylQn9uGyDlZPgptncyPjp9Sre5t1orqhlLtXezKqfe3uZMOe6BTxx0zxWo-P_9e2cCYwwGhRMBhuqK00kuqS6llvjBs_BR59oBDC7PVanER0IcfOMW2zg
