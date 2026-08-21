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

[appfacts-label]: https://appfacts.dev/v#af1.eNpVkU9LAzEQxb9KeCeF2OI1NymolepFbyKSZqe7sdkkZCbVpfS7S6r1z2nCzLx5P1722MFcakQ7EgxSCDaSQEOm3BqL1VJJSgEaLFYqw8A68TuCRvCOIre1--XT14bbwuwRbOyr7dvkacr06IrPotWd3dmvNzRKjeKPpg-po9kbQ2NILD72zTek2m2CLYSDRkeZYZ73iDAQ_oBGhgF9kKtNoH5d1MYHYvXuZUhVlEtj9sGKTxEH_X1gysQnjPyPUZ3IFdecUxEcXjR4537c_4BpFJgTs9qkorrk6khRjn6KvdBRv64-dC2XbN3W9vQ62mh7auoc89jSJpZG1oqG8zC48XJb1-rKtVusznJdB8_DbBrDecukUE7sJZWpQYhkNvN572Wo65lL43xhxYaJ5eI6lZ4uVqvF_PS7h0996atz
