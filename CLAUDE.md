# CLAUDE.md — Badminton Session Manager

## Purpose

A mobile-first web app for managing casual weekly badminton sessions. Players sign up for a session (or join a waitlist when full), and an admin manages session details, player lists, payment tracking, announcements, and AI-assisted announcement polishing. Built for a single recurring group ("BPM Badminton"), deployed on Azure App Service Free tier at `/bpm`.

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
    admin/route.ts              GET (auth check) · POST (PIN verify) · DELETE (logout)
    aliases/route.ts            GET · POST · PATCH · DELETE — admin-only alias management
    announcements/route.ts      GET · POST · PATCH · DELETE
    claude/route.ts             POST — admin-only AI proxy (rate-limited)
    players/route.ts            GET · POST · PATCH · DELETE
    session/route.ts            GET · PUT (admin only)
    session/advance/route.ts    POST — admin-only: create new date-keyed session + update pointer
    sessions/route.ts           GET — admin-only: list all historical session records
  globals.css                   All shared CSS classes and design tokens
  layout.tsx                    Root layout — aurora background blobs, Material Icons link
  page.tsx                      Root page — tab state, renders HomeTab/PlayersTab/AdminTab

components/
  AdminTab.tsx                  PIN gate → AdminPanel (4 segments: Session / Players / Posts / Aliases)
  BottomNav.tsx                 Fixed bottom nav (Home, Players, Admin)
  DatePicker.tsx                Custom calendar date picker, portal-rendered
  GlassPhysics.tsx              Mouse-tracking CSS var updater (--mx, --my) for glass card hover effect
  HomeTab.tsx                   7-state sign-up card + session info + announcement display
  PlayersTab.tsx                Active player list + waitlist card; self-cancel flow

lib/
  auth.ts                       HTTP-only cookie helpers: setAdminCookie, clearAdminCookie, isAdminAuthed, unauthorized
  cosmos.ts                     DB client + session pointer helpers + in-memory mock + DEFAULT_SESSION
  formatters.ts                 fmtDate(iso) — locale-aware long date string
  rateLimit.ts                  In-memory rate limiter + getClientIp (reads X-Client-IP for Azure)
  types.ts                      Session, Player, Alias, Announcement interfaces

