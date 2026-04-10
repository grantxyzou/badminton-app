# BPM Badminton — Roadmap

> Live at: `https://badminton-app-gzendxb6fzefafgm.canadacentral-01.azurewebsites.net/bpm`
> Stack: Next.js 16 · Azure App Service · Cosmos DB · Anthropic API
> Last updated: April 10, 2026

---

## P0 — Immediate ✅ Complete

- [x] Name-based sign-up with invite-list gating (approved names)
- [x] Autocomplete from approved names on sign-up form
- [x] Player list with self-cancel (deleteToken auth)
- [x] Waitlist — auto when session full, admin promote (capacity-checked)
- [x] Soft delete + admin restore (capacity-checked)
- [x] Admin announcements (create, edit, delete, AI polish)
- [x] PIN-gated admin panel (HTTP-only cookie, timingSafeEqual, rate-limited)
- [x] Session editor (title, location, date/time, courts, max players)
- [x] Session advance — date-keyed sessions with pointer architecture
- [x] Session history navigator (admin)
- [x] Sign-up open/closed toggle + deadline enforcement
- [x] Paid/unpaid toggle, e-transfer alias mapping, CSV export
- [x] Persistent member identity (`members` collection with role system)
- [x] Admin tab hidden by default (revealed via member role or 5-tap easter egg)
- [x] `GET /api/members/me` — public role lookup for admin tab visibility
- [x] Dynamic OG image for link preview thumbnails
- [x] Theme system (light/dark with system preference auto-follow)
- [x] ShuttleLoader branded loading animation
- [x] Consolidated localStorage identity (`{ name, token, sessionId }`) with stale session detection
- [x] Security headers (CSP, HSTS, X-Frame-Options, etc.)
- [x] Rate limiting on all public-facing endpoints

---

## P1 — Skill Framework ⏳ Mostly Shipped

- [x] **Skills tab in nav** — "Coming Soon" placeholder for regular users; functional admin-only interface
- [x] **ACE Skills Matrix** — 7 dimensions × 6 levels in `lib/skills-data.ts`
- [x] **SkillsRadar component** — recharts radar chart, solo/overlay mode, player pills, 2-column category grid, drag-to-dismiss bottom sheet for level detail + edit
- [x] **Skills API persistence** — `/api/skills` (GET/POST/PATCH/DELETE), admin-only, upsert by `(sessionId, name)` case-insensitive. Lazy container bootstrap via `ensureContainer`. 15 tests.
- [x] **Admin can add and edit player skill profiles** — inline Add Player form in the Skills tab; score edits PATCH optimistically with parent refresh.
- [ ] **Stage 2: Read-only radar for regular users** — non-admin view of the radar (still "Coming Soon" for now)
- [ ] **Per-session URL** — shareable link for admin ease of life (single active session; not multi-session architecture yet)

### Session 12 extras (not strictly P1 but shipped together)

- [x] **Multi-source bird tracking** — `session.birdUsages` array of `{purchaseId, tubes, costPerTube, totalBirdCost}`. Supports 0.5-tube increments for partial tubes. Legacy single-object docs auto-migrate on next save via `normalizeBirdUsages` shim.
- [x] **Cost per person moves into Announcement card** — no standalone cost card; renders as a dynamic line inside the announcement when both exist. Live per-person preview in the admin Cost Details editor.
- [x] **Session editor card split** — separate "Session Details" (venue, capacity, sign-ups) and "Cost Details" (court cost, bird sources, show-cost toggle) cards with body text descriptions.
- [x] **One-handed mobile optimization** — Sign-up card, Add Player, Add Purchase, Add Alias all moved to the bottom of their surfaces for thumb reach. Admin announcements lifted above Players.

---

## P2 — Self-Assessment & Radar

- [ ] Player self-assessment — rate yourself across ACE 6 dimensions
- [ ] Spider graph intro — visualise your profile, understand where you are
- [ ] Stage badge on player card — derived from ACE matrix stages
- [ ] Full radar chart public by default
- [ ] Attendance history, cost splitting, WhatsApp share

---

## P3 — Identity & Social Depth

- [ ] Emoji PIN identity (replaces localStorage fragility)
- [ ] Return visit flow — "Welcome back [name]?" with emoji confirm
- [ ] Peer assessment, AI reconciliation, coaching tips
- [ ] Smart Matchmaking — AI balanced courts using skill profile data
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

## Key Decisions Locked

| Decision | Value |
|---|---|
| Brand colour | `#4ade80` court green |
| Identity model | invite-only → emoji PIN (P3) → optional full profile (P4) |
| Skill model | ACE Badminton Club Skills Matrix — 7 dimensions (Grip & Stroke, Movement, Serve & Return, Offense, Defense, Strategy, Knowledge) × 6 levels (Beginner → National) |
| Skill visibility | Full spider graph public by default |
| Skill tab (P1) | Read-only ACE framework explainer; Coming Soon for regular users; admin-accessible |
| Session architecture | Date-keyed (`session-YYYY-MM-DD`) with pointer document |
| DB tier | Cosmos DB, 400 RU/s shared, 7 containers (sessions, players, announcements, members, aliases, birds, skills) |
| Admin auth | Server-side PIN, HTTP-only cookie (until real accounts in P4) |
| Admin tab visibility | Hidden by default, revealed via member role OR 5-tap easter egg |
