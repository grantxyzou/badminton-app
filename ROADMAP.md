# BPM Badminton — Roadmap

> Live at: `grantzou.com/bpm`
> Stack: Next.js · Azure App Service · Cosmos DB Serverless · Anthropic API
> Last updated: March 30, 2026

---

## ✅ Shipped

### Core App
- [x] Name-based sign-up (no account)
- [x] Player list with self-cancel only
- [x] Admin announcements
- [x] Session info (location, date, time)
- [x] PIN-gated admin panel
- [x] Server-side PIN auth — HTTP-only cookie, SHA-256 hash, timingSafeEqual, rate limited 5/15min, 8hr TTL

---

## 🔴 P0 — Immediate (must ship before P1)

### Identity & Sign-Up
- [ ] Invite-only identity — admin adds names to roster, players pick from list (no free-text input)
  > Foundation for skill system — must ship before P1
- [ ] Name picker grid on Home replaces text input
- [ ] `players` collection in Cosmos DB — `name` as partition key, stage, lastSeen, sessionCount
- [ ] localStorage token on selection: `{ name, sessionId, since }`
- [ ] Session full locked state — hide form entirely
- [ ] Sign up by deadline — text label, no countdown

### Admin
- [ ] Roster management — add / remove player names per session
- [ ] In-app session editor — title, location, date, cost, courts, max players
- [ ] Smart announcement — AI polishes rough note, posts to Home

---

## 🟢 P1 — Next meaningful version

### Skill System
- [ ] Stage descriptions on sign-up — 4 stages, concrete "what I can do" criteria
  > Based on Ace Badminton Club Skills Matrix (BC local)
- [ ] Self-assessment — player picks stage from descriptions
- [ ] Stage badge on player list — **public by default** (decided)
- [ ] Admin override — gz nudges any player's stage silently

### Matchmaking
- [ ] Smart Matchmaking — AI balanced courts using stage data (Teams tab)
- [ ] Player grouping — game dividers every 4 players

---

## 🔵 P2 — Depth and engagement

### Identity
- [ ] Emoji PIN — player picks 4 emojis on first session, stored server-side
  > Fixes localStorage fragility (cache clear, new device)
- [ ] Return visit flow — "Welcome back [name]?" with emoji confirm, one-tap sign-up

### Skill System
- [ ] Peer assessment request — opt-in, player asks 1–2 group members
- [ ] AI reconciliation — warm message when self vs peer differ
- [ ] AI pre-session coaching tip — 1 specific focus based on stage
- [ ] AI training suggestions — what to practise between sessions

### Sessions
- [ ] Multi-session — session list on Home, next session pinned, admin creates/manages
- [ ] Per-session URL — e.g. `/bpm/session/apr-3` for WhatsApp sharing
  > ⚠️ Consider moving to P1 — it's the primary distribution mechanism
- [ ] Waitlist — auto when full, notify on cancellation
- [ ] Session recap — AI post-session summary, admin triggers

---

## 🟣 P3 — Polish, depth & community

### Skill System
- [ ] Stage progression celebration — moment when admin bumps you to next stage
- [ ] Full 6-dimension skill profile per player
  > Grip & Stroke · Movement · Serve & Return · Offense · Defence · Strategy
- [ ] Privacy controls — player sets own stage visibility

### Community
- [ ] Attendance history — who showed up across sessions
- [ ] Cost splitting — auto per-person based on sign-ups
- [ ] WhatsApp share button
- [ ] Guest limit — cap guests per member
- [ ] Optional profile upgrade — e-transfer name, email, linked to history

### Infrastructure
- [ ] Subdomain — `badminton.grantzou.com`
- [ ] Multi-admin / RBAC if needed

---

## 🔒 Key Decisions Locked

| Decision | Value |
|---|---|
| Brand colour | `#4ade80` court green |
| Admin PIN auth | Server-side only, HTTP-only cookie, resolved ✅ |
| Identity model | Invite-only: admin adds names → player picks from roster |
| Stage visibility | Public by default (P1) |
| Identity continuity | Name matching (P0) → Emoji PIN (P2) → Optional full profile (P3) |
| DB tier | Cosmos DB Serverless (~$1/mo at BPM scale) |

---

## ⚠️ Open Questions

- Privacy default for stage visibility — open or opt-in?
- Peer assessor eligibility — anyone in group, or court-mates only?
- How does peer request get delivered — in-app, WhatsApp, or both?
- Does gz see self vs peer disagreements in admin?

---

## 📐 The 4 Skill Stages

| Stage | Label | Key signal |
|---|---|---|
| 1 | Getting Started | Still learning to rally consistently |
| 2 | Building Foundations | Can serve, clear, play a real game |
| 3 | Developing Your Game | Shot variety, understands doubles tactics |
| 4 | Competitive Player | Constructs rallies, deception, fast footwork |

Based on Ace Badminton Club Skills Matrix (BC local framework).
This is a **learning framework**, not a rating or leaderboard.
