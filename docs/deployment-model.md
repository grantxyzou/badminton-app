# Deployment Model — bpm-stable + bpm-next

How the two-deployment pipeline works, what's running where, and **exactly what to ask for** when you want to update either side.

---

## The mental model

**Same codebase. Same `main` branch. Same files.** Two deployments read from `main` at different points in time.

Think of `main` as a moving river. Two sites stand on the bank watching it:

- **`bpm-next`** dunks itself in the river every time it moves. Always wet with the latest water (auto-deploy on every push).
- **`bpm-stable`** only dunks when you pour a bucket on it (manual dispatch). Otherwise it's dry, holding whatever water was in the last bucket.

There is **no** "stable codebase" and "next codebase." There is **one codebase**.

---

## Diagram

```text
                       ┌─────────────────────────────┐
                       │         main branch         │
                       │   (the single source of     │
                       │           truth)            │
                       │                             │
                       │   ●━━━●━━━●━━━●━━━●━━━●━━━>│  time →
                       └────────┬───────────┬────────┘
                                │           │
            auto-deploy on   ↙ │           │ ↘  manual dispatch
              every push        │           │      by tag only
                                │           │
                    ┌───────────▼────┐  ┌───▼─────────────┐
                    │   bpm-next     │  │   bpm-stable    │
                    │  (preview)     │  │ (friend group)  │
                    │                │  │                 │
                    │ Always at HEAD │  │ Frozen at last  │
                    │ Updates each   │  │ promoted tag    │
                    │ push (~3 min)  │  │ (manual only)   │
                    └────────────────┘  └─────────────────┘

         NEXT_PUBLIC_ENV=next            NEXT_PUBLIC_ENV=stable
         Orange banner visible           No banner
         For testers + you to break      For friend group reality
```

Both sites share the **same Cosmos DB** — sign up on preview, it shows up on stable. Different code views of the same data.

---

## Current state (as of last update)

| | What's running | Commit |
|---|----------------|--------|
| `main` (source of truth) | Latest code | newest commit on the branch |
| `bpm-next` | Mirrors main | usually = latest main commit |
| `bpm-stable` | Frozen at last promotion | the commit pointed to by the most recent `bpm-stable-v*` tag |

Run `git log --oneline -5` to see the latest. Run `git tag --list 'bpm-stable*'` to see which tags exist.

---

## How to update **bpm-next** (the easy case)

You don't need to "ask" for anything. Just ship like normal:

1. Edit code in VS Code
2. Commit
3. Push to `main` (or open PR → merge)
4. **`bpm-next` auto-deploys in ~3 minutes**

That's it. The `deploy-next.yml` workflow runs on every push to `main`.

### What to ask Claude for an update to bpm-next

> "Make this change. Ship to bpm-next."

or simply

> "Make this change."

(Default destination is `bpm-next`. Stable requires explicit ask.)

---

## How to update **bpm-stable** (the explicit promotion case)

Stable doesn't update unless you say so. Two flavors of update:

### Flavor 1 — Promote everything since the last tag (the normal case)

When the friend group should see what's been baking on `bpm-next`:

1. Decide on the new version number (e.g. v1.0 → v1.1)
2. Update `CHANGELOG.md` — move items from "Unreleased" into a new dated section
3. Tag main: `git tag -a bpm-stable-v1.1 -m "v1.1 — short description"`
4. Push the tag: `git push origin bpm-stable-v1.1`
5. Go to GitHub Actions → `deploy-stable.yml` → **Run workflow** → enter the tag (`bpm-stable-v1.1`) → Run
6. Stable deploys (~3 min), friend group sees v1.1

### Flavor 2 — Hotfix on stable (urgent, narrow)

Something on stable breaks, you need a fix without shipping everything else from `bpm-next`:

1. Make the fix on `main` (it'll auto-deploy to next first — verify it works there)
2. Tag the fix commit: `git tag -a bpm-stable-v1.0.1 -m "v1.0.1 — hotfix for X"`
3. Push: `git push origin bpm-stable-v1.0.1`
4. Dispatch `deploy-stable.yml` with the new tag
5. Stable updates with the hotfix

If the fix is on a much newer commit than v1.0 and you don't want all the in-between churn, that's harder — you'd cherry-pick the fix onto a hotfix branch off the v1.0 tag, tag that, dispatch. Cross that bridge if it ever happens.

### What to ask Claude for an update to bpm-stable

For a normal promotion:

> "Promote everything to stable. Tag as bpm-stable-v1.X."

For a hotfix:

> "This is a hotfix. Land the change on main, tag as bpm-stable-v1.X.Y, dispatch to stable."

For a rollback:

> "Roll back stable to bpm-stable-v1.0."

---

## How to roll back stable

Stable broke after a promotion? Easy:

1. Go to GitHub Actions → `deploy-stable.yml` → **Run workflow**
2. Enter a previous tag (e.g. `bpm-stable-v1.0`)
3. Run → stable deploys the older code

No code changes needed. Tags are immutable bookmarks; pointing the workflow at an older one rewinds the deployed site.

For data rollback (if a bug corrupted Cosmos data), use Azure Cosmos point-in-time restore (7-day retention) — but try not to go there.

---

## Tags = immutable bookmarks

Every `bpm-stable-vX.Y` tag is a permanent label on a specific commit. Cutting `bpm-stable-v1.1` does **not** move `bpm-stable-v1.0` — both exist forever. This gives you a permanent ladder of "what stable looked like at that moment" rollback points.

You should never delete a stable tag, never re-point it, never force-push it. Treat them as append-only.

---

## What lives where

- **`.github/workflows/deploy-next.yml`** — auto-deploys main → `bpm-next` App Service on every push
- **`.github/workflows/deploy-stable.yml`** — manual dispatch by tag → `bpm-stable` App Service
- **`bpm-next` App Service:** `vnext-badminton-app-enhcave5djcvafe9.canadacentral-01.azurewebsites.net/bpm`
- **`bpm-stable` App Service:** `badminton-app-gzendxb6fzefafgm.canadacentral-01.azurewebsites.net/bpm`
- **Shared:** one Cosmos DB account, database `badminton`, all 7 containers
- **Schema rule (CLAUDE.md):** all schema changes must be additive and optional — never remove or rename a field while stable and next share the DB

---

## The phrase to remember

> **Push goes to next. Tag goes to stable.**

That's the whole pipeline in five words.
