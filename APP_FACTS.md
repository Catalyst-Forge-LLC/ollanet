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

[appfacts-label]: https://appfacts.dev/v#af1.eNpVkUFPGzEQhf-K9U5FMom4-oYitaUKXOCGEHK8k10Xrz3aGS-sovz3yglp6cmWZ957n54PmOFuLLIfCQ4lJZ9JYaELt4fN9s5oKQkWol6rwMEHjTPBIsVAWdra_d3TeSO8wR2QfO6r79vkaWF6DFNkteaXn_35DoupZo2n0IfS0eq3wGIoojH3LTeV2u2TnwhHi45Y4J4PyHBQ-YAFw4E-KNQmMP9SzD4mEvMedShVTSgjx-Q1loyj_TRYmOSCwf8xmgu5kcpcJsXxxULm8Df9C5jFBHdhNvsyma6EOlLWU56RqHTS72pMXeuFfXjzPb2OPvuempozj61tEm1k7bAIEQ4_ov6sO3MbmpeYb1x3KcqwWsZ01ToZykh87nhQZXHr9efvrTqaGxxxkahlWr6s9FGHuluFMq43Xn1aRK-_l6mn6-12czHA8Q84xbbO
