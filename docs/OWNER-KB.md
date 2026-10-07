# Owner Knowledge Base — Grant

Your personal operating manual. Not agent instructions (that's `CLAUDE.md`),
not strategy (that's `ROADMAP.md`). This is *your* reference — maintain it.

Last verified against the repo: 2026-10-07. Every claim below was checked that
day; the ones that could only be checked in the Azure portal are marked so.

---

## The ecosystem (3 repos)

`aigrant` (portfolio) → `bpm-marketing` (marketing site + **public design-system
showcase**) → `badminton-app` (this product). Flow: portfolio → marketing → app.

- Marketing/landing/branding work → **bpm-marketing**, never inside the app
  (Non-Goal per ROADMAP lock).
- In-app `docs/design-system/` is the implementation truth; bpm-marketing
  *presents* it beautifully. Keep them in sync when tokens change.

## Mental model (read the lock)

`ROADMAP.md` top has the 🔒 LOCKED block — North Star, Non-Goals, the gate,
WIP cap, kill-criteria, 30-day checkpoint. **Editing it = deliberate
strategy change.** The lock's critical path still reads "merge #95 → Slice-0 →
prove engagement → game/win-loss data → fan out tracks 1–3 → track 4 last";
Slice-0 shipped in v1.7 and multi-group was chosen on 2026-09-07 as the Stage-2
initiative, so the next lock edit is a strategy decision for you, not a tidy-up.

## What's automated vs what you own

**Automated (don't redo):**
- 30-day drift review — routine `trig_01AaCdW8M3FZ5ntXrLmw12CZ`, fires the 1st
  of each month at 16:00 UTC. Verified live 2026-10-07: enabled, last run
  2026-10-06 succeeded, next 2026-11-01.
- Seven `.claude/` hooks, each tied to a bug class this repo hit: flag-deploy
  sync, i18n key resolution, lint errors on the edited file, schema-additive
  warning, the tab-screenshot block, the secret-commit block, and plan-review
  dates at session start. The full list is in `CLAUDE.md` under "Automation
  hooks". (The soak tracker and the `bpm confirm` gate this list used to name
  were retired in August 2026 with the second deployment.)
- `main` auto-deploys to production on every push via
  `.github/workflows/deploy-next.yml` → app service `vnext-badminton-app` →
  https://bpm.grantzou.com/bpm. There is ONE deployment. The name is inverted
  and historical; verify by DNS, never by name.
- The PR review bot (`REVIEW.md` policy) and the `verify` check on every PR.
  `main` is PR-only with no bypass, you included.

**You own (only you can do):**
1. **Progression leveling matrix content** — the ACE skills rubric/levels.
   Agent can't author the real content; hand it the rubric when ready.
2. **Legal/privacy calls** — PIPEDA consent model, affiliate disclosure
   (see `feedback_legal_compliance`).
3. **Secrets rotation timing** — the Cosmos connection string, `SESSION_SECRET`
   (rotating it signs every member and admin out), the Claude API key, the VAPID
   pair (rotating it breaks every push subscription with no 410 to clean up —
   treat as "purge the container, everyone re-opts-in"), and the FCM service
   account. None has a schedule and none has been rotated. Decide the window.
4. **Monetization intent** (value-hub Decision D) — affiliate? which retailers?
5. **Store submission** — the native shell is built and archived locally; the
   App Store and Play listings are yours, on device (`native/README.md`).
6. **The four plan reviews now overdue** — `oauth-handoff-gaps`, `multi-group`,
   `ai-governance-and-docs-accuracy`, `native-shell`. Each asks one question on
   its `Review on:` line. Answer it, then move the date or delete the line.

## Equipment catalog

`scripts/data/equipment-catalog.json` holds **203 items** (rackets and strings)
as of 2026-10-07, up from the ~15 hand-curated rackets this section used to
describe. `lib/catalogSeed.ts` refreshes seeded rows in Cosmos on first read
(it used to only fill gaps; see "Catalog seeding REFRESHES" in `CLAUDE.md`).
Ways to grow it, lowest legal risk first:
1. **Hand-curated from manufacturer spec pages** — Yonex / Victor / Li-Ning.
2. **Crowdsource via the app** — the "what's your racket?" free-text "Other" →
   admin promotes to catalog. Already the designed mechanism.
3. ❌ **Scraping retailer sites** — ToS/legal risk; skip.
4. **Affiliate product feeds** (later, Decision D) — only if affiliate is chosen.

## Info the agent needs from you (outside VS Code)

Things not derivable from the codebase — provide when relevant:
- Real ACE progression rubric (levels + criteria).
- Friend-group size (kill-criteria %s assume a count).
- Which brands/models your friends actually use.
- Affiliate/monetization decision + target retailers.
- PIPEDA/consent posture: OK to store game + gear + AI history? consent UX?
- Secrets-rotation window (when's a safe time to log everyone out).
- bpm-marketing: branding, what the intro should say, design-system scope.
- **Anything that lives only in the Azure portal.** The repo cannot see the
  Cosmos firewall, the backup mode, the key-rotation history, the certificate
  expiry or the real partition keys of the six hand-made containers. The
  ten-minute audit in `docs/plans/infra-baseline.md` is how those become facts.

## Learning — the infrastructure under the app

Self-paced, in this order. The guide with the modules, diagrams and
experiments is the Cloud Field Guide artifact:
https://claude.ai/artifact/AeLoB1uTqdKcF3zZ156SAo

1. **The ten-minute audit.** Open the five portal pages listed in the guide's
   "judge's checklist" and write what you find into `docs/azure.md` under the
   "Observed in the portal" heading. This is the first time the Azure side of
   the app will be documented from observation rather than memory.
2. **Module 11, for real:** one alert rule on HTTP 5xx and a health-check path.
   An hour. Then **module 8:** continuous backup and one restore drill onto the
   idle staging app. An afternoon. Both are tracked as work in
   `docs/plans/infra-baseline.md`.
3. **Three verification drills** (ten minutes each): call an admin route with no
   cookie, push to `main` directly, send a request with a forged forwarded-IP
   header. Each must fail while you watch.
4. **Read two request paths** until you can narrate them: the sign-up POST from
   the Home form to Cosmos, and the members-only gate (`requireMember`).
5. **Then choose by what surprised you:** data modelling (module 4) if the
   partition-key page did; managed identity (module 5) if the Identity page did.
   One at a time — the WIP cap applies to learning too.

Done when you can explain each of the nine pieces to a friend without the guide
open, and predict what breaks before reading the "without it" line.

Considered, not started: managed identity for Cosmos, Key Vault references,
deployment slots, Redis, a queue + worker, the capstone architecture. Each is a
module in the guide; none is a commitment.

## Parked — next session first task

**Next:** the four overdue plan reviews (item 6 above), then step 1 of Learning.
Both are decisions or observations only you can make; neither is agent work.

## Key commands

| Need | Command |
|---|---|
| See repo topology | `git log --graph --oneline --decorate --all -20` |
| Roll back production | `gh workflow run deploy-next.yml --ref <good-sha>` — runbook: the `deploy-promotion` skill |
| Confirm what is live | `node scripts/smoke-prod.mjs --sha <sha>` (runs automatically after every deploy) |
| Local dev | `npm run dev` → http://localhost:3000/bpm (mock store when `COSMOS_CONNECTION_STRING` is unset) |
| Tests / lint / types | `npm test` · `npm run lint` · `npm run typecheck` |
| Drift routine | https://claude.ai/code/routines/trig_01AaCdW8M3FZ5ntXrLmw12CZ |

## Doc map

`ROADMAP.md` = where we're going (+ the lock) · `CHANGELOG.md` = what
shipped · `CLAUDE.md` = how the code works/agent rules ·
`docs/azure.md` = what is deployed, and what has been observed in the portal ·
`docs/plans/*` = active specs · GitHub milestones = live tasks ·
the Cloud Field Guide (link above) = the learning resource ·
this file = your operating manual.
