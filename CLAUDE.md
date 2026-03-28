# CLAUDE.md — Badminton Session Manager

## Purpose

A mobile-first web app for managing casual weekly badminton sessions. Players sign up for a session (or join a waitlist when full), and an admin manages session details, player lists, payment tracking, announcements, and AI-generated team balancing. Built for a single recurring group ("BPM Badminton"), deployed on Azure App Service Free tier at `/bpm`.

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
    admin/route.ts          GET (auth check) · POST (PIN verify) · DELETE (logout)
    announcements/route.ts  GET · POST · DELETE
    claude/route.ts         POST — admin-only AI proxy (rate-limited)
    players/route.ts        GET · POST · PATCH · DELETE
    session/route.ts        GET · PUT (admin only)
  globals.css               All shared CSS classes and design tokens
  layout.tsx                Root layout — aurora background blobs, Material Icons link
  page.tsx                  Root page — tab state, renders HomeTab/PlayersTab/AdminTab

components/
  AdminTab.tsx              PIN gate → AdminPanel → SessionEditor / AdminPlayersPanel / AnnouncementsPanel
  BottomNav.tsx             Fixed bottom nav (Home, Players, Admin)
  DatePicker.tsx            Custom calendar date picker, portal-rendered
  GlassPhysics.tsx          Mouse-tracking CSS var updater (--mx, --my) for glass card hover effect
  HomeTab.tsx               6-state sign-up card + session info + announcement display
  PlayersTab.tsx            Active player list + waitlist card; self-cancel flow

lib/
  auth.ts                   HTTP-only cookie helpers: setAdminCookie, clearAdminCookie, isAdminAuthed
  cosmos.ts                 DB client + SESSION_ID constant + in-memory mock + DEFAULT_SESSION
  formatters.ts             fmtDate(iso) — locale-aware long date string
  rateLimit.ts              In-memory rate limiter + getClientIp (reads X-Client-IP for Azure)
  types.ts                  Session, Player, Announcement interfaces

