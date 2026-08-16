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

**WIP cap:** one active workstream carried to *shipped-on-stable* before the next starts. Unmerged branches are where drift hides (this is enforced by observation: >2 in-flight branches = stop and converge).

**Kill-criteria honored:** do NOT fan out value-hub tracks 1–4 until Slice-0 passes its written kill-criterion in `docs/plans/value-hub-slice-0.md`. No speculative multi-track building.

**30-day checkpoint:** scheduled drift review (see `/schedule`). The question: *"Is what shipped in the last 30 days on the critical path above?"* >1 off-path item shipped = drift; re-read this block.

---

> **Stable:** https://badminton-app-gzendxb6fzefafgm.canadacentral-01.azurewebsites.net/bpm
> **Next (preview):** https://vnext-badminton-app-enhcave5djcvafe9.canadacentral-01.azurewebsites.net/bpm
> **Stack:** Next.js 16 · Azure App Service (dual) · Cosmos DB · Anthropic Claude API
> **Last updated:** 2026-08-16
>
> **This file is the index.** Detail lives elsewhere — don't duplicate it here:
> - **What shipped** → `CHANGELOG.md` (per-version, not chronological by design)
> - **In-flight specs/plans** → `docs/plans/*`, `docs/superpowers/{plans,specs}/*`
> - **Live task tracking** → GitHub issues + milestones (since 2026-05-08)
> - **Architecture/conventions/gotchas** → `CLAUDE.md`

---

## Deployments

| Env | URL audience | Current | Notes |
|---|---|---|---|
| **bpm-stable** | regular friends | **v1.7** (2026-06-13) | Flag parity with `bpm-next` except `INSIGHT_CARDS`, added to `deploy-stable.yml` 2026-08-16 and live from v1.8 |
| **bpm-next** | beta friends | `main` (`a831157`, 2026-07-10) | auto-deploys every push to `main` |

