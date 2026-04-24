# BPM Badminton — Roadmap

> **Stable:** https://badminton-app-gzendxb6fzefafgm.canadacentral-01.azurewebsites.net/bpm
> **Next (preview):** https://vnext-badminton-app-enhcave5djcvafe9.canadacentral-01.azurewebsites.net/bpm
> **Stack:** Next.js 16 · Azure App Service (dual) · Cosmos DB · Anthropic Claude API
> **Last updated:** 2026-04-24

Ranking runs P0 (foundation) → P4 (polish). **P1.5** and **P1.6** were inserted after the user-research simulation revealed 7 of 10 top unmet needs had zero coverage. **P1.7** landed as the formalized design-system pass.

---

## P0 — Foundation ✅ Shipped (v1.0, 2026-04-18)

Everything below tagged on `bpm-stable-v1.0`.

- [x] Name-based sign-up with invite-list gating (`session.approvedNames`) + autocomplete
- [x] Player list with self-cancel (deleteToken auth)
- [x] Waitlist — auto when full, admin-promote (capacity-checked)
- [x] Soft delete + admin restore (capacity-checked)
- [x] Admin announcements (create / edit / delete / AI-polish)
- [x] PIN-gated admin panel (HTTP-only cookie, `timingSafeEqual`, rate-limited)
- [x] Session editor (venue, date/time, courts, capacity, cost)
- [x] Date-keyed sessions + pointer architecture (`session-YYYY-MM-DD` + `active-session-pointer`)
- [x] Session history navigator (admin)
- [x] Sign-up open/closed toggle + deadline enforcement
- [x] Paid/unpaid toggle, e-transfer alias mapping, CSV export
- [x] Persistent member identity (`members` container with role system)
- [x] Admin tab hidden by default; revealed via member role OR 5-tap easter egg
- [x] `GET /api/members/me` — public role lookup
- [x] Dynamic OG image for link previews
- [x] Theme system (light/dark with system-preference auto-follow)
- [x] ShuttleLoader branded loading animation
- [x] Consolidated localStorage identity (`{ name, token, sessionId }`) with stale-session detection
- [x] Security headers (CSP, HSTS, X-Frame-Options, Permissions-Policy, etc.)
- [x] Rate limiting on all public endpoints (in-memory, per client IP)

---

## v1.0.1 — Timezone hotfix + dual deployment ✅ Shipped (2026-04-22)

First exercise of the tag-based promotion runbook.

