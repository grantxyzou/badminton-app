---
name: deploy-promotion
description: Deploy or roll back the BPM badminton app. Use when shipping to production, cutting a release, checking what is live, or rolling back a bad deploy. There is ONE deployment — the bpm-stable app service was deleted 2026-08-25.
---

# Deploying BPM

**There is one deployment.** `main` auto-deploys to production on every push via
`.github/workflows/deploy-next.yml`, which targets the `vnext-badminton-app` Azure
app service, reachable at **https://bpm.grantzou.com/bpm**.

## The naming trap — read this first

The names are inverted relative to reality, and this has caused repeated confusion:

- The app service called **`vnext-badminton-app`** *is* production. Everyone uses it.
- The app service called **`badminton-app`** sounded like production and was not. It was
  120+ commits behind, had no custom domain, and pointed at a database that doesn't exist.
  **It and its B1 plan were deleted on 2026-08-25.**
- **`staging-badminton-app` is still there and is deliberately kept.** It runs on an F1
  **Free** plan (`ASP-grantzou-b0c9`), so it costs nothing; it holds no deployment, has no
  custom domain, and nothing in `.github/` targets it. Don't mistake it for production and
  don't delete it — it's kept on purpose. (It has `httpsOnly: false`, which is harmless
  while it serves nothing but is worth flipping if it is ever used for anything.)
- `deploy-next.yml` sets `NEXT_PUBLIC_ENV: stable` **on purpose**, with a comment saying
  so. Building production as `next` made it advertise itself as a preview — the
  PreviewBanner rendered and the releases filter served duplicates. It is an environment
  identifier, not a feature flag.

Never verify which app is live by its name. Verify by DNS: `bpm.grantzou.com` and
`next.grantzou.com` are both bound to `vnext-badminton-app`.

## Shipping

Merge to `main`. That's it — the push triggers `deploy-next.yml`, which runs typecheck,
the full test suite and the build before deploying. A failing test cannot reach production.

There is no promotion step and no tag to cut. `bpm-stable-v*` tags exist in history and
are a **historical record only**; the last one (`bpm-stable-v1.8`, `0daf4ff`) points at a
build that is many commits behind and at an app service that no longer exists. Do not
dispatch anything against them.

## Rolling back

Re-dispatch `deploy-next.yml` at an older commit:

```
gh workflow run deploy-next.yml --ref <good-sha>
```

It has `workflow_dispatch`, so production can be redeployed at any commit. This does not
depend on the deleted stable service in any way.

For data rollback: Cosmos point-in-time restore, 7-day retention.

## Verifying a deploy landed

```
gh run list --workflow=deploy-next.yml --limit 3
curl -s -o /dev/null -w "%{http_code}\n" https://bpm.grantzou.com/bpm
```

Probe a route that only exists in the new build to prove *which* build is live — a 200 on
the home page only proves something is serving. Keep production smoke tests **read-only**:
signing in writes engagement events that feed the Value-Hub Slice-0 kill-criterion metric.

## Schema rule

Still applies, for a different reason. Schema changes must be additive and optional —
a rollback redeploys older code against the same live database, so a removed or renamed
field breaks the build you roll back *to*.
