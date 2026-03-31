# BPM Badminton — Roadmap

> Live at: `grantzou.com/bpm`
> Stack: Next.js 16 · Azure App Service · Cosmos DB · Anthropic API
> Last updated: March 31, 2026

---

## Shipped

### Core App
- [x] Name-based sign-up (no account)
- [x] Player list with self-cancel only (deleteToken auth)
- [x] Admin announcements (create, edit, delete, AI polish)
- [x] Session info (location, date, time, courts)
- [x] PIN-gated admin panel (HTTP-only cookie, SHA-256 hash, timingSafeEqual, rate limited 5/15min, 8hr TTL)
- [x] Security headers (CSP, HSTS, X-Frame-Options, etc.)
- [x] Rate limiting on all public-facing endpoints

### Session Management
- [x] In-app session editor (title, location, date/time, courts, max players)
- [x] Session advance — create next week's session, archive current
- [x] Session history navigator — admin can view player lists from past sessions
- [x] Date-keyed sessions (`session-YYYY-MM-DD`) with pointer architecture
- [x] Sign-up open/closed toggle (`signupOpen` boolean)
- [x] Sign-up deadline enforcement (server-side + client-side)
- [x] Session end time — "Thanks for playing!" state

### Identity & Access
- [x] Invite-only identity — admin adds names to approved list, sign-up gated by case-insensitive match
- [x] Autocomplete from approved names on sign-up form
- [x] Persistent member identity — `members` collection (name, stage, sessionCount, lastSeen)
- [x] Player-to-member linking (`memberId` on Player)

### Waitlist & Capacity
- [x] Waitlist — auto when session full, join via "Join Waitlist" form
- [x] Admin promote from waitlist (capacity-checked)
- [x] Soft delete — players marked `removed: true` instead of hard-deleted
- [x] Admin restore of removed players (capacity-checked)
- [x] Clear session (soft-delete all) and purge all records (hard-delete, irreversible)

### Payment & Admin
- [x] Paid/unpaid toggle per player (admin only)
- [x] E-transfer alias mapping (aliases collection — appName to etransferName)
- [x] CSV export with alias resolution
- [x] Roster management via MembersPanel (add/remove/deactivate members)
- [x] Smart announcements — AI polishes draft, posts to Home

---

## P0 — Immediate (not yet shipped)

### Identity
- [ ] Name picker grid on Home replaces text input (currently text input with autocomplete)

---

## P1 — Next meaningful version

### Skills Radar

A player skill profiling system. Design decisions are locked — implementation has not started.

**Framework:** React component using `recharts` (RadarChart). Add `recharts` to `package.json` when integrating.

**Rating system:** ACE Badminton Club Skills Matrix — 7 categories, each rated 1-6 using named level bands (Beginner, Recreational, Intramural, Varsity, Provincial, National). Not a 1-10 continuous scale.

**Categories (ACE):** Grip & Stroke · Movement · Serve & Return · Offense · Defense · Strategy · Knowledge

**Data model addition — `Player` document:**
```typescript
scores?: {
  [subSkill: string]: number; // 1-6, keyed by sub-skill name
};
```
Optional field, absent on legacy records. All reads must guard with `player.scores ?? {}`.

**Placement:**
- Skill profile lives on a player's profile view (not yet built)
- Players self-rate during an onboarding flow when they first join
- Stage badges (Beginner to National) are public by default
- Admin can see an aggregated group view (P2/P3 — do not build yet)

**API:** Scores stored on the player document, updated via `PATCH /api/players` with `{ id, scores }`. Gate with admin auth or separate token — no unauthenticated score writes.

### Matchmaking
- [ ] Smart Matchmaking — AI balanced courts using stage + skill data

---

## P2 — Depth and engagement

### Identity
- [ ] Emoji PIN — player picks 4 emojis on first session, stored server-side (fixes localStorage fragility)
- [ ] Return visit flow — "Welcome back [name]?" with emoji confirm, one-tap sign-up

### Skill System
- [ ] Peer assessment request — opt-in, player asks 1-2 group members
- [ ] AI reconciliation — warm message when self vs peer differ
- [ ] AI pre-session coaching tip — 1 specific focus based on stage
- [ ] AI training suggestions — what to practise between sessions

### Sessions
- [ ] Per-session URL — e.g. `/bpm/session/apr-3` for WhatsApp sharing
- [ ] Session recap — AI post-session summary, admin triggers

---

## P3 — Polish, depth & community

### Skill System
- [ ] Stage progression celebration — moment when admin bumps you to next stage
- [ ] Full 6-dimension skill profile per player (Grip & Stroke · Movement · Serve & Return · Offense · Defence · Strategy)
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

## Key Decisions Locked

| Decision | Value |
|---|---|
| Brand colour | `#4ade80` court green |
| Admin PIN auth | Server-side only, HTTP-only cookie |
| Identity model | Invite-only: admin adds names to approved list, autocomplete on sign-up |
| Persistent identity | `members` collection with stage, sessionCount, lastSeen |
| Stage visibility | Public by default (P1) |
| Identity continuity | Name matching (shipped) → Emoji PIN (P2) → Optional full profile (P3) |
| Session architecture | Date-keyed (`session-YYYY-MM-DD`) with pointer document |
| DB tier | Cosmos DB, 400 RU/s shared, 5 containers |
| Skills rating | ACE framework, 7 categories, 1-6 scale (not 1-10) |
| Skills visualization | recharts RadarChart |

---

## Open Questions

- Peer assessor eligibility — anyone in group, or court-mates only?
- How does peer request get delivered — in-app, WhatsApp, or both?
- Does admin see self vs peer disagreements?
