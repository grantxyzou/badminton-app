# Admin Command Center — Design

**Date:** 2026-05-05
**Status:** Draft (post-brainstorm, pre-implementation-plan)
**Owner:** Grant
**Track:** P1.7 — Admin Redesign (item #4 from "Things I want to work on")

## Summary

Replace today's `AdminDashboard` with a **unified command center** that earns the organizer's trust by making state legible across every admin domain — sessions, payments, birds, roster, anomalies. No automation in v1. The bet: when admin can glance and confirm "everything looks right" in 30 seconds, *that* is the relief, and the parallel Excel sheet retires.

Auto-advance and recurring schedules are explicitly **out of scope** for this spec. They get parked until the command center has been lived in for several weeks. This spec is "visibility + safe automation" — automation only on deterministic chores (form pre-fill, bird projections, payment reminder drafts), never on decisions.

## Goals

1. One screen surfaces the true state of every admin-relevant domain. No "I should check Excel to be sure."
2. Per-player history (attendance, cost, paid status) always queryable from any player name.
3. Group-format payment receipts (image + text) shareable to WeChat / iMessage in one tap.
4. Anomaly feed surfaces settings drift, skip dates, and long breaks before they cause embarrassment.
5. Schema changes are additive and optional (preserves bpm-stable / bpm-next co-existence).

## Non-goals

- Auto-advancing the next session.
- Recurring schedule rules.
- Multi-admin / co-organizer signals (couples to multi-group track; brainstorm together).
- Standalone full Session History view (Recent Sessions strip on home covers most need).
- Skill progression analytics in admin (Stats tab covers this for non-admin).
- QR codes on receipts.
- "Receipt sent" tracking (paid status remains source of truth).
- Holiday calendar auto-populate (skip dates are user-defined only).
- Runtime DB toggle (dummy vs real). Tracked as separate future spec.

---

## 1. Surfaces (information architecture)

The command center **replaces today's `AdminDashboard`** as the landing screen of the Admin tab. No new top-level navigation.

Three surfaces:

### 1.1 Command Center (default view)

Vertically stacked cards in deliberate priority order (most-time-sensitive on top):

1. **Next Session card** — date, signup count vs capacity, deadline countdown, signup-open status, anomaly chips
2. **Payments card** — payment grid (rows = players, cols = paid/pending/overdue), per-row "Send receipt", top-level "Generate group receipt"
3. **Anomaly Feed** — collapsed by default, expanded chip when items present
4. **Bird Inventory card** — tubes on hand, weeks remaining at current burn rate, recent purchases
5. **Roster Health card** — invite list size, waitlist count, recent soft-deletes
6. **Recent Sessions strip** — horizontal scroll, last 6 sessions, tap → expands inline

### 1.2 Player Profile sheet

Accessed by tapping any player name anywhere (payment grid, roster, recent sessions). Renders inside `<BottomSheet>`. Shows that player's last 12 sessions with attendance + cost + paid status, plus all-time totals (sessions attended, total paid, current streak).

### 1.3 Existing admin routes (advance form, bird inventory page, etc.)

Stay where they are. Become **drill-ins from the command center**, not separate destinations. Command center is the hub.

---

## 2. Data model changes (additive only)

### 2.1 `sessions` container

Additions to the existing session doc:

```ts
session.prevSnapshot: {
  courtCount: number,
  costPerCourt: number,
  maxPlayers: number,
  deadlineOffsetHours: number,
  signupOpensOffsetHours: number,
} | null   // frozen at advance time

session.anomaliesAtAdvance: string[]    // codes detected at advance moment
session.anomaliesDismissed: string[]    // codes user dismissed for this session

session.eTransferRecipient: {
  name: string,
  email: string,
  memo?: string,
} | null   // override; falls back to active admin's members.eTransferRecipient
```

Existing `prevSessionDate` and `prevCostPerPerson` remain untouched (legacy readers).

### 2.2 `members` container

Additions for admin members:

```ts
member.eTransferRecipient: { name, email, memo? } | null   // organizer's default
member.skipDates: string[]    // YYYY-MM-DD list of dates admin marked as skipped
```

### 2.3 `players` container

Add stable member linkage:

```ts
player.memberId: string | null   // points to members.id
```

`name` field unchanged. Read path prefers `memberId`; falls back to `name + aliases` resolution if `memberId` is null.

### 2.4 No new containers

Anomalies are computed at read time. Recent sessions list reuses existing `sessions` container.

---

## 3. memberId migration

### 3.1 Write path

- `POST /api/players` (signup): before insert, lookup `members` by name; create member if absent; set `memberId` on the player record.
- `POST /api/players/recover`: ensure `memberId` is written on the recovered player.
- `POST /api/admin/advance`: if any player records are carried forward, preserve `memberId`.
- All other player-writing endpoints: ensure `memberId` is set.

### 3.2 Read path

- `GET /api/members/:id/history`: query `players WHERE memberId = X`. Cross-partition.
- For records without `memberId` (un-backfilled), fall back: `players WHERE name = X OR name IN (aliases of X)`.

### 3.3 Backfill script

Location: `scripts/migrate-memberId.ts`

Behavior:
- For each `players` record without `memberId`:
  - Resolve canonical name via aliases.
  - Find matching `members` doc by name. If absent, create one.
  - Update player record with `memberId`.
- **Halts on collision** (two distinct people sharing a name) — outputs the collision list for manual review.
- Idempotent (safe to re-run).
- Supports `--dry-run` flag.

### 3.4 Migration timing

**Order:**
1. Ship write-path changes (additive, no read change yet).
2. Run backfill script.
3. Ship command center (read path uses `memberId` with name fallback as defense-in-depth).

This separates data plumbing (low-risk, no UI dependency) from feature work (runs against clean data).

---

## 4. Components

All on the existing Admin tab.

| Component | Purpose |
|---|---|
| `<CommandCenter>` | Replaces `AdminDashboard`. Hosts the cards. |
| `<NextSessionCard>` | Current session at a glance + anomaly chips |
| `<PaymentsCard>` | Payment grid + receipt export buttons |
| `<AnomalyFeed>` | Collapsed when empty; expands when items present |
| `<BirdInventoryCard>` | Inventory + projection |
| `<RosterHealthCard>` | Invite list, waitlist, recent removals |
| `<RecentSessionsStrip>` | Last 6 sessions, tap to expand inline |
| `<PlayerProfileSheet>` | `<BottomSheet>`; player's last 12 sessions + lifetime totals |
| `<ReceiptSheet>` | `<BottomSheet>`; group format (default) + individual format toggle |
| `<SkipDateInlineEditor>` | Inline (in command center settings) — admin manages `members.skipDates` |
| `<AnomalyBlockingSheet>` | `<BottomSheet>`, blocking severity (e.g., skip_date) — requires "Advance anyway" tap |

Reuse the canonical `<BottomSheet>` primitive for all sheets (per project convention).

---

## 5. API routes

### New

- `GET /api/sessions/recent?limit=6` — admin-only. Returns light session summaries (date, attendance count, total cost, paid %, anomaly codes flagged at advance time).
- `GET /api/admin/anomalies` — admin-only. Computes and returns current anomaly list. No DB writes.
- `GET /api/members/:id/history` — admin-only. Cross-partition query on `players` filtered by `memberId`. Returns sessions list + lifetime aggregates.

### Extended

- `GET /api/session` — response includes `prevSnapshot`, `anomaliesAtAdvance`, `anomaliesDismissed`, `eTransferRecipient` (when set).
- `PATCH /api/session` — accepts `eTransferRecipient` and `anomaliesDismissed`.
- `POST /api/admin/advance` — writes `prevSnapshot` and `anomaliesAtAdvance` (in addition to existing `prevSessionDate`/`prevCostPerPerson`).
- `PATCH /api/members/me` — accepts `eTransferRecipient` and `skipDates`.

### Auth

All admin routes go through `isAdminAuthed(req)` before body parsing, per project convention. Rate limit before auth.

---

## 6. Data flow on command center load

1. Admin opens Admin tab → `<CommandCenter>` mounts.
2. **Parallel fetches** — one per card: `/api/session`, `/api/players?include=removed`, `/api/sessions/recent`, `/api/admin/anomalies`, `/api/birds`, `/api/announcements`.
3. Each card renders independently as its data resolves. No waterfall, no aggregator endpoint.
4. Anomaly feed reads from its dedicated route → can be polled independently if background updates are added later.

---

## 7. Receipt export

### 7.1 Group format (primary)

A single shareable card per session, addressed to the group. Posted once after signups close.

Sample text format:

```
BPM Badminton — Wed, May 13 · 8:00 PM

  $9 / person

3 courts · 12 players · $108 total

E-transfer to: xyzou2012@gmail.com
Memo: BPM May 13 - {your name}

Players this week:
Daisy, Mei, Ken, Sam, ...
```

**No paid status on the public version** — sensitive, stays on the admin dashboard.

### 7.2 Individual format (secondary)

Per-player nudge for laggards. Same template engine; recipient is a single player. Toggle within `<ReceiptSheet>`.

### 7.3 Image rendering

- Client-side canvas. 390×520 portrait.
- Fonts: Space Grotesk (amount), IBM Plex Sans (body), JetBrains Mono (email).
- `await document.fonts.ready` before draw to avoid font-load races.
- Web Share API where supported → falls back to PNG download.

### 7.4 Text rendering

Plain template, copyable via Clipboard API. Lives in code, not DB — wording iterates without migration.

### 7.5 Bulk export

In `<PaymentsCard>`, top-level "Generate group receipt" button. Per-row "Send receipt" buttons for individual format. No "send all at once" (sharing is per-channel and human-paced).

---

## 8. Anomaly feed

### 8.1 Checks (v1)

| Code | Severity | Trigger | Message |
|---|---|---|---|
| `settings_drift` | warning | court count, cost-per-court, or max players differs from `prevSnapshot` | "Cost is $X this week, was $Y last week. Confirm?" |
| `skip_date` | blocking | active session date matches a `members.skipDates` entry | "May 20 is on your skip list. Did you mean to advance?" |
| `long_break` | warning | gap between previous session date and current session date exceeds **21 days** | "It's been N days since the last session. Settings might be stale." |

### 8.2 Severity → behavior

- **info** — chip only (none in v1)
- **warning** — chip + feed row, dismissable, doesn't block any action
- **blocking** — `<BottomSheet>` on advance, requires explicit "Advance anyway" tap

### 8.3 Dismissal state

`session.anomaliesDismissed: string[]`. Per-session — new session resets dismissals. Why: dismissing "settings drift" on May 13 should not silence it on May 20.

### 8.4 Where it renders

- **Inline chips** on `<NextSessionCard>` — high-severity items only, max 3.
- **Anomaly feed card** — collapsed when empty, expanded when populated. Each row: message, dismiss button, action affordance ("Adjust cost →" deep-links to session edit).

### 8.5 Skip-date management

`<SkipDateInlineEditor>` — small inline card on command center. Admin adds/removes YYYY-MM-DD entries. PATCH `/api/members/me { skipDates: [...] }`.

---

## 9. Demo / fixture support (in scope)

Two cheap additions to make the command center demo-able and QA-able without manual data setup:

### 9.1 Fixture script

`scripts/seed-command-center-demo.ts` — populates the local mock store (or a configured demo Cosmos container) with realistic state:
- 8 archived sessions
- 15 players with varied attendance histories
- Mixed payment statuses (paid, pending, overdue)
- A few anomalies pre-baked (one settings drift, one long break)
- Bird usage history across the 8 sessions

Runnable via `npm run seed:command-center-demo`.

### 9.2 `?dev` panel extensions

Existing `?dev` URL flag already overrides UI state. Add command-center-specific toggles:
- "Force settings_drift anomaly"
- "Force long_break anomaly"
- "Force unpaid players to N"
- "Force receipt sheet open"

These manipulate **client-side rendered state only** — never touch the DB. Lets you smoke-test UI without setting up real conditions.

### Out of scope for this spec

A runtime DB toggle ("switch live app from real DB to dummy data") is **explicitly deferred**. Two reasons:
1. The demo + fixture additions above probably solve 80% of the actual pain.
2. A runtime toggle has real security weight (could route real signups into dummy storage if misconfigured) and deserves its own brainstorm.

---

## 10. Risks

1. **memberId backfill collision.** Two distinct people sharing a name. *Mitigation:* script halts and lists for manual review before proceeding.
2. **Cross-partition history query latency.** At current scale (~5K player records) fan-out is fine. *Mitigation:* if usage grows 10×, add `members.lifetimeStats` cache. Flagged as YAGNI with clear escape hatch.
3. **bpm-stable / bpm-next schema co-existence.** Every change is additive + optional. Verified against the schema rule. Stable readers ignore new fields; next readers tolerate absence.
4. **Receipt rendering on older mobile browsers.** Canvas font loading can race. *Mitigation:* `document.fonts.ready` await before draw.
5. **Anomaly feed read-time computation.** If dashboard load grows expensive, this is the place that'll show first. *Mitigation:* anomaly call is independent of other cards (parallel fetch).

---

## 11. Testing

Following project conventions: vitest, mock store, jsdom env per file, `NextIntlClientProvider` wrapper for component tests, unique IPs per test via `X-Client-IP`.

### API tests
- `/api/sessions/recent` — auth, limit param, response shape, removed-flag handling.
- `/api/admin/anomalies` — each anomaly code triggered by fixture, dismissal state respected, severity returned correctly.
- `/api/members/:id/history` — memberId path, name+alias fallback path, cross-session aggregation.
- Extended `/api/session` PATCH — `eTransferRecipient` and `anomaliesDismissed` validation.
- Extended `/api/admin/advance` — `prevSnapshot` and `anomaliesAtAdvance` written correctly.

### Backfill script tests
- Idempotency (re-run produces no further writes).
- Collision detection (halts cleanly).
- Dry-run mode (no writes).

### Component tests (jsdom)
- `<NextSessionCard>` — anomaly chips render, deadline countdown, signup-open state.
- `<PaymentsCard>` — grid, receipt buttons, group export.
- `<AnomalyFeed>` — collapse/expand, dismissal flow, blocking sheet on advance.
- `<PlayerProfileSheet>` — history rendering, lifetime totals.
- `<ReceiptSheet>` — group + individual format toggle, share/copy buttons (mocked Web Share API).

### Receipt format
- Text format snapshotted for both group and individual variants.
- Image format tested via canvas mock — verify `drawText`/`fillRect` call sequence, not pixel diff.

### i18n parity
- Both EN and ZH covered in canary-strings test.

### Manual smoke checklist (in spec)
- Mobile (Web Share API): iOS Safari, Chrome Android.
- Light + dark mode.
- Group + individual receipt formats.
- Each anomaly code rendering correctly.
- Backfill dry-run output verified before live run.

---

## 12. Open research items (must resolve before implementation)

- **OPEN-RESEARCH-1**: e-transfer memo character constraints across TD, RBC, BMO, Scotiabank, CIBC. Determines default memo template.
- **OPEN-RESEARCH-2**: Web Share API support matrix (iOS Safari, Chrome Android). Confirms fallback strategy.

---

## 13. Phasing notes (informational — for the implementation plan)

Logical build order, not binding on the plan:

1. **Data plumbing PR** — schema additions, write-path changes, backfill script. No UI changes. Ships first.
2. **Run backfill** in dev → next → stable.
3. **Anomaly evaluation + API routes** — `/api/admin/anomalies`, `/api/sessions/recent`, `/api/members/:id/history`. No UI yet.
4. **Command center cards** — Next Session, Payments, Anomaly Feed, Bird Inventory, Roster Health, Recent Sessions. Replaces AdminDashboard.
5. **Receipt export** — `<ReceiptSheet>`, group + individual rendering.
6. **Player profile sheet** — drill-in from any player name.
7. **Skip-date editor + blocking anomaly sheet** — last because lowest urgency.
8. **Demo fixture script + `?dev` panel toggles** — alongside or after step 4 (whenever QA workflow demands it).

This sequence keeps every PR small, lets each ship to bpm-next independently, and means the bpm-stable promotion is a pull of N consecutive merges rather than one big bang.
