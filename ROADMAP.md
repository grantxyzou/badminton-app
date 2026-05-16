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
> **Last updated:** 2026-05-16
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
| **bpm-stable** | regular friends | **v1.4** (tag `bpm-stable-v1.4` = `ab566e0`, 2026-05-16) | v1.5/A code present but flag-gated **off** (dormant) |
| **bpm-next** | beta friends | `main` (`98b4be4` = v1.4 + offline) | auto-deploys every push to `main` |

Promotion = tag a **specific commit** + dispatch `deploy-stable.yml` (never blindly tag `main` — it carries post-soak work; see CLAUDE.md "stable-tag footgun").

---

## 1. Shipped (stable)

Through **v1.4** — see `CHANGELOG.md` for the full per-version record (v1.0 → v1.4: sign-ups/waitlist, admin, skills, i18n, stats, bird inventory, Command Center, unified Home auth, Send-the-bill/Settle). History ladder (old P0–P1.8) retired — CHANGELOG is authoritative.

## 2. In-flight (on bpm-next, soaking)

- **Offline legible-fail** — `useOnline` provider + app-wide banner + admin-gate preserve + `AdminErrorBoundary` + entry-point gating + `?tab=` persistence. On `main`/next (`98b4be4`). Plan: `docs/plans/offline-legible-fail.md`. **Soak → stable decision pending** (tag a post-offline commit when ready).
- **v1.5/A** (writtenOff + Cover) — shipped to stable dormant under `NEXT_PUBLIC_FLAG_LEDGER`; flip when v1.5/B–D land.

## 3. Open PRs

- **#95** value-hub Slice-0 (`claude/plan-app-design-NneJV`) — ratified strategy + scaffolding. Plan `docs/plans/value-hub-slice-0.md` (⚠ only on this branch — not on main until merged).
- **#96** audit fixes (`fix/audit-followups`) — ProfileTab lying-empty fix + doc accuracy.
- **#97** dependabot `next 16.2.1→16.2.6` — deferred; don't merge during the v1.4-promoted / offline-soaking window. Review post-soak.

## 4. Planned / next initiatives

- **Value-Hub** (post-merge of #95) — 4 tracks (Insight / Equipment / Learning+Rec / Reach), decisions A–G ratified 2026-05-16. Slice-0 first, kill-criteria gated. See the plan doc.
- **In-app feedback / bug report (stable)** — regular friends on stable can't file GitHub issues; need a dead-simple in-app "tell the admin something's wrong" path (no GitHub account, no jargon). Serves the cost-automation/value-hub pillar (closes the feedback loop the value-hub plan flagged as missing). Tracked: GH issue under Operational hardening.
- **Offline backlog** (deferred, tracked) — per-card `loadError` pills for the ~16 remaining CommandCenter cards; PWA/service-worker only if "loads while offline" becomes a real requirement.
- **P1.5/A2 — identity recovery bridge** — still pending. Plan `docs/superpowers/plans/2026-04-27-a2-identity-recovery.md`.
- **v1.5/B–D** — ledger page + Command Center row + remove-after-settle. Plan `docs/superpowers/plans/2026-05-13-v1.5a-write-off-cover.md`.
- **Stage-2 / SaaS** — multi-tenant `orgId` migration. Memo `docs/saas-productization-findings.md`. Not started; the one high-risk migration.

## 5. Prioritized punch list

Constraint: bpm-stable just took v1.4 the day before a real sign-up; bpm-next carries v1.4+offline.

1. **Smoke stable v1.4** (sign-up flow on the real site) — highest priority, real event imminent.
2. **Let offline soak on bpm-next** (beta friends) — no action; gather signal.
3. **Merge #96** (small, corrects misleading CLAUDE.md/ROADMAP) — low risk, anytime.
4. **Merge #95** (inert scaffolding) — brings the value-hub plan onto main (fixes the "strategy not in trunk" gap).
5. **Offline → stable** — after a clean soak: tag a post-offline commit, promote.
6. **Branch cleanup** (see below) + value-hub Slice-0 build kickoff.

## 6. Branch hygiene

Delete (merged/redundant/stale): `feat/offline-legible-fail` (merged → `98b4be4`), `fix/offline-admin-gate` (+ its `951a96e` cherry-pick — superseded by the combined merge), `feature/command-center-read-apis` + `origin/feature/command-center-data-plumbing` (shipped v1.4), `docs/presentation-decks`, `fix/wire-flags-build-time`, `origin/soak/stats-attendance-2026-05-10`. Keep: `fix/audit-followups` (#96), `review/value-hub-slice-0` (local track of #95). `git branch -D` is `bpm confirm`-gated.

## 7. Doc map

| Question | Doc |
|---|---|
| What shipped, when? | `CHANGELOG.md` |
| Where are we going (this file) | `ROADMAP.md` |
| Offline architecture | `docs/plans/offline-legible-fail.md` |
| Value-hub strategy | `docs/plans/value-hub-slice-0.md` (on PR #95) |
| How the code works / gotchas | `CLAUDE.md` |
| Deploy/promote/rollback | `docs/deployment-model.md` |
| Live tasks | GitHub milestones/issues |