next.config.js              basePath /bpm, output standalone, security headers
tailwind.config.js          Extends colors: court (#4ade80), forest-900, forest-800
tsconfig.json               strict mode, @/* path alias → project root
.github/workflows/
  main_badminton-app.yml    Build → standalone zip → OIDC login → Azure deploy
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

### Data Flow

```
Cosmos DB (3 containers: sessions, players, announcements)
  ↓ getContainer(name)            ← lib/cosmos.ts
  ↓ API route handlers            ← app/api/*/route.ts
  ↓ JSON over fetch               ← components (client)
```

`SESSION_ID = 'current-session'` is a hard-coded constant. Every Cosmos query filters by `sessionId = SESSION_ID`. The app supports exactly one active session at a time.

### Session Finished State

If `session.endDatetime` is set and the current time is past it, `HomeTab` shows a "Thanks for coming!" state. This is a client-side time check only — no server-side enforcement.

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
  id: string;            // always 'current-session'
  sessionId?: string;    // same as id, set by PUT handler for Cosmos partition key
  title: string;         // display title, max 100 chars
  locationName?: string; // venue name, max 200 chars
  locationAddress?: string; // street address, max 300 chars — rendered as Google Maps link
  datetime: string;      // ISO 8601 with local timezone offset (set by admin's browser)
  endDatetime?: string;  // optional — when past this, HomeTab shows "Thanks for coming!"
  deadline: string;      // ISO 8601 — after this, POST /api/players returns 403
  courts: number;        // 1–20
  maxPlayers: number;    // 1–100 (default 12)
}
```

`DEFAULT_SESSION` in `lib/cosmos.ts` is returned when no session record exists in the DB. It sets `datetime` to +7 days and `endDatetime` to +7 days + 2 hours.

### `Player` (`lib/types.ts`)

```typescript
interface Player {
  id: string;              // randomBytes(12).toString('hex')
  name: string;            // trimmed, max 50 chars, case-insensitive dedup
  sessionId: string;       // always 'current-session'
  timestamp: string;       // ISO 8601 sign-up time (updated on restore)
  paid?: boolean;          // false by default; toggled by admin
  waitlisted?: boolean;    // true = on waitlist; absent/false = active
  removed?: boolean;       // true = soft-deleted
  removedAt?: string;      // ISO 8601 time of removal
  cancelledBySelf?: boolean; // true = player cancelled; false = admin removed
  deleteToken?: string;    // DB-only — NEVER sent to clients (stripped in all GETs)
}
```

### `Announcement` (`lib/types.ts`)

```typescript
interface Announcement {
  id: string;        // randomBytes(12).toString('hex')
  text: string;      // max 500 chars
  time: string;      // ISO 8601 creation time
  sessionId: string; // always 'current-session'
}
```

---

## API Routes

### `GET /api/session`
- Auth: none
- Response: `Session` object (or `DEFAULT_SESSION` if no DB record)

### `PUT /api/session`
- Auth: admin cookie required
- Body: `{ title, locationName, locationAddress, datetime, endDatetime, deadline, courts, maxPlayers }`
- Notes: `datetime`, `endDatetime`, `deadline` must be valid ISO strings (validated via `Date.parse`). Admin's browser encodes local timezone offset into the ISO string via `withLocalTz()`. `endDatetime` is optional — omit or send `''` to clear it.
- Response: saved `Session` object

### `GET /api/players`
- Auth: none (admin cookie enables `?all=true`)
- Query: `?all=true` — includes soft-deleted records (admin only, otherwise ignored)
- Response: `Player[]` with `deleteToken` stripped from every record, ordered by `timestamp ASC`
- Notes: returns both active (`waitlisted` false/absent) and waitlisted players; clients split by `p.waitlisted`

### `POST /api/players`
- Auth: none (rate-limited: 10 req/min/IP)
- Body: `{ name: string, waitlist?: boolean }`
- Returns 400 if name empty or >50 chars
- Returns 403 if current time is past `session.deadline`
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
  - `{ clearAll: true }` — admin: soft-delete all active players (preserves data)
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

### `DELETE /api/announcements`
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

**Six sign-up states** rendered inside the "Sign up" glass card:

| State | Condition | UI |
|---|---|---|
| Session finished | `endDatetime` set and past | "Thanks for coming!" green banner |
| Deadline passed | `deadline` past AND not signed up/waitlisted | Orange "Sign-ups closed" banner |
| Signed up (active) | Name matches active player | Green "You're in!" banner + spot counter + "View Sign Up List" button |
| Waitlisted | Name matches waitlisted player | Orange "You're on the waitlist" banner + position number |
| Full (join waitlist) | Active count >= maxPlayers AND deadline not past | Orange "Session Full" banner + "Join Waitlist" form |
| Open | Default | Sign-up form + spot counter + deadline reminder |

Priority order: session finished → deadline passed (unauthenticated) → signed up → waitlisted → full → open.

The address link is rendered as `text-gray-300` with `decoration-dotted underline` (not blue) linking to Google Maps.

### `PlayersTab.tsx`
Lists active players in one `glass-card` (header = game date from session), waitlisted players in a second card with `list-header-amber`. No court SVG in either card. Current user row highlighted with `.player-highlight-green` (active) or `.player-highlight-amber` (waitlist). Self-cancel requires `deleteToken` from `localStorage`.

### `AdminTab.tsx`
Three sub-components behind a PIN gate:

- **`SessionEditor`**: three fields per date row (start, deadline, end) each using `<DatePicker>` + `<input type="time">`. Encodes timezone offset into ISO string before PUT. The "Session End" row sets `endDatetime`.

- **`AdminPlayersPanel`**: Loads `?all=true` to get active + waitlisted + removed players. Features: add player, paid/unpaid pill toggle (`.pill-paid` / `.pill-unpaid`), confirm-before-remove, promote from waitlist, restore from cancelled, CSV export (active players only), clear session (soft) and purge all (hard) via an action sheet portal. `fmtSessionLabel()` produces smart date labels: "TODAY" / weekday name / "MAR 29".

- **`AnnouncementsPanel`**: Draft → Polish with AI (`POST /api/claude`) → Post to Home (`POST /api/announcements`). Also lists and deletes existing announcements.

The segment control (Session / Players / Posts) follows **Apple HIG spec**: `role="tablist"` / `role="tab"` / `aria-selected`, pill shape (`border-radius: 100px`), 32px height, 2px padding, font size `13.333px`, active weight `590`, inactive weight `510`. Uses `.segment-control`, `.segment-tab-active`, `.segment-tab-inactive` CSS classes.

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
- Inline styles are acceptable only for one-off values (e.g., `fontSize: '13.333px'` on segment tabs)
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

### Datetime Handling
- All datetimes stored as ISO 8601 strings with the admin's local timezone offset embedded (e.g. `2025-04-05T14:00:00+11:00`). This ensures correct display for all users regardless of server timezone.
- `withLocalTz(date, time)` in `SessionEditor` builds the timezone-aware string from the form's date+time inputs.
- `fmtDate(iso)` in `lib/formatters.ts` formats using `toLocaleDateString` with `weekday: 'long', month: 'long', day: 'numeric'`.
- `fmtSessionLabel(datetime)` in `AdminTab.tsx` returns `'TODAY'`, weekday name, or `'MAR 29'` format.

### Cosmos DB Access
- Always use `getContainer(name)` from `lib/cosmos.ts` — never instantiate `CosmosClient` directly
- Always filter by `sessionId = SESSION_ID` in every query
- Partition key on the `players` container is `SESSION_ID` (used in `container.item(id, SESSION_ID)`)

### Error Handling
- API routes: always return `NextResponse.json({ error: string }, { status: NNN })`
- Client components: inline error text as `<p className="text-red-400 text-xs">` immediately below the relevant control
- ARIA: error paragraphs have `role="alert"` and `id` matching `aria-describedby` on the input

### localStorage Keys
- `badminton_username` — player's display name
- `badminton_deletetoken` — player's self-cancel token (cleared on cancel)

---

## Security Rules

1. **`deleteToken` must never appear in GET responses.** It is stripped in `GET /api/players` before returning. Never add it back.
2. **Admin cookie comparison must use `timingSafeEqual`.** Never use `===` to compare PINs or cookie values.
3. **All admin-mutating routes must call `isAdminAuthed(req)` before any DB access.** If the check is skipped, any caller can modify data.
4. **`POST /api/claude` must remain admin-only.** It proxies directly to the Anthropic API — an unauthenticated endpoint would expose the API key's usage budget.
5. **Rate limiting must be applied at the top of the handler, before any logic.** If moved after auth checks, rate limiting can be bypassed.
6. **IP extraction must use `getClientIp(req)`** (reads `X-Client-IP` first, then `X-Forwarded-For`). Do not use `req.ip` — it returns the Azure proxy IP, making rate limits global rather than per-user.
7. **`ADMIN_PIN` must not be set to an empty string in production.** `lib/auth.ts` throws if it is absent in production.
8. **Session fields are sanitised server-side.** `PUT /api/session` allows only known fields and enforces length caps. Do not add fields without sanitising them.
9. **`purgeAll: true` is irreversible.** The action permanently deletes every DB record for the session including soft-deleted ones. The UI shows a confirmation sheet with explicit record counts before executing.

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
- Cosmos DB: database `badminton`, 3 containers (`sessions`, `players`, `announcements`) at 400 RU/s shared throughput
- Runtime env vars (`ADMIN_PIN`, `ANTHROPIC_API_KEY`, `COSMOS_CONNECTION_STRING`, etc.) are set in Azure App Service Application Settings — not in the workflow file.

### Security Headers (applied to all routes via `next.config.js`)
- `X-Frame-Options: DENY`
- `X-Content-Type-Options: nosniff`
- `Referrer-Policy: strict-origin-when-cross-origin`
- `Permissions-Policy: camera=(), microphone=(), geolocation=()`
- `Strict-Transport-Security: max-age=31536000; includeSubDomains`
- CSP: `default-src 'self'`; scripts allow `'unsafe-inline'`; styles also allow `fonts.googleapis.com`; fonts also allow `fonts.gstatic.com`

---

## Known Constraints and Gotchas

### Race Condition on Signup
Capacity check and insert in `POST /api/players` are not atomic. Concurrent signups can exceed `maxPlayers` by 1–2 spots. Fixing properly requires Cosmos DB optimistic concurrency (ETags). This is a known limitation on the Free tier where throughput is limited.

### Rate Limiter is In-Memory
`lib/rateLimit.ts` uses a module-level `Map`. It resets on every cold start and is not shared across multiple server instances. On Free tier Azure (single instance), this is acceptable. Would need Redis for multi-instance.

### Free Tier Cold Starts
First request after ~20 minutes of idle takes 10–20 seconds to wake up. This is an Azure App Service Free tier characteristic — not a bug.

### Single Session Model
`SESSION_ID = 'current-session'` is hard-coded. The app supports exactly one active session at a time. There is no concept of past sessions being visible to players. Admin "Clear session" soft-deletes all players for the week; "Purge all" hard-deletes everything.

### `NEXT_PUBLIC_BASE_PATH` Must Match `basePath`
`next.config.js` has `basePath: '/bpm'` hard-coded. `NEXT_PUBLIC_BASE_PATH` must be set to `/bpm` in both local `.env.local` and Azure App Settings, or all API fetches will 404. If the base path ever changes, update both places.

### `endDatetime` Is Optional
`Session.endDatetime` may be absent in DB records written before this field was added. All client checks must guard with `session?.endDatetime ? ... : false`. The `DEFAULT_SESSION` in `lib/cosmos.ts` includes `endDatetime`.

### TeamsTab Removed
The Teams tab (AI team generation) was present in earlier versions and is referenced in `README.md`, but the component no longer exists in the current codebase. `app/page.tsx` only renders `HomeTab`, `PlayersTab`, and `AdminTab`. The `Tab` type is `'home' | 'players' | 'admin'`.

### DatePicker Is a Custom Component
The native `<input type="date">` was replaced with a custom `DatePicker` component because the native picker renders inconsistently across mobile browsers and doesn't match the glass design. The `DatePicker` uses `createPortal` to escape `backdrop-filter` stacking contexts — if it were rendered inline, the calendar dropdown would be clipped or invisible behind other blurred elements.

### `.azure/` Is Gitignored
The `.azure/config` file (local Azure CLI context) is gitignored and should never be committed.

---

## Rules Before Making Any Change

1. **Check `SESSION_ID` scope.** Every Cosmos query must filter by `c.sessionId = @sessionId` with value `SESSION_ID`. Queries missing this filter will return or modify records from all sessions (though currently there is only one).

2. **Never expose `deleteToken` in a response.** After any PATCH or GET that touches the `players` container, destructure out `deleteToken` before returning: `const { deleteToken: _dt, ...safe } = updated`.

3. **Auth before DB.** Any route that mutates data must call `isAdminAuthed(req)` at the very top, before parsing the body or touching the DB.

4. **Rate limit before auth.** Rate limiting must come before auth checks in the handler so it cannot be bypassed.

5. **Capacity-check promotions and restores.** Any PATCH that sets `removed: false` or `waitlisted: false` must query active player count first and return 409 if at capacity — excluding the player being changed from the count.

6. **Use `.segment-control` / `.segment-tab-active` / `.segment-tab-inactive` classes for any new segment controls.** Do not recreate the Apple HIG spec inline — the spec is already codified in `globals.css`.

7. **Do not add CSS divider lines between glass card sections.** The design intentionally omits hard dividers. Use `space-y-*`, padding, and `.list-header-green` / `.list-header-amber` for visual separation.

8. **Use `randomBytes` for all IDs and tokens.** Never use `Math.random()`.

9. **Datetimes must carry timezone offset.** When storing any datetime entered by the admin, run it through `withLocalTz(date, time)` before sending to the API. Plain `YYYY-MM-DDThh:mm:00` strings without a timezone offset are ambiguous and will display incorrectly for users in different timezones.

10. **Test with in-memory mock before touching DB logic.** Remove `COSMOS_CONNECTION_STRING` from `.env.local` to use the mock store. Verify the mock query filters (`@sessionId`, `c.removed != true`, `c.waitlisted != true`, `@name`, `@id`) match the real Cosmos query strings in the route handlers.

11. **`NEXT_PUBLIC_*` changes require a rebuild.** These are baked into the client bundle. A runtime change to Azure App Settings alone will not take effect without redeployment.

12. **No TeamsTab.** Do not re-introduce a Teams tab or reference it from `BottomNav` without also adding it back to the `Tab` type in `app/page.tsx` and implementing the component.
