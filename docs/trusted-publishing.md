# Trusted publishing (npm OIDC)

Publish `ollanet` and (companion) `finetuna` from GitHub Actions without long-lived npm tokens. Provenance attestations are generated automatically when publishing public packages from a public repo via trusted publishing.

npm rejects unscoped names that are too similar to existing packages (e.g. `olla-net` vs `ollanet`), so we do not maintain a hyphenated name-hold package.

## One-time setup (you do this in the browser)

### 1. Push workflows + create GitHub environment

On each repo (`ollanet`, `finetuna`):

1. Push the `.github/workflows/publish.yml` file to the **default branch**.
2. GitHub → **Settings → Environments → New environment** → name it exactly `npm` (already created via API if you followed the earlier setup).
3. Optional but recommended: add required reviewers so a human must approve each publish job.

### 2. Add Trusted Publisher on npmjs.com

For each package — [ollanet](https://www.npmjs.com/package/ollanet), [finetuna](https://www.npmjs.com/package/finetuna) — open **Package → Settings → Trusted Publisher → GitHub Actions**:

| Field | ollanet | finetuna |
| --- | --- | --- |
| Organization or user | `Catalyst-Forge-LLC` | `Catalyst-Forge-LLC` |
| Repository | `ollanet` | `finetuna` |
| Workflow filename | `publish.yml` | `publish.yml` |
| Environment name | `npm` | `npm` |
| Allowed actions | `npm publish` | `npm publish` |

Filename must match exactly (including `.yml`). npm does not validate the form until the first publish attempt.

### 3. Harden publishing access (after a successful OIDC publish)

Package → **Settings → Publishing access** → **Require two-factor authentication and disallow tokens**.

Do this only after confirming a GitHub Actions publish works, or you can lock yourself out of CI publishes until OIDC is fixed.

## How to release afterward

Pushing a version bump alone does **not** publish. The workflow only runs on:

- a GitHub Release (`release: published`), or
- **Actions → Publish → Run workflow** (`workflow_dispatch`)

1. Bump `version` in `package.json`, commit, push.
2. Create a GitHub Release (tag `vX.Y.Z`) — or run **Actions → Publish → Run workflow**.
3. Approve the `npm` environment if reviewers are configured.
4. Confirm the package page shows provenance / “Built and signed on GitHub Actions”.

Requirements: Node 24 on the runner (ships a new enough npm), or `npm install -g npm@latest` (≥ 11.5.1). Never set `NODE_AUTH_TOKEN` on the publish step — that disables OIDC.

## Local publish (escape hatch)

Before “disallow tokens” is enabled, you can still publish locally with your npm login + 2FA. After disallowing tokens, only the trusted workflow (and interactive 2FA flows npm still allows for maintainers, if any) apply — prefer the Actions path.
