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
> **Last updated:** 2026-06-18
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
| **bpm-stable** | regular friends | **v1.7** (2026-06-13) | Full flag parity with `bpm-next` — every feature flag flipped **on**; only `NEXT_PUBLIC_ENV` differs (preview banner off) |
| **bpm-next** | beta friends | `main` | auto-deploys every push to `main` |

Promotion = tag a **specific commit** + dispatch `deploy-stable.yml` (never blindly tag `main` — it carries post-soak work; see CLAUDE.md "stable-tag footgun").

Tag `bpm-stable-v1.7` → `d4cdf7b` (the release commit; backfilled 2026-06-18 — v1.7 shipped 2026-06-13 but the promotion tag had been missed). Rollback/promotion targets are valid through v1.7.

---

## 1. Shipped (stable)

Through **v1.7** — see `CHANGELOG.md` for the full per-version record (v1.0 → v1.7: sign-ups/waitlist, admin, skills, i18n, stats, bird inventory, Command Center, unified Home auth, Send-the-bill/Settle, Ledger + cover-and-remove, Labeled Rail nav + trusted-device sign-up, **skill-accuracy spine + Value-Hub Slice-0**, full app-code audit remediation + a11y + security hardening). History ladder (old P0–P1.8) retired — CHANGELOG is authoritative.

As of **v1.7, stable and `bpm-next` are at full flag parity** — every feature flag is on for everyone. Offline legible-fail, the skill-assessment spine (`SKILL_ASSESS`), accurate skill level (`SKILL_LEVEL`/`CALIBRATION`/`SMOOTHING`), and Value-Hub Slice-0 (`VALUE_HUB_SLICE`) are all **live**, no longer flag-gated or soaking.

## 2. In-flight (on bpm-next, ahead of stable)

`main` carries post-v1.7 work auto-deployed to bpm-next, not yet on the stable cut:

- **Stats game-logger de-gating** (#162, merged 2026-06-18) — logger usable any day, decoupled from the 48h session window; honest tri-state instead of silent `null`. Verified live on next.
- **Stats design-system standardization** (#170–177) — inner-content styling reference, `<ListRow>` primitive, radius-token sweeps, token-guardrail lint→error on `components/stats`.
- **Dependency patches** (#178) — next 16.2.9, vitest 4.1.9, eslint-config-next 16.2.9.
- **Stats visual polish** (flat cards + AI "Your read" conic rim) rode in unflagged with v1.7.

> The legacy `.claude/soak.local.md` tracker may still nag about `skill-assess` / `stats-ui-polish` "soaking" — that's **stale**; both promoted to everyone in v1.7. Update or clear it.

## 3. Open PRs

**None.** (Dependabot batch resolved 2026-06-18: #150/#152 patches consolidated → #178 merged; React 19 majors #139/#140 closed-deferred — Next 16 peer-accepts React 18, revisit in a quiet window.)

## 4. Planned / next initiatives

- **Value-Hub kill-criteria check** — Slice-0 is **shipped and live**; the critical path now gates on proving engagement against the written kill-criterion in `docs/plans/value-hub-slice-0.md` **before** fanning out Tracks 1–4. No speculative multi-track building (LOCKED block).
- **Offline backlog** (deferred, tracked) — per-card `loadError` pills for remaining CommandCenter cards (#98); PWA only if "loads while offline" becomes a real requirement (#99).
- **P1.5/A2 — identity recovery bridge** — still pending. Plan `docs/superpowers/plans/2026-04-27-a2-identity-recovery.md`.
- **Stage-2 / SaaS** — multi-tenant `orgId` migration. Memo `docs/saas-productization-findings.md`. Not started; the one high-risk migration.

## 5. Prioritized punch list

1. **Value-Hub Slice-0 kill-criteria readout** — gather engagement signal from live users; decide go/no-go on Tracks 1–4. *(The one live item — everything below it is done.)*
2. ✅ ~~Verify PR #162 on next~~ — done; verified live + merged 2026-06-18.
3. ✅ ~~Dependabot batch~~ — done; #178 merged (patches), React 19 deferred.
4. ✅ ~~Branch cleanup~~ — done; full sweep to `main`-only (§6).

## 6. Branch hygiene

- ✅ **Full branch sweep 2026-06-18:** retired `feat/value-hub-slice-0` (worktree + local + remote — fully superseded by the v1.7 PRs; PR #118 closed unmerged) and pruned every merged branch: `chore/ci-node24-actions`, `claude/app-review-upcoming-HtKgE` (#162), `feat/in-app-problem-report` (#151, squash-merged; remote already gone).
- Local branches now: **`main` only.** Single clean worktree.
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
