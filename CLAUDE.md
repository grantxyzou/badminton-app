# CLAUDE.md — Badminton Session Manager

## Purpose

A mobile-first web app for managing casual weekly badminton sessions. Players sign up for a session (or join a waitlist when full), and an admin manages session details, player lists, payment tracking, announcements, and AI-polished announcements. Built for a single recurring group ("BPM Badminton"), deployed on Azure App Service Free tier at `/bpm`. Sessions are now date-keyed and archived — the admin can advance to a new session each week while historical sessions remain queryable.

---

## Quick Start

```bash
npm install
# Copy .env.local.example to .env.local and fill in values
npm run dev
# → http://localhost:3000/bpm
```

When `COSMOS_CONNECTION_STRING` is absent, the app uses an in-memory mock store — all routes work offline without a real database.

---

## Tech Stack

| Layer | Technology | Version |
|---|---|---|
| Framework | Next.js (App Router) | ^16.2.1 |
| Language | TypeScript (`strict: true`) | ^5 |
| Styling | Tailwind CSS + custom CSS classes in `globals.css` | ^3.3.0 |
| Database | Azure Cosmos DB (NoSQL) via `@azure/cosmos` | ^4.2.0 |
| AI | Anthropic Claude (`claude-sonnet-4-20250514`) via `@anthropic-ai/sdk` | ^0.36.3 |
| Icons | Google Material Icons (loaded via `<link>` in `<head>`) | — |
| Deployment | Azure App Service (Canada Central, Free F1 tier) | — |
| CI/CD | GitHub Actions with OIDC (no long-lived secrets) | — |

---

## Project Structure

```
app/
  api/
    admin/route.ts            GET (auth check) · POST (PIN verify) · DELETE (logout)
    aliases/route.ts          GET · POST · PATCH · DELETE — admin-only e-transfer alias management
    announcements/route.ts    GET · POST · PATCH · DELETE
    claude/route.ts           POST — admin-only AI proxy (rate-limited)
    players/route.ts          GET · POST · PATCH · DELETE — supports sessionId param for history
    session/route.ts          GET · PUT (admin only)
    session/advance/route.ts  POST (admin only) — create next session and archive current
    sessions/route.ts         GET (admin only) — list all archived sessions
  globals.css                 All shared CSS classes and design tokens
  layout.tsx                  Root layout — aurora background blobs, Material Icons link
  page.tsx                    Root page — tab state, renders HomeTab/PlayersTab/AdminTab

components/
  AdminTab.tsx                PIN gate → AdminPanel → SessionEditor / MembersPanel / AdminPlayersPanel / AnnouncementsPanel
  BottomNav.tsx               Fixed bottom nav (Home, Sign-Ups, Admin)
  DatePicker.tsx              Custom calendar date picker, portal-rendered
  GlassPhysics.tsx            Mouse-tracking CSS var updater (--mx, --my) for glass card hover effect
  HomeTab.tsx                 7-state sign-up card + session info + announcement display
  PlayersTab.tsx              Active player list + waitlist card; self-cancel flow

lib/
  auth.ts                     HTTP-only cookie helpers: setAdminCookie, clearAdminCookie, isAdminAuthed
  cosmos.ts                   DB client + session pointer helpers + in-memory mock + DEFAULT_SESSION
  formatters.ts               fmtDate(iso) — locale-aware long date string
  rateLimit.ts                In-memory rate limiter + getClientIp (reads X-Client-IP for Azure)
  types.ts                    Session, Player, Alias, Announcement interfaces

next.config.js                basePath /bpm, output standalone, security headers
tailwind.config.js            Extends colors: court (#4ade80), forest-900, forest-800
tsconfig.json                 strict mode, @/* path alias → project root
.github/workflows/
  main_badminton-app.yml      Build → standalone zip → OIDC login → Azure deploy
```

---

## Architecture Overview

### Request Lifecycle

All page navigation is client-side (single-page app). `app/page.tsx` is the only route rendered by the browser — it holds tab state and conditionally renders `<HomeTab>`, `<PlayersTab>`, or `<AdminTab>`. The bottom nav switches tabs with no page reload.

Data fetches hit Next.js API routes (all under `app/api/`). Every fetch uses `{ cache: 'no-store' }` to prevent stale reads.

### Auth Flow

1. `AdminTab` mounts → `GET /api/admin` → server checks for `admin_session` HTTP-only cookie → returns `{ authed: true/false }`.
2. If not authed, PIN form is shown. `POST /api/admin` with `{ pin }` → server uses `timingSafeEqual` to compare against `ADMIN_PIN` env var → on success sets cookie (SHA-256 of `badminton-admin:<PIN>`, 8-hour TTL, HttpOnly, SameSite=Strict, Secure in production).
3. All admin API routes call `isAdminAuthed(req)` which reads the cookie and validates with `timingSafeEqual`.
4. Logout: `DELETE /api/admin` clears the cookie.
5. Player self-cancel uses a `deleteToken` returned once at sign-up and stored in `localStorage`. The token (random 16 bytes hex) is validated server-side on `DELETE /api/players`.

