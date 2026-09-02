# BPM Badminton — Roadmap & Status (single source of truth)

## 🔒 LOCKED — North Star / Non-Goals / Change Rule

*Editing anything in this block is a deliberate strategy change. If you're doing it by accident, stop.*

**North Star:** a value-hub for the recreational **badminton** player — between-session engagement, enabled learning, admin cost-automation, and traffic/recommendations strong enough to suggest equipment purchases. Critical path: merge #95 → build value-hub Slice-0 → prove engagement (kill-criteria) → capture game/win-loss data → fan out tracks 1–3 → track 4 last.

**Non-Goals (drift = building these):**
- ❌ Multi-sport / generic "sports app" (it is badminton-specific, on purpose)
- ❌ Generic court/venue booking platform
- ❌ Multi-tenant / SaaS — until Stage-2 (#81) is *explicitly* chosen as the active initiative
- ❌ Any new user-facing surface that doesn't serve a named track below
- ❌ Real-offline/PWA, native app, payments processing, social feed

**Change Rule (the gate):** every new work item must name the track or critical-path step it serves. **Names none → it's drift → GitHub issue in a `later`/parking milestone, NOT started.**

**WIP cap:** one active workstream carried to *shipped-and-live-in-production* before the next starts. Unmerged branches are where drift hides (this is enforced by observation: >2 in-flight branches = stop and converge).

**Kill-criteria honored:** do NOT fan out value-hub tracks 1–4 until Slice-0 passes its written kill-criterion in `docs/plans/value-hub-slice-0.md`. No speculative multi-track building.

**30-day checkpoint:** scheduled drift review (see `/schedule`). The question: *"Is what shipped in the last 30 days on the critical path above?"* >1 off-path item shipped = drift; re-read this block.

---

> **Production:** https://bpm.grantzou.com/bpm (app service `vnext-badminton-app` — the name is inverted; verify by DNS, never by name)
> **Stack:** Next.js 16 · Azure App Service (single, B1) · Cosmos DB · Anthropic Claude API
> **Last updated:** 2026-09-02
>
> **This file is the index.** Detail lives elsewhere — don't duplicate it here:
> - **What shipped** → `CHANGELOG.md` (per-version, not chronological by design)
> - **In-flight specs/plans** → `docs/plans/*`, `docs/superpowers/{plans,specs}/*`
> - **Live task tracking** → GitHub issues + milestones (since 2026-05-08)
> - **Architecture/conventions/gotchas** → `CLAUDE.md`

---

## Deployment

**One deployment, trunk-based.** Every push to `main` deploys to production via `deploy-next.yml`. The second app service (`bpm-stable` / `badminton-app`) and its B1 plan were **deleted 2026-08-25**; `deploy-stable.yml` went with them. There is no promotion step, no soak period, and no stable tag to cut — feature flags now gate unfinished work *inside* the one deployment, and their `plannedRemoval` dates are the only thing keeping them from becoming permanent.

- **Rollback** = re-dispatch `deploy-next.yml` at an older SHA. Runbook: the `deploy-promotion` skill.
- **Schema rule** is still additive-and-optional only — a rollback runs older code against the same live database.
- The last stable tag, `bpm-stable-v1.8` (2026-08-16), is historical. Its story (the pooled-shuttle incompatibility, the re-cut for the racket catalog) is in `CHANGELOG.md` under v1.8.

---

## 1. Shipped (through v1.8)

Through **v1.7** — see `CHANGELOG.md` for the full per-version record (v1.0 → v1.7: sign-ups/waitlist, admin, skills, i18n, stats, bird inventory, Command Center, unified Home auth, Send-the-bill/Settle, Ledger + cover-and-remove, Labeled Rail nav + trusted-device sign-up, **skill-accuracy spine + Value-Hub Slice-0**, full app-code audit remediation + a11y + security hardening). History ladder (old P0–P1.8) retired — CHANGELOG is authoritative.

As of **v1.7 every feature flag was on for everyone** (the two deployments reached parity, and since 2026-08-25 there is only one). Offline legible-fail, the skill-assessment spine (`SKILL_ASSESS`), accurate skill level (`SKILL_LEVEL`/`CALIBRATION`/`SMOOTHING`), and Value-Hub Slice-0 (`VALUE_HUB_SLICE`) are all **live**, no longer flag-gated or soaking.

## 2. The v1.8 cut (record)

**All of the below shipped in v1.8 (2026-08-16)** — kept here as the record of what that cut carried. Since 2026-08-25 there is no "in-flight ahead of stable" state: what's on `main` is what's live. Full user-facing list is in `CHANGELOG.md` under v1.8. The load-bearing ones:

- **Shuttle Model B — pooled cost** (#230–#234) — a session logs one "tubes × price" number instead of per-batch selection. This was the change that broke the old stable deployment (historical — see `CHANGELOG.md` v1.8).
- **Cost/settle correctness run** (#225–#229) — settle guarded while sign-ups are open, stale owed amounts cleared on unsettle, Payments reload after settle, "0 of us" preview, stale-bill warning, cost form totals all purchases.
- **Sign-up capacity race closed** (#222) — deterministic reconciliation; the documented "can exceed maxPlayers by 1–2" gotcha is fixed.
- **Birds hardening stack** (#205–#214) — honest failures, clamped stock, referential delete guard, one validation contract.
- **Payments/receipts** (#195–#198) — past-session receipt browsing, per-session summary header, owed audit.
- **Stats** — Summary redesign (tiles + radar), window/cache alignment (#223), i18n + offline gating (#224).
- **Design-audit remediation** (P0–P2) — phantom tokens resolved, icon/font-size tokenization, guardrail lint→error on cleared areas. Item #6 deliberately deferred; see `docs/plans/design-audit-remediation.md`.

> `.claude/soak.local.md` does not exist in this checkout, so the stale-soak nag isn't firing. Template at `docs/automation/soak.local.md` if you want it back.

## 3. Open PRs (6, as of 2026-08-16)

| PR | State | Note |
|---|---|---|
| **#241** Web Push, wired to sign-ups-open | draft, CI green, mergeable | Needs owner-only VAPID setup (repo var + Azure App Settings) and a real-device test plan. **Names no track** — parked behind the Slice-0 gate per the LOCKED Change Rule. |
| **#240** js-yaml (security group) | CI **failing** | `npm ci` rejects the branch lockfile: *"Missing: @swc/helpers@0.5.23"*. `main`'s lock pins 0.5.15 under next 16.2.9. Recreate/rebase — not a code fix. |
| **#239** production-deps ×7 | no CI run | Open since 2026-07-27. |
| **#237** development-deps ×5 | no CI run | Open since 2026-07-13. |
| **#215** `tsc --noEmit` CI gate | open | Still valid — no workflow runs a typecheck today. Base is `fix/tsc-test-typing` (#208); **retarget to `main`** before landing. |
| **#208** clear 7 tsc errors in tests | open, **dirty** | **Superseded** by #220 (`28167b9`). Close it. |

## 4. Planned / next initiatives

- **Value-Hub kill-criteria check** — **clock restarted 2026-08-16; decide on/after ~2026-09-13.**
  - *What went wrong — two independent faults.* (1) The experiment never rendered: `SkillsTab` passed `gearContent` only when `SKILL_ASSESS` was *off*, and v1.7 turned that spine on for everyone, so the rec card, racket picker and gear sheet **never appeared on either deployment**. (2) Even un-parked it had **no data**: `equipmentCatalog` is seeded only in the mock-store path of `lib/cosmos.ts`, and the script meant to seed production POSTs to an endpoint that was never built — so the live container held **zero rackets** from day one. The criterion was unmeasurable on both counts for ~9 weeks. The v1.7 changelog entry claiming it live has been corrected.
  - *Fixed:* Equipment is now its own register under both spines (`StatsPlaceholder`'s `assessMode` branch gained the missing `equipment` case; pinned by a regression test). `RacketRecCard` is a real button that discloses the `reason` the recommend API was already returning and throwing away. `lib/catalogSeed.ts` fills the catalog on first read (idempotent on deterministic ids, self-heals a partial seed) so it cannot be empty again.
  - *Now measurable:* `POST /api/events` writes append-only, identity-bound `EngagementEvent` docs (`events`, PK `/memberId`). **Read the gate with `GET /api/admin/slice0`** — it reports both halves against their 40% / 30% thresholds, plus racket-saves as a secondary signal, with attendance as the denominator. It returns `verdict: null` rather than a confident "kill" on an empty cohort.
  - Tracks 1–4 (#102–#105) stay blocked until that readout says otherwise.
- **Offline backlog** (deferred, tracked) — per-card `loadError` pills for remaining CommandCenter cards (#98); PWA only if "loads while offline" becomes a real requirement (#99).
- **P1.5/A2 — identity recovery bridge** — still pending. Plan `docs/superpowers/plans/2026-04-27-a2-identity-recovery.md`.
- **Stage-2 / SaaS** — multi-tenant `orgId` migration. Memo `docs/saas-productization-findings.md`. Not started; the one high-risk migration.

## 5. Prioritized punch list

1. ✅ ~~Cut v1.8~~ — tagged + promoted 2026-08-16; fixes the stable pooled-shuttle defect.
2. ✅ ~~Fix #238~~ — landed in v1.8 via `lib/shareImage.ts` (share-or-save with legible outcomes); awaiting reporter confirmation on the issue.
3. **Slice-0 kill-criteria readout** — clock restarted with the v1.8 ship; decide on/after **~2026-09-13** via `GET /api/admin/slice0` (see §4).
4. **PR hygiene** — #208/#215 closed (superseded). Remaining: dependabot #240 (owner must comment `@dependabot recreate` — bot commands from agent comments are defanged), then #239/#237.
5. **Flag debt** — with one deployment, the two-week clock starts when work ships to production. Three retired on `chore/retire-three-flags` (SETTLE / NAV_RAIL / LEDGER, unpushed as of 2026-09-02); eight remain overdue — `check-flag-sync.mjs` lists them on any registry edit.
6. **Dead code** — `mergeBirdUsageEdit` (`lib/birdUsages.ts`) lost its only production consumer in #232; only tests reference it now. Fold into the flag sweep.

## 6. Branch hygiene

- ✅ **Full branch sweep 2026-06-18:** retired `feat/value-hub-slice-0` (worktree + local + remote — fully superseded by the v1.7 PRs; PR #118 closed unmerged) and pruned every merged branch: `chore/ci-node24-actions`, `claude/app-review-upcoming-HtKgE` (#162), `feat/in-app-problem-report` (#151, squash-merged; remote already gone).
- **2026-08-16:** local is `main` + `claude/project-status-85q1oq` (the converge work). Stale remotes still carrying open PRs: `claude/app-overview-s6xb2h` (#241), `chore/ci-tsc-typecheck-gate` (#215), `fix/tsc-test-typing` (#208 — delete when #208 is closed), plus three dependabot branches.
- Run `git fetch --prune` + audit `git branch -vv` for `[gone]` markers periodically. `git branch -D` is no longer gated (the `bpm confirm` rule was retired 2026-08-21).

## 7. Doc map

| Question | Doc |
|---|---|
| What shipped, when? | `CHANGELOG.md` |
| Where are we going (this file) | `ROADMAP.md` |
| Offline architecture | `docs/plans/offline-legible-fail.md` |
| Value-hub strategy | `docs/plans/value-hub-slice-0.md` |
| How the code works / gotchas | `CLAUDE.md` |
| Deploy/rollback | `deploy-promotion` skill + `CLAUDE.md` "Deployment" (`docs/deployment-model.md` predates the single-deployment topology) |
| Live tasks | GitHub milestones/issues |
