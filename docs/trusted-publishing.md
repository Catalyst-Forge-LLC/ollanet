# Trusted publishing (npm OIDC)

Publish `ollanet`, `olla-net`, and (companion) `finetuna` from GitHub Actions without long-lived npm tokens. Provenance attestations are generated automatically when publishing public packages from a public repo via trusted publishing.

## One-time setup (you do this in the browser)

### 1. Push workflows + create GitHub environment

On each repo (`ollanet`, `finetuna`):

1. Push the `.github/workflows/publish*.yml` files to the **default branch**.
2. GitHub → **Settings → Environments → New environment** → name it exactly `npm`.
3. Optional but recommended: add required reviewers so a human must approve each publish job.

### 2. Claim `olla-net` (first publish only)

The hyphenated name is a name-hold package under `packages/olla-net`. Until it exists on the registry, trusted publishing cannot be configured for it.

From a machine already logged into npm (`npm whoami`):

```bash
cd packages/olla-net
npm publish --access public
```

Complete OTP / 2FA when prompted. Then optionally:

```bash
npm deprecate olla-net@"*" "Use ollanet instead: npm i -g ollanet"
```

Do **not** claim `ollamanet` (embeds the full product name).

### 3. Add Trusted Publisher on npmjs.com

For each package — [ollanet](https://www.npmjs.com/package/ollanet), [olla-net](https://www.npmjs.com/package/olla-net), [finetuna](https://www.npmjs.com/package/finetuna) — open **Package → Settings → Trusted Publisher → GitHub Actions**:

| Field | ollanet | olla-net | finetuna |
| --- | --- | --- | --- |
| Organization or user | `Catalyst-Forge-LLC` | `Catalyst-Forge-LLC` | `Catalyst-Forge-LLC` |
| Repository | `ollanet` | `ollanet` | `finetuna` |
| Workflow filename | `publish.yml` | `publish-olla-net.yml` | `publish.yml` |
| Environment name | `npm` | `npm` | `npm` |
| Allowed actions | `npm publish` | `npm publish` | `npm publish` |

Filename must match exactly (including `.yml`). npm does not validate the form until the first publish attempt.

### 4. Harden publishing access (after a successful OIDC publish)

Package → **Settings → Publishing access** → **Require two-factor authentication and disallow tokens**.

Do this only after confirming a GitHub Actions publish works, or you can lock yourself out of CI publishes until OIDC is fixed.

## How to release afterward

1. Bump `version` in `package.json`, commit, push.
2. Create a GitHub Release (tag `vX.Y.Z`) — or run **Actions → Publish → Run workflow**.
3. Approve the `npm` environment if reviewers are configured.
4. Confirm the package page shows provenance / “Built and signed on GitHub Actions”.

Requirements: Node 24 on the runner (ships a new enough npm), or `npm install -g npm@latest` (≥ 11.5.1). Never set `NODE_AUTH_TOKEN` on the publish step — that disables OIDC.

## Local publish (escape hatch)

Before “disallow tokens” is enabled, you can still publish locally with your npm login + 2FA. After disallowing tokens, only the trusted workflow (and interactive 2FA flows npm still allows for maintainers, if any) apply — prefer the Actions path.