> ⚠️ **Stable is ~50 commits / 2 months behind `main`, and that gap is now a live
> defect, not just lag.** Both deployments share one Cosmos DB. Shuttle Model B
> (#230–#234) writes pooled usage as `purchaseId: 'pool'`, a sentinel with no
> matching purchase doc. v1.7's `SetupPage` resolves `tubePurchase` to
> `undefined` for it, so the stable admin UI **hides the shuttle line and shows a
> per-player cost with the shuttle cost missing**, then **fails Save with a 404
> "Selected bird purchase not found"**. `POST /api/session/advance` on v1.7 is
> unaffected (it ignores `birdUsages`). The v1.8 promotion is the fix — no code
> needs writing. Until then, do session cost setup from the `bpm-next` URL.

Promotion = tag a **specific commit** + dispatch `deploy-stable.yml` (never blindly tag `main` — it carries post-soak work; see CLAUDE.md "stable-tag footgun").

Tag `bpm-stable-v1.7` → `d4cdf7b` (the release commit; backfilled 2026-06-18 — v1.7 shipped 2026-06-13 but the promotion tag had been missed). Rollback/promotion targets are valid through v1.7.

---

## 1. Shipped (stable)

Through **v1.7** — see `CHANGELOG.md` for the full per-version record (v1.0 → v1.7: sign-ups/waitlist, admin, skills, i18n, stats, bird inventory, Command Center, unified Home auth, Send-the-bill/Settle, Ledger + cover-and-remove, Labeled Rail nav + trusted-device sign-up, **skill-accuracy spine + Value-Hub Slice-0**, full app-code audit remediation + a11y + security hardening). History ladder (old P0–P1.8) retired — CHANGELOG is authoritative.

As of **v1.7, stable and `bpm-next` are at full flag parity** — every feature flag is on for everyone. Offline legible-fail, the skill-assessment spine (`SKILL_ASSESS`), accurate skill level (`SKILL_LEVEL`/`CALIBRATION`/`SMOOTHING`), and Value-Hub Slice-0 (`VALUE_HUB_SLICE`) are all **live**, no longer flag-gated or soaking.

## 2. In-flight (on bpm-next, ahead of stable)

`main` carries post-v1.7 work auto-deployed to bpm-next, not yet on the stable cut. Full user-facing list is in `CHANGELOG.md` `Unreleased` (backfilled 2026-08-16). The load-bearing ones:

- **Shuttle Model B — pooled cost** (#230–#234) — a session logs one "tubes × price" number instead of per-batch selection. **This is the change that breaks stable**; see the deployments warning above.
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

- **Value-Hub kill-criteria check** — ⚠️ **the experiment never ran.** The recommendation card and racket picker have **never rendered on either deployment**: `SkillsTab.tsx` passes `gearContent` only when `SKILL_ASSESS` is *off*, and v1.7 turned that spine on for everyone, so the Stats tab's Equipment register is parked (deliberately — see the code comment) on both. The 4-week kill-criterion clock has notionally been running since 2026-06-13 against a surface nobody could see, and the v1.7 changelog entry claiming it live was wrong (corrected 2026-08-16). Two further problems even if it had rendered: `RacketRecCard` has **no click target at all** (a `<div>` with one fetch on mount), and the repo has **no analytics of any kind** — so "interact more than once" was never measurable. The game-log half *is* measurable retroactively from `gameResults.loggedBy` + `loggedAt`. **Decision needed:** un-park Equipment (needs an `equipment` branch in `StatsPlaceholder`'s `assessMode` view, not just passing the prop) and restart the clock with real instrumentation, or rewrite the criterion against data already captured. Tracks 1–4 stay blocked either way.
- **Offline backlog** (deferred, tracked) — per-card `loadError` pills for remaining CommandCenter cards (#98); PWA only if "loads while offline" becomes a real requirement (#99).
- **P1.5/A2 — identity recovery bridge** — still pending. Plan `docs/superpowers/plans/2026-04-27-a2-identity-recovery.md`.
- **Stage-2 / SaaS** — multi-tenant `orgId` migration. Memo `docs/saas-productization-findings.md`. Not started; the one high-risk migration.

## 5. Prioritized punch list

1. **Cut v1.8.** It is the fix for the stable pooled-shuttle defect above, not just hygiene. Blocked on item 2.
2. **Fix #238** (receipt image "save does nothing" on iPhone) — **release gate.** Stable still runs the pre-`a831157` receipt code, so promoting as-is would ship the regression to friends. `a831157` changed the save leg's href from a `data:` URL to a `blob:` object URL and added an `await` before `a.click()`, which is how WebKit's transient activation gets lost. Note a second, fully unfixed copy at `SetupPage.tsx:233-254`, and zero test coverage on the path.
3. **Slice-0 decision** — see §4. Needs a product call before any code.
4. **PR hygiene** — close #208, retarget + land #215, recreate #240 (security), then #239/#237.
5. **Flag debt** — 9 of 13 flags in `lib/flags.ts` are past their stated removal condition (`COMMAND_CENTER`/`SETTLE` by ~11 weeks). `main`-only churn; shouldn't gate the release.
6. **Dead code** — `mergeBirdUsageEdit` (`lib/birdUsages.ts:170`) lost its only production consumer in #232; only tests reference it now.

## 6. Branch hygiene

- ✅ **Full branch sweep 2026-06-18:** retired `feat/value-hub-slice-0` (worktree + local + remote — fully superseded by the v1.7 PRs; PR #118 closed unmerged) and pruned every merged branch: `chore/ci-node24-actions`, `claude/app-review-upcoming-HtKgE` (#162), `feat/in-app-problem-report` (#151, squash-merged; remote already gone).
- **2026-08-16:** local is `main` + `claude/project-status-85q1oq` (the converge work). Stale remotes still carrying open PRs: `claude/app-overview-s6xb2h` (#241), `chore/ci-tsc-typecheck-gate` (#215), `fix/tsc-test-typing` (#208 — delete when #208 is closed), plus three dependabot branches.
- Run `git fetch --prune` + audit `git branch -vv` for `[gone]` markers periodically. `git branch -D` is `bpm confirm`-gated.

## 7. Doc map

| Question | Doc |
|---|---|
| What shipped, when? | `CHANGELOG.md` |
| Where are we going (this file) | `ROADMAP.md` |
| Offline architecture | `docs/plans/offline-legible-fail.md` |
| Value-hub strategy | `docs/plans/value-hub-slice-0.md` |
| How the code works / gotchas | `CLAUDE.md` |
| Deploy/promote/rollback | `docs/deployment-model.md` |
| Live tasks | GitHub milestones/issues |
