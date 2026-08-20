---
name: deploy-promotion
description: Promote a tagged commit from bpm-next to bpm-stable, or roll stable back to a previous tag. Use when cutting a release, tagging bpm-stable-vN.N, dispatching deploy-stable.yml, or rolling back a bad stable deploy.
---

# Deploying BPM


Two deployments from one `main` branch (trunk-based + tag promotion):

- **`bpm-next`** — auto-deploys every push to `main` via `.github/workflows/deploy-next.yml`. Runs with `NEXT_PUBLIC_ENV=next` and most flags `on`. Preview banner visible. Friend-group beta testers bookmark this URL.
- **`bpm-stable`** — friend-facing production. Deploys only when `.github/workflows/deploy-stable.yml` is manually dispatched with a `tag` input (e.g., `bpm-stable-v1.0`). Runs with `NEXT_PUBLIC_ENV=stable` and flags `off` by default.

**Promotion runbook**: update `CHANGELOG.md` → tag `main` as `bpm-stable-vN.0` → push tag → dispatch `deploy-stable` with the tag → smoke test → announce.

**Stable-tag footgun**: the promotion tags a commit, and `main` auto-deploys to `bpm-next` — so `main` routinely contains post-soak work ahead of what's ready for stable. Tag the *specific* intended commit, never blindly `main`, or unsoaked work rides to stable. (2026-05-16: deliberately tagged `ab566e0` for `bpm-stable-v1.4` to keep the just-merged offline work off the stable cut.)

**Rollback**: re-dispatch `deploy-stable` with a previous tag. For data rollback, Cosmos point-in-time restore (7-day retention).

**Schema rule**: the two deployments share one Cosmos DB. All schema changes must be additive and optional — never remove or rename a field while stable and next share the DB. Stage 2's `orgId` migration is the one high-risk event; see `/Users/gz-mac/.claude/plans/this-was-where-we-clever-diffie.md`.

Tests must pass before build proceeds on either workflow. Runtime env vars (including flags) set in Azure App Settings per App Service.

