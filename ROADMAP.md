# BPM Badminton — Roadmap

> Live at: `https://badminton-app-gzendxb6fzefafgm.canadacentral-01.azurewebsites.net/bpm`
> Stack: Next.js 16 · Azure App Service · Cosmos DB · Anthropic API
> Last updated: April 2, 2026

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

## P1 — Skill Framework (Read-Only)

- [ ] **New tab** *(name TBD — "Coming Soon", disabled for regular users, admin-only access)*: ACE Badminton Club Skills Matrix presented as a read/learn experience — 6 dimensions, stage descriptions, progression guidance
- [ ] **Per-session URL** — shareable link for admin ease of life (single active session; not multi-session architecture yet)

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
| Skill model | ACE Badminton Club Skills Matrix — 6 dimensions (Grip, Movement, Serve, Offense, Defence, Strategy) |
| Skill visibility | Full spider graph public by default |
| Skill tab (P1) | Read-only ACE framework explainer; Coming Soon for regular users; admin-accessible |
| Session architecture | Date-keyed (`session-YYYY-MM-DD`) with pointer document |
| DB tier | Cosmos DB, 400 RU/s shared, 5 containers |
| Admin auth | Server-side PIN, HTTP-only cookie (until real accounts in P4) |
| Admin tab visibility | Hidden by default, revealed via member role OR 5-tap easter egg |