### Session Pointer Architecture

Sessions are now date-keyed rather than using a single hard-coded `'current-session'` ID. The `sessions` container stores:

- **Session documents** — identified by `session-YYYY-MM-DD` (derived from the session's `datetime` field via `sessionIdFromDate()`).
- **A pointer document** — `id = 'active-session-pointer'` — which stores `{ activeSessionId }` pointing to the currently active session.

`getActiveSessionId()` reads the pointer document and falls back to `'current-session'` for backward compatibility with existing production data. `setActiveSessionId()` updates the pointer.

`POST /api/session/advance` creates a new date-keyed session, copies `approvedNames` from the current session, sets `signupOpen: false` on the new session, and atomically updates the pointer. The old session is archived (not deleted).

`GET /api/sessions` returns all non-pointer, non-legacy sessions ordered by ID descending — used for the session history navigator in `AdminPlayersPanel`.

The constant `SESSION_ID = 'current-session'` remains in `lib/cosmos.ts` for legacy compatibility but should not be used in new code — use `getActiveSessionId()` instead.

### Data Flow

```
Cosmos DB (4 containers: sessions, players, announcements, aliases)
  ↓ getContainer(name)              ← lib/cosmos.ts
  ↓ API route handlers              ← app/api/*/route.ts
  ↓ JSON over fetch                 ← components (client)
```

### Approved Names / Invite List Gating

`Session.approvedNames` is an array of strings stored on the session document. When non-empty, `POST /api/players` enforces that the submitted name must case-insensitively match a name in the list; otherwise it returns 403 with the message `'hmmmm... please use the name we know you by'`. Admins bypass this check. The `HomeTab` sign-up form shows autocomplete suggestions from `approvedNames` when the user starts typing.

### Sign-Up Open/Closed Toggle

`Session.signupOpen` (boolean) controls whether non-admin sign-ups are accepted. When `signupOpen === false`, `POST /api/players` returns 403 with `'Sign-ups are not open yet'`. The `HomeTab` shows a "Sign-ups opening soon" state when `signupOpen === false` and the user is not already signed up. Admins bypass this check and can always add players.

### Session Finished State

If `session.endDatetime` is set and the current time is past it, `HomeTab` shows a "Thanks for playing!" state. This is a client-side time check only — no server-side enforcement.

### Deadline Enforcement

`POST /api/players` checks `session.deadline` server-side and returns 403 if the deadline has passed. `HomeTab` also checks client-side to show the correct UI state, but the server check is authoritative.

### Soft Delete Pattern

Players are never hard-deleted by default. `DELETE /api/players` (individual) upserts the record with `{ removed: true, removedAt, cancelledBySelf }`. GET queries exclude `removed = true` records by default; `?all=true` (admin cookie required) includes them. Admins can restore removed players via `PATCH { id, removed: false }` — capacity-checked.

### Waitlist Pattern

When the session is full and the client sends `POST { waitlist: true }`, the player is created with `waitlisted: true`. Waitlisted players do not count toward `maxPlayers`. Admins promote via `PATCH { id, waitlisted: false }` — capacity-checked. Self-cancel works identically for waitlisted players.

---

## Data Models

### `Session` (`lib/types.ts`)

```typescript
interface Session {
  id: string;               // 'session-YYYY-MM-DD' (new) or 'current-session' (legacy)
  sessionId?: string;       // same as id, set by PUT handler for Cosmos partition key
  title: string;            // display title, max 100 chars
  locationName?: string;    // venue name, max 200 chars
  locationAddress?: string; // street address, max 300 chars — rendered as Google Maps link
  datetime: string;         // ISO 8601 with local timezone offset (set by admin's browser)
  endDatetime?: string;     // optional — when past this, HomeTab shows "Thanks for playing!"
  deadline: string;         // ISO 8601 — after this, POST /api/players returns 403
  courts: number;           // 1–20
  maxPlayers: number;       // 1–100 (default 12)
  signupOpen?: boolean;     // false = sign-ups closed; absent/true = open
  approvedNames?: string[]; // invite list — empty = anyone can sign up; max 500 entries
}
```

`DEFAULT_SESSION` in `lib/cosmos.ts` is returned when no session record exists in the DB. It sets `datetime` to +7 days and `endDatetime` to +7 days + 2 hours.

The pointer document in the `sessions` container has shape `{ id: 'active-session-pointer', sessionId: 'active-session-pointer', activeSessionId: string }` and is excluded from all session list queries using `c.id != @pointerId`.

### `Player` (`lib/types.ts`)

```typescript
interface Player {
  id: string;                // randomBytes(12).toString('hex')
  name: string;              // trimmed, max 50 chars, case-insensitive dedup
  sessionId: string;         // date-keyed session ID, e.g. 'session-2025-04-05'
  timestamp: string;         // ISO 8601 sign-up time (updated on restore)
  paid?: boolean;            // false by default; toggled by admin
  waitlisted?: boolean;      // true = on waitlist; absent/false = active
  removed?: boolean;         // true = soft-deleted
  removedAt?: string;        // ISO 8601 time of removal
  cancelledBySelf?: boolean; // true = player cancelled; false = admin removed
  deleteToken?: string;      // DB-only — NEVER sent to clients (stripped in all GETs)
}
```

### `Alias` (`lib/types.ts`)

```typescript
interface Alias {
  id: string;            // randomBytes(12).toString('hex')
  appName: string;       // name used in the app (e.g. "Jon") — max 50 chars
  etransferName: string; // full e-transfer name (e.g. "Jonathan Smith") — max 50 chars
}
```

Aliases live in their own `aliases` container (no `sessionId` — they are global, not session-scoped). Used in CSV export to map app name → e-transfer name for payment tracking.

### `Announcement` (`lib/types.ts`)

```typescript
interface Announcement {
  id: string;        // randomBytes(12).toString('hex')
  text: string;      // max 500 chars
  time: string;      // ISO 8601 creation time
  editedAt?: string; // ISO 8601 — set when announcement is edited via PATCH
  sessionId: string; // date-keyed session ID
}
```

---

## API Routes

### `GET /api/session`
- Auth: none
- Response: active `Session` object (determined by pointer), or `DEFAULT_SESSION` if no DB record

### `PUT /api/session`
- Auth: admin cookie required
- Body: `{ title, locationName, locationAddress, datetime, endDatetime, deadline, courts, maxPlayers, signupOpen?, approvedNames? }`
- Notes: `datetime`, `endDatetime`, `deadline` validated via `Date.parse`. `endDatetime` is optional — omit or send `''` to clear it. `approvedNames` is an array of strings (max 500 entries). `signupOpen` is an optional boolean.
- Response: saved `Session` object

### `POST /api/session/advance`
- Auth: admin cookie required
- Body: `{ datetime, endDatetime?, deadline, courts, maxPlayers, title?, locationName?, locationAddress? }`
- Derives new session ID from `datetime` via `sessionIdFromDate()` (format: `session-YYYY-MM-DD`)
- Returns 409 if a session with that derived ID is already active
- Creates new session document with `signupOpen: false` and copies `approvedNames` from the current session
- Updates the active-session pointer via `setActiveSessionId()`
- Response: new `Session` object, status 201

### `GET /api/sessions`
- Auth: admin cookie required
- Response: `Session[]` — all sessions excluding the pointer document and the legacy `'current-session'` document, ordered by ID descending (newest first)
- Used by `AdminPlayersPanel` for the session history navigator

### `GET /api/players`
- Auth: none (admin cookie enables `?all=true` and `?sessionId=`)
- Query params:
  - `?all=true` — include soft-deleted records (admin only; ignored without auth)
  - `?sessionId=session-YYYY-MM-DD` — view players for a specific session (admin only; ignored without auth)
- Response: `Player[]` with `deleteToken` stripped, ordered by `timestamp ASC`
- Returns both active (`waitlisted` false/absent) and waitlisted players; clients split by `p.waitlisted`

### `POST /api/players`
- Auth: none (rate-limited: 10 req/min/IP)
- Body: `{ name: string, waitlist?: boolean }`
- Returns 400 if name empty or >50 chars
- Returns 403 if `session.signupOpen === false` (non-admin)
- Returns 403 if current time is past `session.deadline` (non-admin)
- Returns 403 if `approvedNames` is non-empty and name doesn't match (non-admin) — message: `'hmmmm... please use the name we know you by'`
- Returns 409 if name already active (`'Already signed up'`) or session full without `waitlist: true`
- If a soft-deleted record with the same name exists, it is restored (new `deleteToken`, `paid` reset to false)
- Response: `Player` object + `deleteToken` (one-time, for self-cancel)
- Status 201 on success

### `PATCH /api/players`
- Auth: admin cookie required
- Body: `{ id: string, sessionId?: string, paid?: boolean, removed?: boolean, waitlisted?: boolean }`
- `sessionId` in body selects which session's player to update (defaults to active session if absent)
- Capacity-checked when `removed: false` (restore) or `waitlisted: false` (promote) — returns 409 if full
- `deleteToken` is stripped from the response

### `DELETE /api/players`
- Auth: admin cookie OR `deleteToken` for individual cancel (rate-limited: 10 req/min/IP)
- Body variants:
  - `{ name, deleteToken?, sessionId? }` — soft-delete one player; requires admin OR matching `deleteToken`; `sessionId` is admin-only
  - `{ clearAll: true }` — admin: soft-delete all active players for the active session
  - `{ purgeAll: true }` — admin: hard-delete every record for the active session (irreversible)

### `GET /api/admin`
- Auth: none
- Response: `{ authed: boolean }`

### `POST /api/admin`
- Auth: none (rate-limited: 5 req/15 min/IP)
- Body: `{ pin: string }` (max 20 chars)
- Sets `admin_session` HTTP-only cookie on success
- Response: `{ success: true }` or 401

### `DELETE /api/admin`
- Auth: admin cookie required
- Clears the `admin_session` cookie

### `GET /api/announcements`
- Auth: none
- Response: `Announcement[]` ordered by `time DESC` (scoped to active session)

### `POST /api/announcements`
- Auth: admin cookie required
- Body: `{ text: string }` (max 500 chars)
- Status 201 on success

### `PATCH /api/announcements`
- Auth: admin cookie required
- Body: `{ id: string, text: string }` (max 500 chars)
- Sets `editedAt` on the record
- Response: updated `Announcement` object

### `DELETE /api/announcements`
- Auth: admin cookie required
- Body: `{ id: string }`

### `GET /api/aliases`
- Auth: admin cookie required
- Response: `Alias[]` ordered by `appName ASC`

### `POST /api/aliases`
- Auth: admin cookie required
- Body: `{ appName: string, etransferName: string }` (each max 50 chars)
- Status 201 on success

### `PATCH /api/aliases`
- Auth: admin cookie required
- Body: `{ id: string, appName?: string, etransferName?: string }`

### `DELETE /api/aliases`
- Auth: admin cookie required
- Body: `{ id: string }`

### `POST /api/claude`
- Auth: admin cookie required (rate-limited: 10 req/min/IP)
- Body: `{ prompt: string }` (max 4000 chars)
- Proxies to Anthropic `claude-sonnet-4-20250514`, max_tokens 1024
- Response: `{ text: string }`

---

## Component Guide

### `page.tsx`
Root client component. Holds `activeTab: 'home' | 'players' | 'admin'` state. Renders one tab at a time. Also renders `<GlassPhysics />` (mouse tracker) and `<BottomNav />`. Passes `setActiveTab` down to `<HomeTab>` as `onTabChange` so "View Sign Up List" can navigate to the Sign-Ups tab.

### `HomeTab.tsx`
Fetches session, players, and announcements in parallel on mount. Reads `badminton_username` and `badminton_deletetoken` from `localStorage` to identify the current user. Shows only the most recent announcement (`list[0]`).

**Seven sign-up states** rendered inside the "Sign up" glass card (evaluated in priority order):

| State | Condition | UI |
|---|---|---|
| Session finished | `endDatetime` set and past | Green "Thanks for playing!" banner |
| Sign-ups opening soon | `signupOpen === false` AND not signed up/waitlisted | Orange "Sign-ups opening soon" banner |
| Deadline passed | `deadline` past AND not signed up/waitlisted | Orange "Sign-ups closed" banner |
| Signed up (active) | Name matches active player | Green "thank you for signing up!" banner + spot counter + "View Sign Up List" button |
| Waitlisted | Name matches waitlisted player | Orange "You're on the waitlist" banner + position number |
| Full (join waitlist) | Active count >= maxPlayers AND deadline not past | Orange "Session Full" banner + "Join Waitlist" form |
| Open | Default | Sign-up form + spot counter + deadline reminder |

The sign-up and waitlist forms show an autocomplete dropdown from `session.approvedNames` when `approvedNames` is non-empty and the user starts typing. Dropdown uses absolute positioning (no portal).

The address link renders as `text-sm text-gray-300` with `underline underline-offset-2 decoration-dotted` linking to Google Maps.

### `PlayersTab.tsx`
Lists active players in one `glass-card` (header is game date formatted as a `section-label`), waitlisted players in a second card with `list-header-amber`. No court SVG in either card. Current user row highlighted with `.player-highlight-green` (active) or `.player-highlight-amber` (waitlist). Active player cancel button says "Cancel"; waitlist cancel says "Leave". Self-cancel requires `deleteToken` from `localStorage`.

### `AdminTab.tsx`
Four sub-panels behind a PIN gate, selected via an Apple HIG segment control with four tabs:

**Segment tabs: `Session | Members | Sign Up | Posts`**

#### `SessionEditor` (Session tab)
Three separate form cards:

1. **BADMINTON DETAILS** — Venue Name, Address, Courts, Max Players, Sign-ups toggle (iOS-style switch; green = open, saves `signupOpen` boolean). Save button enabled only when those fields are dirty vs. the loaded state.

2. **DATE & TIME** — Session start (DatePicker + time input), Sign-up Deadline (DatePicker + time input), Session End (DatePicker + time input). Save button enabled only when date fields are dirty.

3. **NEXT WEEK'S SESSION** — Full form for creating a new session (date/time/deadline/end/courts/maxPlayers). Posts to `POST /api/session/advance`. On success, reloads the current session form. New session always starts with `signupOpen: false`.

`withLocalTz(date, time)` (defined inside `SessionEditor`) builds timezone-aware ISO strings from the admin's browser timezone offset before all saves.

#### `MembersPanel` (Members tab)
Two sections rendered as separate cards:

1. **APPROVED NAMES** — Editable invite list stored as `session.approvedNames`. Add by typing and pressing Enter or clicking Add (case-insensitive dedup). Remove with × button. Saves via `PUT /api/session`. When the list is empty, anyone can sign up.

2. **AliasesPanel** (inline sub-component) — Maps each player's app name to their e-transfer name for payment tracking. Full CRUD: add via two-field form, edit inline by clicking name/etransfer fields, delete. Calls `GET/POST/PATCH/DELETE /api/aliases`. Aliases are global — no session scope.

#### `AdminPlayersPanel` (Sign Up tab)
- **Session history navigator**: shown when `allSessions.length > 1`. Prev/next arrow buttons navigate through archived sessions. Displays the viewed session's date and a "Current session" / "Past session" label. Navigating calls `loadPlayers(sessionIdOverride)` which passes `?sessionId=` to the API.
- **Add player form**: adds to the active session only. Admin cookie bypasses `signupOpen`, `deadline`, and `approvedNames` checks server-side.
- **Active players list** with paid/unpaid pill toggle (`.pill-paid` / `.pill-unpaid`), confirm-before-remove, count + session date label (`fmtSessionLabel`), and "Download Spreadsheet" button.
- **Waitlisted players card** with Promote button (capacity-checked, returns 409 if full).
- **Removed players card** (collapsible) showing "Cancelled" vs "Removed" based on `cancelledBySelf`, ordered by `removedAt` descending. Restore button (capacity-checked).
- **Clear / Purge triggers**: "Clear session" (soft-deletes all active players) and "Purge all records" (hard-deletes all records). Both open a confirmation action-sheet portal (`createPortal`) with explicit counts.

When viewing a past session via the history navigator, PATCH and DELETE bodies include `{ sessionId: viewedSessionId }`.

CSV export (`handleExportCSV`) columns: `#, Name, E-Transfer Name, Waitlisted, Signed Up, Paid`. Includes both active and waitlisted players. `E-Transfer Name` resolved from the `aliases` array loaded alongside players.

#### `AnnouncementsPanel` (Posts tab)
Draft textarea → "Improve with AI" (`POST /api/claude`) → "Post to Home" (`POST /api/announcements`). Can post draft directly without AI polish. Lists existing announcements with inline edit (PATCH, sets `editedAt`) and delete. Edited announcements show a "· edited" indicator.

### `BottomNav.tsx`
Fixed bottom nav with three tabs: Home (`home`), Sign-Ups (`group`), Admin (`admin_panel_settings`). Active tab uses `.nav-tab-active` and inline `color: #4ade80`. Tab label is "Sign-Ups" (not "Players").

### `DatePicker.tsx`
Custom calendar picker. Portal-rendered at `document.body` (escapes `backdrop-filter` stacking contexts). Minimum calendar width 280px. Positions via `getBoundingClientRect()` and repositions on scroll. Accepts and returns `YYYY-MM-DD` strings. The trigger button matches global `input` height (42px).

### `GlassPhysics.tsx`
Renders nothing. On mount, listens to `mousemove` and updates CSS custom properties `--mx` and `--my` on `:root` (0.0–1.0 normalized coordinates). These drive the radial gradient in `.glass-card` for a physics-like highlight effect. Uses `requestAnimationFrame` throttling.

---

## Coding Conventions

### File and Component Naming
- Files: PascalCase for components (`AdminTab.tsx`), camelCase for lib (`cosmos.ts`, `formatters.ts`)
- Components: default export, named after file
- API routes: `export async function GET/POST/PATCH/DELETE(req: NextRequest)`

### CSS / Styling Rules
- Use named CSS classes from `globals.css` rather than inline styles for shared patterns
- Inline styles are acceptable only for one-off values (e.g., `fontSize: '13.333px'` on segment tabs, `height: '42px'` on time inputs)
- Do NOT add hard divider lines between list items — use `divide-y` with `borderColor: rgba(255,255,255,0.05)` or no divider at all (glass design principle)
- New shared patterns belong in `globals.css`, not duplicated inline across components

**Key CSS classes:**

| Class | Purpose |
|---|---|
| `.glass-card` | Primary surface; use for all cards. Mouse-reactive radial gradient via `--mx`/`--my` |
| `.btn-primary` | Green CTA button |
| `.btn-ghost` | Secondary/outline button |
| `.section-label` | `text-xs font-bold tracking-widest uppercase text-green-400` |
| `.section-label-muted` | Same but `text-gray-500` — for less prominent labels |
| `.list-header-green` | Tinted row header for active lists |
| `.list-header-amber` | Tinted row header for waitlist/cancelled lists |
| `.segment-control` | Apple HIG pill segment wrapper (32px height, border-radius 100px, 2px padding) |
| `.segment-tab-active` | Active segment tab (green tint, font-weight 590) |
| `.segment-tab-inactive` | Inactive segment tab (font-weight 510) |
| `.player-highlight-green` | Subtle green row background for current user (active) |
| `.player-highlight-amber` | Subtle amber row background for current user (waitlist) |
| `.pill-paid` | Green payment pill |
| `.pill-unpaid` | Muted unpaid pill |
| `.inner-card` | Nested content block (white tint) |
| `.inner-card-green` | Nested content block (green tint) — used for AI output |
| `.icon-xs/sm/md/lg/xl` | 13/16/18/24/40px icon sizes |
| `.icon-status` | 22px icon inside status banners |
| `.icon-spin-lg` | 32px spinning loading icon |
| `.status-banner-green` | "You're in" / success banner |
| `.status-banner-orange` | "Session Full" / warning banner |
| `.nav-glass` | Bottom nav bar glass surface |
| `.nav-tab-active` | Active bottom nav tab pill |

### ID Generation
All IDs use `randomBytes` from Node.js `crypto`:
- Player IDs: `randomBytes(12).toString('hex')` (24 hex chars)
- Delete tokens: `randomBytes(16).toString('hex')` (32 hex chars)
- Announcement IDs: `randomBytes(12).toString('hex')` (24 hex chars)
- Alias IDs: `randomBytes(12).toString('hex')` (24 hex chars)

### Datetime Handling
- All datetimes stored as ISO 8601 strings with the admin's local timezone offset embedded (e.g. `2025-04-05T14:00:00+11:00`). This ensures correct display for all users regardless of server timezone.
- `withLocalTz(date, time)` in `SessionEditor` builds the timezone-aware string from the form's date+time inputs.
- `fmtDate(iso)` in `lib/formatters.ts` formats using `toLocaleDateString` with `weekday: 'long', month: 'long', day: 'numeric'`.
- `fmtSessionLabel(datetime)` in `AdminTab.tsx` returns `'TODAY'`, weekday name, or `'MAR 29'` format for the active players panel header.
- `fmtSessionNav(datetime)` in `AdminPlayersPanel` returns short format (e.g. `'Sat, Apr 5'`) for the history navigator.

### Session ID Conventions
- New sessions: `sessionIdFromDate(isoDatetime)` → `'session-YYYY-MM-DD'` (takes `isoDatetime.slice(0, 10)`, prefixed with `'session-'`)
- Legacy session: `'current-session'` — only exists in production data predating the advance feature
- Pointer document: `id = 'active-session-pointer'` — always excluded from session list queries via `c.id != @pointerId`

### Cosmos DB Access
- Always use `getContainer(name)` from `lib/cosmos.ts` — never instantiate `CosmosClient` directly
- Always filter by `sessionId = @sessionId` in every query on `players` and `announcements` containers
- Partition key on the `players` container is the `sessionId` value (used in `container.item(id, sessionId)`)
- The `aliases` container has no `sessionId` — aliases are global
- The `sessions` container partition key is the document `id`

### Error Handling
- API routes: always return `NextResponse.json({ error: string }, { status: NNN })`
- Client components: inline error text as `<p className="text-red-400 text-xs">` immediately below the relevant control
- ARIA: error paragraphs have `role="alert"` and `id` matching `aria-describedby` on the input

### localStorage Keys
- `badminton_username` — player's display name
- `badminton_deletetoken` — player's self-cancel token (cleared on cancel)

---

## Security Rules

1. **`deleteToken` must never appear in GET responses.** It is stripped in `GET /api/players` before returning. After any PATCH that touches the `players` container, destructure out `deleteToken` before returning: `const { deleteToken: _dt, ...safe } = updated`.
2. **Admin cookie comparison must use `timingSafeEqual`.** Never use `===` to compare PINs or cookie values.
3. **All admin-mutating routes must call `isAdminAuthed(req)` before any DB access.** If the check is skipped, any caller can modify data.
4. **`POST /api/claude` must remain admin-only.** It proxies directly to the Anthropic API — an unauthenticated endpoint would expose the API key's usage budget.
5. **Rate limiting must be applied at the top of the handler, before any logic.** If moved after auth checks, rate limiting can be bypassed.
6. **IP extraction must use `getClientIp(req)`** (reads `X-Client-IP` first, then `X-Forwarded-For`). Do not use `req.ip` — it returns the Azure proxy IP, making rate limits global rather than per-user.
7. **`ADMIN_PIN` must not be absent in production.** `lib/auth.ts` throws if it is absent in production.
8. **Session fields are sanitised server-side.** `PUT /api/session` and `POST /api/session/advance` allow only known fields and enforce length caps and numeric ranges. Do not add fields without sanitising them.
9. **`purgeAll: true` is irreversible.** The action permanently deletes every DB record for the session including soft-deleted ones. The UI shows a confirmation sheet with explicit record counts before executing.
10. **`GET /api/aliases` and all alias-mutating routes require admin auth.** Alias data (e-transfer names) is sensitive payment information.
11. **The `sessionId` override in `GET/PATCH/DELETE /api/players` is gated by `isAdminAuthed`.** Without admin auth, requests always operate on the active session.

---

## Environment Variables

| Variable | Required | Description |
|---|---|---|
| `ADMIN_PIN` | Yes (prod) | PIN for admin access. Must be non-empty in production. Use 8+ chars with letters and numbers. |
| `ANTHROPIC_API_KEY` | Yes | Anthropic API key for `claude-sonnet-4-20250514`. |
| `COSMOS_CONNECTION_STRING` | Yes (prod) | Azure Cosmos DB connection string. If absent, in-memory mock store is used. |
| `COSMOS_DB_NAME` | No | Cosmos database name. Defaults to `'badminton'`. |
| `NEXT_PUBLIC_MAX_PLAYERS` | No | Default max players per session. Defaults to `12`. Baked into client bundle at build time. |
| `NEXT_PUBLIC_BASE_PATH` | No | URL base path prefix. Must match `basePath` in `next.config.js`. Currently `/bpm`. Baked into client bundle at build time — set in `.env.local` for dev and in Azure App Settings for production. |

`NEXT_PUBLIC_*` variables are baked into the client bundle at build time. Changing them requires a rebuild and redeployment.

---

## Deployment

### Automatic (primary path)
Every push to `main` triggers `.github/workflows/main_badminton-app.yml`:
1. Checkout → Node 20 setup → `npm ci`
2. `npm run build` with `NEXT_PUBLIC_BASE_PATH=/bpm` and `NEXT_PUBLIC_MAX_PLAYERS=12`
3. Copy static assets into standalone: `cp -r .next/static .next/standalone/.next/static`
4. Zip the standalone directory → `standalone-deploy.zip`
5. OIDC login to Azure (no long-lived secrets; uses federated credentials)
6. Deploy zip to Azure App Service `badminton-app`, Production slot

All action SHAs are pinned to specific commits for supply chain safety. `workflow_dispatch` trigger is intentionally absent.

### Manual (fallback only)
```bash
rm -rf .next
npm run build
cp -r .next/static .next/standalone/.next/static
cd .next/standalone
zip -r ../../standalone-deploy.zip .
cd ../..
az webapp deploy \
  --resource-group grantzou \
  --name badminton-app \
  --src-path standalone-deploy.zip \
  --type zip
```

### Azure Configuration
- App Service: `badminton-app`, resource group `grantzou`, Canada Central, Free F1 tier
- Live URL: `https://badminton-app-gzendxb6fzefafgm.canadacentral-01.azurewebsites.net/bpm`
- Cosmos DB: database `badminton`, 4 containers (`sessions`, `players`, `announcements`, `aliases`) at 400 RU/s shared throughput
- Runtime env vars (`ADMIN_PIN`, `ANTHROPIC_API_KEY`, `COSMOS_CONNECTION_STRING`, etc.) are set in Azure App Service Application Settings — not in the workflow file.

### Security Headers (applied to all routes via `next.config.js`)
- `X-Frame-Options: DENY`
- `X-Content-Type-Options: nosniff`
- `Referrer-Policy: strict-origin-when-cross-origin`
- `Permissions-Policy: camera=(), microphone=(), geolocation=()`
- `Strict-Transport-Security: max-age=31536000; includeSubDomains`
- CSP: `default-src 'self'`; scripts allow `'unsafe-inline'` (+ `'unsafe-eval'` in dev); styles also allow `fonts.googleapis.com`; fonts also allow `fonts.gstatic.com`; `img-src 'self' data:`; `connect-src 'self'`

---

## Known Constraints and Gotchas

### Session Pointer Backward Compatibility
`getActiveSessionId()` falls back to `'current-session'` if no pointer document exists. This means existing production data (created before the advance feature was added) continues to work. The first time an admin runs "Create Next Session →", the pointer is written and the app transitions to date-keyed sessions. Do not remove this fallback.

### Race Condition on Signup
Capacity check and insert in `POST /api/players` are not atomic. Concurrent signups can exceed `maxPlayers` by 1–2 spots. Fixing properly requires Cosmos DB optimistic concurrency (ETags). Known limitation on the Free tier.

### Rate Limiter is In-Memory
`lib/rateLimit.ts` uses a module-level `Map`. It resets on every cold start and is not shared across multiple server instances. On Free tier Azure (single instance), this is acceptable. Would need Redis for multi-instance.

### Free Tier Cold Starts
First request after ~20 minutes of idle takes 10–20 seconds to wake up. This is an Azure App Service Free tier characteristic — not a bug.

### Single Active Session for Players
Only one session is "active" at a time (determined by the pointer). Players always see only the current active session. Historical sessions are readable by admins via the session history navigator in the Sign Up tab, but not visible to players.

### Aliases Are Not Session-Scoped
The `aliases` container has no `sessionId`. Aliases are global across all sessions. The CSV export uses aliases to map names at export time, so alias changes retroactively affect exported data.

### `NEXT_PUBLIC_BASE_PATH` Must Match `basePath`
`next.config.js` has `basePath: '/bpm'` hard-coded. `NEXT_PUBLIC_BASE_PATH` must be set to `/bpm` in both local `.env.local` and Azure App Settings, or all API fetches will 404.

### `endDatetime` Is Optional
`Session.endDatetime` may be absent in DB records written before this field was added. All client checks must guard with `session?.endDatetime ? ... : false`.

### `signupOpen` Defaults to Open
When `signupOpen` is absent from a session record (legacy data), both server and client treat it as open (`signupOpen !== false` evaluates to `true`). New sessions created via advance always start with `signupOpen: false`.

### Announcements Are Session-Scoped
Announcements are filtered by the active session's ID. When the admin advances to a new session, old announcements are no longer shown to players or in the Posts panel. They remain in the DB but become inaccessible via the UI.

### DatePicker Is a Custom Component
The native `<input type="date">` was replaced with a custom `DatePicker` component because the native picker renders inconsistently across mobile browsers. The `DatePicker` uses `createPortal` to escape `backdrop-filter` stacking contexts — if rendered inline, the calendar dropdown would be clipped behind other blurred elements.

### TeamsTab Does Not Exist
The Teams tab was present in earlier versions but no longer exists. `app/page.tsx` only renders `HomeTab`, `PlayersTab`, and `AdminTab`. The `Tab` type is `'home' | 'players' | 'admin'`.

### `.azure/` Is Gitignored
The `.azure/config` file (local Azure CLI context) is gitignored and must never be committed.

---

## Rules Before Making Any Change

1. **Use `getActiveSessionId()` — not `SESSION_ID` — for all new DB queries.** `SESSION_ID = 'current-session'` is kept only for legacy compatibility. New code must resolve the active session via the pointer.

2. **Every query on `players` and `announcements` must filter by `sessionId`.** Without this filter, queries return or modify records from all sessions.

3. **Never expose `deleteToken` in a response.** After any PATCH or GET that touches the `players` container, destructure out `deleteToken` before returning: `const { deleteToken: _dt, ...safe } = updated`.

4. **Auth before DB.** Any route that mutates data must call `isAdminAuthed(req)` at the very top, before parsing the body or touching the DB.

5. **Rate limit before auth.** Rate limiting must come before auth checks in the handler so it cannot be bypassed by invalid auth attempts.

6. **Capacity-check promotions and restores.** Any PATCH that sets `removed: false` or `waitlisted: false` must query active player count first and return 409 if at capacity — excluding the player being changed from the count.

7. **The `sessionId` override in players routes is admin-only.** Always gate the `?sessionId=` query param and `sessionId` body field with `isAdminAuthed(req)` before using them.

8. **Use `.segment-control` / `.segment-tab-active` / `.segment-tab-inactive` classes for any new segment controls.** Do not recreate the Apple HIG spec inline.

9. **Do not add CSS divider lines between glass card sections.** Use `space-y-*`, padding, and `.list-header-green` / `.list-header-amber` for visual separation.

10. **Use `randomBytes` for all IDs and tokens.** Never use `Math.random()`.

11. **Datetimes must carry timezone offset.** When storing any datetime entered by the admin, run it through `withLocalTz(date, time)` before sending to the API. Plain `YYYY-MM-DDThh:mm:00` strings without a timezone offset will display incorrectly for users in other timezones.

12. **`NEXT_PUBLIC_*` changes require a rebuild.** A runtime change to Azure App Settings alone will not take effect without redeployment.

13. **No TeamsTab.** Do not re-introduce a Teams tab without also adding it to the `Tab` type in `app/page.tsx`, `BottomNav.tsx`, and implementing the component.

14. **New sessions via advance always start with `signupOpen: false`.** The admin must explicitly toggle sign-ups open after creating a new session. Do not change this default.

15. **Test with in-memory mock before touching DB logic.** Remove `COSMOS_CONNECTION_STRING` from `.env.local` to use the mock store. Verify the mock query filters (`@sessionId`, `c.removed != true`, `c.waitlisted != true`, `@name`, `@id`, `@pointerId`) match the real Cosmos query strings in the route handlers.
