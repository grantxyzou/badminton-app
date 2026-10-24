# Deployment Model

How the one deployment works and what to ask for when you want to update it. The runbook (ship, check what is live, roll back) is the `deploy-promotion` skill; this page is the mental model.

> **History.** Until 2026-08-25 there were two deployments (`bpm-next` auto-deployed, `bpm-stable` promoted by tag). The stable app service, its plan and `deploy-stable.yml` were deleted that day. The `bpm-stable-v*` tags remain as history; the last, `bpm-stable-v1.8` (2026-08-16), is the story told in `CHANGELOG.md` under v1.8.

---

## The mental model

**One codebase, one branch, one site.** `main` is trunk-based and PR-only (`verify` in `pr-ci.yml` is required, no bypass). Every merge to `main` deploys to production through `.github/workflows/deploy-next.yml`, in about three minutes.

```text
   PR → green `verify` → merge to main ──auto──▶ vnext-badminton-app  (https://bpm.grantzou.com/bpm)
```

**Don't trust the names — they are inverted.** The app service called `vnext-badminton-app` **is** production. Verify which app is live by DNS (`bpm.grantzou.com`), never by name. `staging-badminton-app` exists, holds no deployment, and nothing deploys to it.

There is no promotion step, no soak period and no tag to cut. Unfinished work is gated by feature flags inside the one deployment (`lib/flags.ts`), and each flag's `plannedRemoval` date is what keeps it from becoming permanent.

---

## How to ship

1. Branch, commit, open a PR.
2. `verify` goes green.
3. Merge. `deploy-next.yml` deploys.

What to ask Claude for: *"Make this change."* It branches and opens the PR; merging is yours.

`NEXT_PUBLIC_*` values (flags, `NEXT_PUBLIC_BASE_PATH`, the VAPID public key) are baked at build time, so changing one needs a rebuild and redeploy; it must be in `deploy-next.yml`'s build `env:`, not only in Azure App Settings.

---

## How to roll back

Re-dispatch `deploy-next.yml` at an older commit SHA (GitHub Actions → `deploy-next.yml` → **Run workflow**). No code change is needed.

Schema changes are **additive and optional only**: a rollback runs older code against the same live database, so a removed or renamed field breaks the build you roll back *to*.

For a data rollback (a bug corrupted Cosmos data) use Azure Cosmos point-in-time restore, and try not to go there.

---

## What lives where

- **`.github/workflows/deploy-next.yml`** — deploys `main` to production on every push.
- **`.github/workflows/pr-ci.yml`** — the `verify` gate.
- **Production app service:** `vnext-badminton-app` (Canada Central), serving `https://bpm.grantzou.com/bpm`.
- **Database:** one Cosmos DB account, database `badminton`. The container list and the shared-throughput cap are in `docs/azure.md` §3 and §9; the authoritative set of containers is in `lib/memberPurge.ts`.
- **Schema rule:** `CLAUDE.md` → Deployment.

Deploy topology is also kept in `CLAUDE.md` (Deployment) and `docs/azure.md`; if one changes, fix all three.