- [x] Session times render in `America/Vancouver` (were UTC) (#19)
- [x] Two-deployment pipeline: `bpm-next` auto-deploys main; `bpm-stable` deploys by tag only (#13, #14, #15)
- [x] Typed feature-flag registry (`lib/flags.ts`) with `plannedRemoval` retirement rule (#13)
- [x] Preview banner on `bpm-next` (orange strip, shows git SHA + mailto bug-report) (#13, #16, #18)
- [x] [`docs/deployment-model.md`](docs/deployment-model.md) runbook (#17)

---

## P1 — Skill Framework ⏳ Mostly Shipped

- [x] **Skills tab in nav** — "Coming Soon" placeholder for public; functional admin-only interface
- [x] **ACE Skills Matrix** — 7 dimensions × 6 levels in `lib/skills-data.ts`
- [x] **SkillsRadar** — recharts radar, solo/overlay mode, player pills, 2-column category grid, drag-to-dismiss sheet for level detail + edit
- [x] **Skills API persistence** — `/api/skills` (GET/POST/PATCH/DELETE), admin-only, upsert by `(sessionId, name)` case-insensitive. Lazy container bootstrap via `ensureContainer`. 15 tests
- [x] **Admin add + edit skill profiles** — inline Add Player form in Skills tab; optimistic PATCH with parent refresh
- [ ] **Stage 2: read-only radar for regular users** — still "Coming Soon" pending public rollout
- [ ] **Per-session URL** — shareable link for admin convenience (single active session for now, not multi-session)

### Session 12 extras (shipped with P1)

- [x] **Multi-source bird tracking** — `session.birdUsages` array of `{purchaseId, tubes, costPerTube, totalBirdCost}`. 0.5-tube increments. Legacy single-object docs auto-migrate via `normalizeBirdUsages` on next save
- [x] **Cost-per-person renders as standalone CostCard** (post P1.5 research; see below)
- [x] **Session editor card split** — Session Details + Cost Details as separate cards with body-text descriptions
- [x] **One-handed mobile** — sign-up card, Add Player, Add Purchase, Add Alias all moved to thumb zone at the bottom of their surfaces

---

## P1.5 — Access & Admin Relief ✅ Mostly Shipped

Inserted 2026-04-13 after [`docs/user-research-simulation.md`](docs/user-research-simulation.md) revealed the roadmap gap. Sprint sequence: A → C → B.

- [x] **A1**: Cold-start splash + cost/payment visibility (PR #2, 2026-04-13)
- [x] **C1**: i18n framework + 14-key canary (2026-04-13) — `next-intl` v4 cookie-based, en + zh-CN
- [x] **C2**: zh-CN content sweep (PR #10, 2026-04-17) — BottomNav + HomeTab + PlayersTab
- [x] **C3**: date localization via `useFormatter` (PR #11, 2026-04-17) — zh-CN dates + 24-hour time
- [ ] **A2**: identity recovery bridge — name + secret phrase reclaim before P3 emoji PIN
- [ ] **B1**: e-transfer reconciliation (AI) — payment aggregate admin view, AI-matched bank notifications

---

## P1.6 — Research-Gap Fixes + UX Discoverability ✅ Mostly Shipped

Added alongside P1.5 to address the rest of the research-report top needs + onboarding gaps.

- [x] **R1**: text-size accessibility bump (2026-04-14) — base text min 16px for 50+ readability (research #6)
- [x] **R2**: first-time onboarding card (PR #4, 2026-04-15) — `<WelcomeCard />` explaining what BPM is, invite-list guidance, payment expectations (research #4)
- [x] **R5**: user-facing release notes (PR #5, 2026-04-16) — terminal-themed `<ReleaseNotesSheet />` + AI-assisted draft flow in admin
- [x] **R6**: BottomSheet primitive (PR #6, 2026-04-16) — portal + zIndex + body-lock + focus-trap + CSS animation state machine
- [x] **R7**: page headers + SkillsRadar green rebalance (PR #7, 2026-04-16) — 30px h1, 5 `var(--accent)` → `var(--text-primary)` swaps on level copy
- [ ] **R3**: WeChat OG + in-app browser compat (research #7) — rich previews, localStorage quirk testing
- [ ] **R4**: proxy sign-up (research #10) — admin/player signs up on behalf of another player

---

## P1.7 — Design System v3 ✅ Shipped to `bpm-next` (PR #22, 2026-04-24)

End-to-end adoption of the formalized design-system bundle from claude.ai/design. Stage will promote to `bpm-stable-v1.1` after friend-group testing.

- [x] **Bundle mirror** at `docs/design-system/` — 43 files (tokens, 28 specimen HTMLs, UI-kit JSX refs, 3 self-hosted variable fonts)
- [x] **Type trio adopted live** — Space Grotesk (display) + IBM Plex Sans (body) + JetBrains Mono (data) via `next/font/local`
- [x] **Material Icons → Material Symbols Rounded** (subsetted to ~43 glyphs, ~20 KB from ~100 KB)
- [x] **Backgrounds** — 02 Aurora (3-blob fast-compositor) as default; 03 Court (real badminton-doubles proportions, aspect-locked) on Sign-Ups only, wired via `html[data-tab=...]`
- [x] **`<BpmWordmark />`** component — tempo-dot logo, displayed on `/design/logo` preview
- [x] **`<ShuttleIcon />`** — brand shuttlecock, replaces `sports_tennis` in empty states
- [x] **Canonical component alignment** — pills (11/600/0.04em), status banners (radius 12, padding 12×14, +red variant), glass card (radius 24→16, saturate 180%), BottomNav (inline-flex pill, FILL-axis active glyph)
- [x] **Light-mode legibility audit** — theme-adaptive `--sev-*-text` tokens, pill waitlist/admin/red light overrides, fixed docs-CSS cascade shadowing bug
- [x] **Perf pass** — GlassPhysics touch-skip, DatePicker RAF-coalesce, React.memo on HomeTab children, SkillsRadar useMemo, `prefers-reduced-transparency` kill-switch, splash 5.4s failsafe, HydrationMark moved to root layout
- [x] **Form a11y** — 38 inputs/textareas/selects across `/design/components`, SkillsTab, admin surfaces now carry `id` + `name` + `autoComplete`
- [x] **Touch targets** — 44×44 minimum on DatePicker chevrons + AdminDashboard logout/person_remove
- [x] **Preview route** at `/bpm/design` — 7 sub-pages, flag-gated behind `NEXT_PUBLIC_FLAG_DESIGN_PREVIEW` (404 on stable)

---

## P2 — Self-Assessment & Radar

- [ ] Player self-assessment — rate yourself across ACE dimensions
- [ ] Spider graph intro — visualize your profile
- [ ] Stage badge on player card — derived from ACE matrix stages
- [ ] Full radar chart public by default
- [ ] Attendance history, cost splitting view, WhatsApp/WeChat share

---

## P3 — Identity & Social Depth

- [ ] Emoji PIN identity (replaces localStorage fragility)
- [ ] Return-visit flow — "Welcome back [name]?" with emoji confirm
- [ ] Peer assessment, AI reconciliation, coaching tips
- [ ] Smart Matchmaking — AI balanced courts using skill profiles
- [ ] Player grouping / game dividers every 4 players
- [ ] Guest limit, optional profile upgrade (e-transfer, email)

---

## P4 — Polish & Community

- [ ] Stage progression celebration
- [ ] Admin override — silently nudge any player's skill stage
- [ ] Multi-session support
- [ ] Session recap — AI post-session summary
- [ ] Subdomain: `badminton.grantzou.com`
- [ ] Multi-admin / RBAC

---

## Parallel track — SaaS productization (research only)

See [`docs/saas-productization-findings.md`](docs/saas-productization-findings.md) (2026-04-18) — decision memo on whether to multi-tenant the codebase. **Status: not started**; waiting on pilot validation with 3+ committed organizers before any code changes.

---

## Key Decisions Locked

| Decision | Value |
| --- | --- |
| Brand accent | `#4ade80` court green (dark) / `#16a34a` (light) |
| Type trio | Space Grotesk (display) + IBM Plex Sans (body) + JetBrains Mono (data) |
| Identity model | invite-only → emoji PIN (P3) → optional full profile (P4) |
| Skill model | ACE Badminton Club Skills Matrix — 7 dimensions × 6 levels |
| Skill visibility (P2+) | Full radar public by default |
| Session architecture | Date-keyed (`session-YYYY-MM-DD`) with pointer document |
| DB tier | Cosmos DB, 400 RU/s shared, 7 containers |
| Deployment model | Dual App Service — `bpm-next` auto on push, `bpm-stable` by tag |
| Schema rule | Additive-only while next and stable share one DB |
| Admin auth | Server-side PIN + HTTP-only cookie (until real accounts in P4) |
| Admin tab visibility | Hidden by default; revealed via member role OR 5-tap easter egg |
| Corner radii | Rectangular surfaces capped at **16px**; 100px for pills |
