# BPM Badminton — Codebase Audit (2026-06-02)

Read-only audit of the full ~77K-LOC app across security, silent bugs, logic,
efficiency, code quality, type design, design/UX, and a11y. **Nothing in the app
was changed.** Findings are for triage.

- **[Phase 1 — targeted, high-leverage surfaces](./2026-06-02-phase1.md)** — security/auth, the ~133 `catch` blocks, Cosmos, top-12 hotspot files, perf, + tooling & live-UX passes.
- **[Phase 2 — full sweep](./2026-06-02-phase2.md)** — the remaining ~150 files (auth sheets, SPA shell, Stats, Command Center, admin misc, lib, money-math routes, REST routes).

## How findings were produced & trusted

A multi-agent fan-out reviewed each area against the project's own rules in
`CLAUDE.md`. **Every high-severity finding was then adversarially re-verified by a
separate agent that tried to refute it.** Of 14 high findings, **13 were confirmed
real and 1 was refuted and excluded** — the verification pass demonstrably works,
so the highs are trustworthy. Medium/low findings are high-quality single-pass
leads (confidence noted per row), not individually re-verified.

## Totals

| | Critical | High | Medium | Low | Total |
|---|---|---|---|---|---|
| Phase 1 | 0 | 9 | 18 | 30 | 57 |
| Phase 2 | 0 | 5 | 18 | 33 | 56 |
| **Both** | **0** | **14** | **36** | **63** | **113** |

`npm audit`: **0 vulnerabilities.** No critical-severity findings. The high ones
are real-but-bounded (friend-group, single-instance, Azure-fronted deployment).

## The five things that actually matter

1. **🟠 "Lying empty state" is systemic — 7 confirmed spots.** A failed
   Cosmos/fetch is swallowed and rendered as confident "no data": `GET /api/players`,
   `GET /api/skills`, `PaymentsCard`, `ProfileTab`, `PlayersTab`, `BirdInventoryCard`,
   `AnnouncementsCard`. This is the *exact* pattern that caused the v1.3 outage and
   that `CLAUDE.md` explicitly forbids. Several don't call `reportFetchFailure()`, so
   even the app-wide offline banner stays silent. **One fix pattern, applied 7×**
   (track `loadError`, render an error pill) — the single highest-value cleanup.

2. **🟠 `PUT /api/session` silently wipes fields on any session edit — from two
   editors.** It rebuilds the doc from a fixed key-set without reading the existing
   one, so editing session details (`SessionDetailsEditor`) *or* date/time
   (`DateTimeEditor`) destroys `settled`, **`approvedNames` (reopens a closed invite
   list — a security regression)**, and the `prev*` payment/anomaly snapshots. Fix
   the route once (read-spread-upsert, like `dismiss-anomaly` already does).

3. **🟠 Admin-auth contract under-enforced.** ~Every mutating admin route uses sync
   `isAdminAuthed` instead of the role-rechecking `isAdminAuthedWithMember` its own
   docs mandate (demoted admin keeps write powers 30 days), plus two unauthenticated
   write paths (`equipment/gear` PUT, `games` POST `sessionId` override) and a
   name-only first-PIN claim on `members/me`.

4. **🟠 ESLint is completely dead** (Next 16 + ESLint 10 bumps broke it three ways;
   CI never ran it). A whole class of issues — a11y, exhaustive-deps, unused vars —
   goes uncaught. Repairing it is the highest-leverage *tooling* fix.

5. **🟠 Three discrete correctness/data bugs:** "Cover their $X" shows for
   already-paid players (writes off a settled debt); `SetupPage` collapses
   multi-purchase `birdUsages` on save (understates cost); `/api/sessions/recent`
   does an N+1 Cosmos query.

Plus: the auth sheets handle errors inconsistently (`EnterCodeSheet` reads a 5xx as
"wrong code"), and there are a11y gaps on the primary sign-up path (no combobox
roles; hand-rolled dialogs without focus traps).

## Suggested remediation order

1. **Silent-failure cluster** (all 7) — highest risk, mostly S effort, one pattern.
2. **`PUT /api/session` read-spread-upsert** — data-loss + security regression, M.
3. **Repair ESLint + add the CI lint step** — stops the bleeding, surfaces more automatically.
4. **Admin-auth**: switch mutating routes to `isAdminAuthedWithMember`; close the 2 unauth writes + the `members/me` claim.
5. **The 3 correctness bugs** + the `EnterCodeSheet` error mapping.
6. **A11y**: combobox roles + focus traps.

Each of 1–6 is a self-contained, testable workstream (TDD) — pick them off in order.