next.config.js                  basePath /bpm, output standalone, security headers
tailwind.config.js              Extends colors: court (#4ade80), forest-900, forest-800
tsconfig.json                   strict mode, @/* path alias → project root
.github/workflows/
  main_badminton-app.yml        Build → standalone zip → OIDC login → Azure deploy
```

---

## Architecture Overview

### Request Lifecycle

All page navigation is client-side (single-page app). `app/page.tsx` is the only route rendered by the browser — it holds `activeTab: 'home' | 'players' | 'admin'` state and conditionally renders the three tab components. The bottom nav switches tabs with no page reload.

Data fetches hit Next.js API routes (all under `app/api/`). Every fetch uses `{ cache: 'no-store' }` to prevent stale reads.

### Auth Flow

1. `AdminTab` mounts → `GET /api/admin` → server checks for `admin_session` HTTP-only cookie → returns `{ authed: true/false }`.
2. If not authed, PIN form is shown. `POST /api/admin` with `{ pin }` → server uses `timingSafeEqual` to compare against `ADMIN_PIN` env var → on success sets cookie (SHA-256 of `badminton-admin:<PIN>`, 8-hour TTL, HttpOnly, SameSite=Strict, Secure in production).
3. All admin API routes call `isAdminAuthed(req)` which reads the cookie and validates with `timingSafeEqual`.
4. Logout: `DELETE /api/admin` clears the cookie.
5. Player self-cancel uses a `deleteToken` returned once at sign-up and stored in `localStorage`. The token (random 16 bytes hex) is validated server-side on `DELETE /api/players`.

### Session Pointer Model (date-keyed sessions)

Sessions are no longer hard-coded to a single `'current-session'` ID. Instead:

- Each session's ID is derived from its date: `session-YYYY-MM-DD` (via `sessionIdFromDate(isoDatetime)` in `lib/cosmos.ts`).
- A **pointer document** (id = `'active-session-pointer'`, stored in the `sessions` container) holds `{ activeSessionId: 'session-YYYY-MM-DD' }`.
- All route handlers call `getActiveSessionId()` to resolve the current session. It reads the pointer and falls back to `'current-session'` for backward compatibility with legacy data.
- `SESSION_ID = 'current-session'` still exists as a constant for backward compatibility but should not be used in new queries.
- To create a new week: `POST /api/session/advance` creates a new session document and updates the pointer atomically. Past sessions and their player data remain in the DB.

### Data Flow

```
Cosmos DB (4 containers: sessions, players, announcements, aliases)
  ↓ getContainer(name)            ← lib/cosmos.ts
  ↓ API route handlers            ← app/api/*/route.ts
  ↓ JSON over fetch               ← components (client)
```

### Session Finished State

If `session.endDatetime` is set and the current time is past it, `HomeTab` shows a "Thanks for coming!" state. This is a client-side time check only — no server-side enforcement.

### Signup Open/Closed Toggle

`session.signupOpen` is a boolean field. When `signupOpen === false`, `POST /api/players` returns 403 for non-admins and `HomeTab` shows a "Sign-ups not open yet" state. Admins can toggle this independently of the deadline.

### Deadline Enforcement

`POST /api/players` checks `session.deadline` server-side and returns 403 if the deadline has passed. `HomeTab` also checks client-side to show the correct UI state, but the server check is authoritative.

### Approved Names (Allowlist)

`session.approvedNames` is an optional string array stored on the session. When non-empty, `POST /api/players` returns 403 (with message `"hmmmm... please use the name we know you by"`) if the submitted name does not match any approved name (case-insensitive). Admins bypass this check. The sign-up form shows an autocomplete dropdown populated from `session.approvedNames` when the user starts typing.

### Soft Delete Pattern

Players are never hard-deleted by default. `DELETE /api/players` (individual) upserts the record with `{ removed: true, removedAt, cancelledBySelf }`. GET queries exclude `removed = true` records by default; `?all=true` (admin cookie required) includes them. Admins can restore removed players via `PATCH { id, removed: false }` — capacity-checked.

### Waitlist Pattern

When the session is full and the client sends `POST { waitlist: true }`, the player is created with `waitlisted: true`. Waitlisted players do not count toward `maxPlayers`. Admins promote via `PATCH { id, waitlisted: false }` — capacity-checked. Self-cancel works identically for waitlisted players.

### Alias System

Aliases map a player's in-app display name to their e-transfer name, stored in a separate `aliases` container (not scoped to a session — global across all sessions). Used exclusively in the admin CSV export to populate an "E-Transfer Name" column. Admin-only CRUD via `/api/aliases`.

---

## Data Models

### `Session` (`lib/types.ts`)

```typescript
interface Session {
  id: string;               // 'session-YYYY-MM-DD' (or legacy 'current-session')
  sessionId?: string;       // same as id, set by PUT/advance handlers for Cosmos partition key
  title: string;            // display title, max 100 chars
  locationName?: string;    // venue name, max 200 chars
  locationAddress?: string; // street address, max 300 chars — rendered as Google Maps link
  datetime: string;         // ISO 8601 with local timezone offset (set by admin's browser)
  endDatetime?: string;     // optional — when past this, HomeTab shows "Thanks for coming!"
  deadline: string;         // ISO 8601 — after this, POST /api/players returns 403
  courts: number;           // 1–20
  maxPlayers: number;       // 1–100 (default 12)
  signupOpen?: boolean;     // false = block sign-ups regardless of deadline; absent/true = open
  approvedNames?: string[]; // allowlist of names; empty/absent = anyone can sign up; max 500 entries
}
```

`DEFAULT_SESSION` in `lib/cosmos.ts` is returned when no session record exists in the DB. It sets `datetime` to +7 days, `endDatetime` to +7 days + 2 hours, and `deadline` to +5 days.

The **pointer document** in the `sessions` container:
```
{ id: 'active-session-pointer', sessionId: 'active-session-pointer', activeSessionId: 'session-YYYY-MM-DD' }
```

### `Player` (`lib/types.ts`)

```typescript
interface Player {
  id: string;                // randomBytes(12).toString('hex') — 24 hex chars
  name: string;              // trimmed, max 50 chars, case-insensitive dedup
  sessionId: string;         // 'session-YYYY-MM-DD' (scoped to active session)
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
  id: string;           // randomBytes(12).toString('hex') — 24 hex chars
  appName: string;      // name as used in this app (max 50 chars)
  etransferName: string; // name used for e-transfer payments (max 50 chars)
}
```

Aliases are NOT scoped to a session — they live globally in the `aliases` container.

### `Announcement` (`lib/types.ts`)

```typescript
interface Announcement {
  id: string;        // randomBytes(12).toString('hex') — 24 hex chars
  text: string;      // max 500 chars
  time: string;      // ISO 8601 creation time
  editedAt?: string; // ISO 8601 — set when admin edits an existing announcement
  sessionId: string; // scoped to active session ID
}
```

---

## API Routes

### `GET /api/session`
- Auth: none
- Response: `Session` object (or `DEFAULT_SESSION` with the active session ID if no DB record)
- Notes: resolves active session via `getActiveSessionId()` (reads pointer, falls back to `'current-session'`)

### `PUT /api/session`
- Auth: admin cookie required
- Body: `{ title, locationName, locationAddress, datetime, endDatetime, deadline, courts, maxPlayers, signupOpen, approvedNames }`
- Notes: `datetime`, `endDatetime`, `deadline` must be valid ISO strings (validated via `Date.parse`). Admin's browser encodes local timezone offset into the ISO string via `withLocalTz()`. `endDatetime` is optional — omit or send `''` to clear it. `approvedNames` is an array of strings, max 500 entries, each trimmed and non-empty. `signupOpen` is a boolean.
- Response: saved `Session` object

### `POST /api/session/advance`
- Auth: admin cookie required
- Body: same shape as `PUT /api/session` but `datetime` is required
- Behaviour: derives `newId = sessionIdFromDate(datetime)` → creates new session document with `signupOpen: false` by default → calls `setActiveSessionId(newId)` to update the pointer → returns 409 if `newId === currentId`
- Notes: `approvedNames` is NOT carried over to the new session automatically (it starts empty). Location and timing fields from the current session are pre-populated in the form but must be explicitly submitted.
- Response: new `Session` object, status 201

### `GET /api/sessions`
- Auth: admin cookie required
- Response: all session documents ordered by `id DESC`, excluding the pointer document and the legacy `'current-session'` document

### `GET /api/players`
- Auth: none (admin cookie enables `?all=true`)
- Query: `?all=true` — includes soft-deleted records (admin only, otherwise ignored)
- Response: `Player[]` with `deleteToken` stripped from every record, ordered by `timestamp ASC`
- Notes: returns both active (`waitlisted` false/absent) and waitlisted players; clients split by `p.waitlisted`

### `POST /api/players`
- Auth: none (rate-limited: 10 req/min/IP)
- Body: `{ name: string, waitlist?: boolean }`
- Returns 400 if name empty or >50 chars
- Returns 403 if `session.signupOpen === false` (non-admin)
- Returns 403 if current time is past `session.deadline` (non-admin)
- Returns 403 if `session.approvedNames` is non-empty and name not in list (non-admin) — message: `"hmmmm... please use the name we know you by"`
- Returns 409 if name already active (`Already signed up`) or session full without `waitlist: true`
- If a soft-deleted record with the same name exists, it is restored (new `deleteToken`, `paid` reset to false)
- Response: `Player` object + `deleteToken` (one-time)
- Status 201 on success

### `PATCH /api/players`
- Auth: admin cookie required
- Body: `{ id: string, paid?: boolean, removed?: boolean, waitlisted?: boolean }`
- Capacity-checked when `removed: false` (restore) or `waitlisted: false` (promote) — returns 409 if full
- `deleteToken` is stripped from the response
- Use cases: toggle paid, restore removed player, promote waitlisted player

### `DELETE /api/players`
- Auth: admin cookie OR `deleteToken` for individual cancel (rate-limited: 10 req/min/IP)
- Body variants:
  - `{ name, deleteToken? }` — soft-delete one player; requires admin OR matching `deleteToken`
  - `{ clearAll: true }` — admin: soft-delete all non-removed players (preserves data, sets `cancelledBySelf: false`)
  - `{ purgeAll: true }` — admin: hard-delete every record in the session (irreversible)

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
- Response: `Announcement[]` ordered by `time DESC`

### `POST /api/announcements`
- Auth: admin cookie required
- Body: `{ text: string }` (max 500 chars)
- Status 201 on success

### `PATCH /api/announcements`
- Auth: admin cookie required
- Body: `{ id: string, text: string }` (max 500 chars)
- Sets `editedAt` on the record
- Response: updated `Announcement`

### `DELETE /api/announcements`
- Auth: admin cookie required
- Body: `{ id: string }`

### `GET /api/aliases`
- Auth: admin cookie required
- Response: `Alias[]` ordered by `appName ASC`

### `POST /api/aliases`
- Auth: admin cookie required
- Body: `{ appName: string, etransferName: string }` (each max 50 chars, both required)
- Status 201 on success

### `PATCH /api/aliases`
- Auth: admin cookie required
- Body: `{ id: string, appName?: string, etransferName?: string }`
- Partition key for `aliases` container is the record's own `id` (not `sessionId`)

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
Root client component. Holds `activeTab: 'home' | 'players' | 'admin'` state. Renders one tab at a time. Also renders `<GlassPhysics />` (mouse tracker) and `<BottomNav />`.

### `HomeTab.tsx`
Fetches session, players, and announcements in parallel on mount. Reads `badminton_username` and `badminton_deletetoken` from `localStorage` to identify the current user.

**Seven sign-up states** rendered inside the "Sign up" glass card (priority order top to bottom):

| Priority | State | Condition | UI |
|---|---|---|---|
| 1 | Session finished | `endDatetime` set and past | Green "Thanks for coming!" banner |
| 2 | Sign-ups not open | `signupOpen === false` AND not already signed up/waitlisted | Orange "Sign-ups not open yet" banner |
| 3 | Deadline passed | `deadline` past AND not signed up/waitlisted | Orange "Sign-ups closed" banner |
| 4 | Signed up (active) | Name matches active player | Green "You're in!" banner + spot counter + "View Sign Up List" button |
| 5 | Waitlisted | Name matches waitlisted player | Orange "You're on the waitlist" banner + position number |
| 6 | Full (join waitlist) | Active count >= maxPlayers AND deadline not past | Orange "Session Full" banner + "Join Waitlist" form |
| 7 | Open | Default | Sign-up form + spot counter + deadline reminder |

The sign-up form shows an autocomplete dropdown filtered from `session.approvedNames` when the user types. The dropdown fires on focus and hides on blur (100ms delay to allow click).

The address link is rendered as `text-gray-300` with `decoration-dotted underline` (not blue) linking to Google Maps.

### `PlayersTab.tsx`
Fetches players and session in parallel on mount. Lists active players in one `glass-card` (header = `section-label` with game date from session), waitlisted players in a second card with `list-header-amber` header labelled "WAITLISTED". No court SVG in either card. Current user row highlighted with `.player-highlight-green` (active) or `.player-highlight-amber` (waitlist). Self-cancel requires `deleteToken` from `localStorage` — shows "Cancel" (active) or "Leave" (waitlist) with a confirm step.

### `AdminTab.tsx`
Four sub-components behind a PIN gate. The segment control now has four tabs: **Session / Players / Posts / Aliases**.

#### `SessionEditor`
Four glass cards:

1. **BADMINTON DETAILS** — location name, address, courts, max players, and a `signupOpen` toggle switch (green when open, grey when closed). "Update" button only active when the form is dirty.

2. **DATE & TIME** — three date+time rows (Date & Time / Sign-up Deadline / Session End), each using `<DatePicker>` + `<input type="time">`. "Update" button only active when dirty.

3. **APPROVED NAMES** — add/remove names from the allowlist. Entering a name and pressing Enter or clicking "Add" appends it. Each name shows an × button to remove. "Save Members" saves the list to the session.

4. **CREATE SESSION FOR NEXT WEEK** — "Advance" form with its own Date, Deadline, End, Courts, and Max Players fields. Calls `POST /api/session/advance`. On success, the main form updates to reflect the new session. The advance button is disabled until a date, time, and deadline date are all filled in. New sessions start with `signupOpen: false` by default — admin must explicitly toggle it open after advancing.

#### `AdminPlayersPanel`
Loads `?all=true` to get active + waitlisted + removed players, plus aliases for CSV export. Features:
- Add player form (admin bypasses deadline/signupOpen checks)
- Active players list with paid/unpaid pill toggle (`.pill-paid` / `.pill-unpaid`) and confirm-before-remove
- Waitlisted players card with Promote and Remove actions
- Cancelled players card (collapsible, sorted by `removedAt DESC`) showing cancel type ("Cancelled" / "Removed") and timestamp, with Restore action
- CSV export: columns `#`, `Name`, `E-Transfer Name`, `Waitlisted`, `Signed Up`, `Paid` — includes active AND waitlisted players; `E-Transfer Name` populated from alias map
- "Clear session" (soft-delete all active) and "Purge all records" (hard-delete everything) via a portal action sheet with record counts

`fmtSessionLabel(datetime)` produces smart date labels: `'TODAY'` / weekday name (if within 7 days) / `'MAR 29'` format.

#### `AnnouncementsPanel`
Draft → Polish with AI (`POST /api/claude`) → Post to Home (`POST /api/announcements`). Can also post draft directly without polishing. Lists posted announcements with Edit (inline PATCH) and Delete. Edited announcements show "· edited" timestamp indicator.

#### `AliasesPanel`
Full CRUD for aliases: add form (app name + e-transfer name), inline edit mode per row, delete button per row. Loaded fresh on mount via `GET /api/aliases`.

### `BottomNav.tsx`
Fixed bottom nav with three tabs: Home (`home`), Players (`group`), Admin (`admin_panel_settings`). Active tab uses `.nav-tab-active` and inline `color: #4ade80`.

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

**Key CSS classes to know:**

| Class | Purpose |
|---|---|
| `.glass-card` | Primary surface; use for all cards. Has mouse-reactive radial gradient via `--mx`/`--my` |
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
| `.status-banner-green` | "You're in" / success banner |
| `.status-banner-orange` | "Session Full" / warning banner |

### ID Generation
All IDs use `randomBytes` from Node.js `crypto`:
- Player IDs: `randomBytes(12).toString('hex')` (24 hex chars)
- Delete tokens: `randomBytes(16).toString('hex')` (32 hex chars)
- Announcement IDs: `randomBytes(12).toString('hex')` (24 hex chars)
- Alias IDs: `randomBytes(12).toString('hex')` (24 hex chars)

### Datetime Handling
- All datetimes stored as ISO 8601 strings with the admin's local timezone offset embedded (e.g. `2025-04-05T14:00:00+11:00`). This ensures correct display for all users regardless of server timezone.
- `withLocalTz(date, time)` in `SessionEditor` builds the timezone-aware string from the form's date+time inputs.
- `toValidIso(val)` in `app/api/session/route.ts` validates and trims ISO strings server-side (imported by `advance/route.ts`).
- `fmtDate(iso)` in `lib/formatters.ts` formats using `toLocaleDateString` with `weekday: 'long', month: 'long', day: 'numeric'`.
- `fmtSessionLabel(datetime)` in `AdminTab.tsx` returns `'TODAY'`, weekday name, or `'MAR 29'` format.

### Cosmos DB Access
- Always use `getContainer(name)` from `lib/cosmos.ts` — never instantiate `CosmosClient` directly
- Always resolve the active session ID via `getActiveSessionId()` — never hard-code `'current-session'` in new code
- Always filter by `sessionId = @sessionId` in every player/announcement query
- Partition key on the `players` container is the session ID (used in `container.item(id, sessionId)`)
- Partition key on the `aliases` container is the alias's own `id` (not session-scoped)
- The pointer document uses `POINTER_ID` as both its `id` and partition key

### Error Handling
- API routes: always return `NextResponse.json({ error: string }, { status: NNN })`
- Client components: inline error text as `<p className="text-red-400 text-xs">` immediately below the relevant control
- ARIA: error paragraphs have `role="alert"` and `id` matching `aria-describedby` on the input

### localStorage Keys
- `badminton_username` — player's display name
- `badminton_deletetoken` — player's self-cancel token (cleared on cancel)

### Segment Control Pattern
The admin panel segment control follows **Apple HIG spec**: `role="tablist"` / `role="tab"` / `aria-selected`, pill shape (`border-radius: 100px`), 32px height, 2px padding, font size `13.333px`, active weight `590`, inactive weight `510`. Uses `.segment-control`, `.segment-tab-active`, `.segment-tab-inactive` CSS classes. There are now **four** tabs: Session, Players, Posts, Aliases.

---

## Security Rules

1. **`deleteToken` must never appear in GET responses.** It is stripped in `GET /api/players` before returning. After any PATCH that touches the `players` container, destructure out `deleteToken` before returning: `const { deleteToken: _dt, ...safe } = updated`.
2. **Admin cookie comparison must use `timingSafeEqual`.** Never use `===` to compare PINs or cookie values.
3. **All admin-mutating routes must call `isAdminAuthed(req)` before any DB access.** If the check is skipped, any caller can modify data.
4. **`POST /api/claude` must remain admin-only.** It proxies directly to the Anthropic API — an unauthenticated endpoint would expose the API key's usage budget.
5. **Rate limiting must be applied at the top of the handler, before any logic.** If moved after auth checks, rate limiting can be bypassed.
6. **IP extraction must use `getClientIp(req)`** (reads `X-Client-IP` first, then `X-Forwarded-For`). Do not use `req.ip` — it returns the Azure proxy IP, making rate limits global rather than per-user.
7. **`ADMIN_PIN` must not be set to an empty string in production.** `lib/auth.ts` throws if it is absent in production.
8. **Session fields are sanitised server-side.** `PUT /api/session` allows only known fields and enforces length caps. `approvedNames` entries are trimmed and empty strings filtered. Do not add fields without sanitising them.
9. **`purgeAll: true` is irreversible.** The action permanently deletes every DB record for the session including soft-deleted ones. The UI shows a confirmation sheet with explicit record counts before executing.
10. **`GET /api/aliases` and all alias mutations require admin auth.** Aliases may contain real names — never expose them to unauthenticated users.
11. **`GET /api/sessions` requires admin auth.** Historical session data is admin-only.

---

## Environment Variables

| Variable | Required | Description |
|---|---|---|
| `ADMIN_PIN` | Yes (prod) | PIN for admin access. Must be non-empty in production. |
| `ANTHROPIC_API_KEY` | Yes | Anthropic API key for `claude-sonnet-4-20250514`. |
| `COSMOS_CONNECTION_STRING` | Yes (prod) | Azure Cosmos DB connection string. If absent, in-memory mock store is used. |
| `COSMOS_DB_NAME` | No | Cosmos database name. Defaults to `'badminton'`. |
| `NEXT_PUBLIC_MAX_PLAYERS` | No | Default max players per session. Defaults to `12`. Baked into client bundle at build time. |
| `NEXT_PUBLIC_BASE_PATH` | No | URL base path prefix. Must match `basePath` in `next.config.js`. Currently `/bpm`. Baked into client bundle at build time — set in `.env.local` for dev and in Azure App Settings for production. |

`NEXT_PUBLIC_*` variables are baked into the client bundle at build time. Changing them requires a rebuild.

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
- CSP: `default-src 'self'`; scripts allow `'unsafe-inline'` (dev also adds `'unsafe-eval'`); styles allow `fonts.googleapis.com`; fonts allow `fonts.gstatic.com`; `img-src 'self' data:`; `connect-src 'self'`

---

## Known Constraints and Gotchas

### Session Pointer Backward Compatibility
`getActiveSessionId()` falls back to `'current-session'` if the pointer document doesn't exist. Any legacy DB records with `sessionId = 'current-session'` will remain visible until the admin performs the first "Advance" action. After advancing, the old `'current-session'` data is orphaned — `GET /api/sessions` explicitly excludes it (`c.id != 'current-session'`).

### New Sessions Start Closed
`POST /api/session/advance` always creates the new session with `signupOpen: false`. Admin must explicitly toggle sign-ups open after advancing. This is intentional to avoid players signing up before the admin is ready.

### Approved Names Not Carried Forward on Advance
When advancing to a new week, the new session inherits `approvedNames` from the current session. The admin must manually update the list if the roster changes. Wait — actually looking at the code: `advance/route.ts` sets `approvedNames: Array.isArray(currentSession?.approvedNames) ? currentSession.approvedNames : []`. So names ARE carried over from the previous session.

### Race Condition on Signup
Capacity check and insert in `POST /api/players` are not atomic. Concurrent signups can exceed `maxPlayers` by 1–2 spots. Fixing properly requires Cosmos DB optimistic concurrency (ETags). This is a known limitation on the Free tier where throughput is limited.

### Rate Limiter is In-Memory
`lib/rateLimit.ts` uses a module-level `Map`. It resets on every cold start and is not shared across multiple server instances. On Free tier Azure (single instance), this is acceptable. Would need Redis for multi-instance.

### Free Tier Cold Starts
First request after ~20 minutes of idle takes 10–20 seconds to wake up. This is an Azure App Service Free tier characteristic — not a bug.

### `NEXT_PUBLIC_BASE_PATH` Must Match `basePath`
`next.config.js` has `basePath: '/bpm'` hard-coded. `NEXT_PUBLIC_BASE_PATH` must be set to `/bpm` in both local `.env.local` and Azure App Settings, or all API fetches will 404.

### `endDatetime` Is Optional
`Session.endDatetime` may be absent in DB records written before this field was added. All client checks must guard with `session?.endDatetime ? ... : false`.

### `signupOpen` Is Optional
`Session.signupOpen` may be absent in legacy records (treated as `true`). The `SessionEditor` normalises this: `data.signupOpen !== false` (so absent = open).

### TeamsTab Does Not Exist
The Teams tab was removed. `app/page.tsx` only renders `HomeTab`, `PlayersTab`, and `AdminTab`. The `Tab` type is `'home' | 'players' | 'admin'`. Do not re-introduce it.

### DatePicker Is a Custom Component
The native `<input type="date">` was replaced with `DatePicker` because the native picker renders inconsistently across mobile browsers and doesn't match the glass design. `DatePicker` uses `createPortal` to escape `backdrop-filter` stacking contexts — if it were rendered inline, the calendar dropdown would be clipped behind blurred elements.

### Alias Container Partition Key
The `aliases` container uses each record's own `id` as the partition key (not `sessionId`). This differs from `players` and `announcements`. When reading/deleting individual aliases, use `container.item(id, id)`.

### `.azure/` Is Gitignored
The `.azure/config` file (local Azure CLI context) is gitignored and must never be committed.

### `toValidIso` Is Exported from `session/route.ts`
`app/api/session/advance/route.ts` imports `toValidIso` directly from `app/api/session/route.ts`. If `session/route.ts` is refactored, this import must be updated.

---

## Rules Before Making Any Change

1. **Use `getActiveSessionId()` in every route handler.** Never hard-code `'current-session'` in new queries. The active session ID is dynamic and resolved via the pointer document.

2. **Never expose `deleteToken` in a response.** After any PATCH or GET that touches the `players` container, destructure out `deleteToken` before returning: `const { deleteToken: _dt, ...safe } = updated`.

3. **Auth before DB.** Any route that mutates data must call `isAdminAuthed(req)` at the very top, before parsing the body or touching the DB.

4. **Rate limit before auth on public endpoints.** Rate limiting must come before auth checks in handlers for `POST /api/players`, `DELETE /api/players`, and `POST /api/admin` so it cannot be bypassed.

5. **Capacity-check promotions and restores.** Any PATCH that sets `removed: false` or `waitlisted: false` must query active player count first and return 409 if at capacity — excluding the player being changed from the count.

6. **Use `.segment-control` / `.segment-tab-active` / `.segment-tab-inactive` classes for any new segment controls.** Do not recreate the Apple HIG spec inline. Admin now has four tabs (Session / Players / Posts / Aliases) — if adding a fifth, add it to the `SECTIONS` array in `AdminPanel`.

7. **Do not add CSS divider lines between glass card sections.** The design intentionally omits hard dividers. Use `space-y-*`, padding, and `.list-header-green` / `.list-header-amber` for visual separation.

8. **Use `randomBytes` for all IDs and tokens.** Never use `Math.random()`.

9. **Datetimes must carry timezone offset.** When storing any datetime entered by the admin, run it through `withLocalTz(date, time)` before sending to the API. Plain `YYYY-MM-DDThh:mm:00` strings without a timezone offset are ambiguous and will display incorrectly for users in different timezones.

10. **New sessions start closed.** When creating a new session via `advance`, `signupOpen` defaults to `false`. Do not change this default — admin must explicitly open sign-ups. The `SessionEditor` shows this state immediately after advancing.

11. **Test with in-memory mock before touching DB logic.** Remove `COSMOS_CONNECTION_STRING` from `.env.local` to use the mock store. Verify the mock query filters (`@sessionId`, `c.removed != true`, `c.waitlisted != true`, `@name`, `@id`, `@pointerId`) match the real Cosmos query strings.

12. **`NEXT_PUBLIC_*` changes require a rebuild.** These are baked into the client bundle. A runtime change to Azure App Settings alone will not take effect without redeployment.

13. **Aliases are global (not session-scoped).** Do not add `sessionId` filtering to alias queries. The `aliases` container has no `sessionId` field.

14. **No TeamsTab.** Do not re-introduce a Teams tab or reference it from `BottomNav` without also updating the `Tab` type in `app/page.tsx`.
