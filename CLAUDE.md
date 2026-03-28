# CLAUDE.md — Badminton Session Manager

## Purpose

A mobile-first web app for managing casual weekly badminton sessions. Players sign up for a session (or join a waitlist), and an admin manages session details, player lists, announcements, and AI-generated team balancing. Built for a single recurring group ("BPM Badminton"), deployed on Azure App Service Free tier.

---

## Quick Start

```bash
npm install
cp .env.local.example .env.local   # fill in values — see Environment Variables below
npm run dev
# → http://localhost:3000/bpm
```

When `COSMOS_CONNECTION_STRING` is not set, the app uses an in-memory mock store. All routes work offline without any Azure dependency. Mock data is wiped on process restart.

---

## Tech Stack

| Layer | Technology | Version |
|-------|------------|---------|
| Framework | Next.js (App Router) | ^16.2.1 |
| Language | TypeScript | ^5 (strict mode) |
| Styling | Tailwind CSS + custom CSS classes | ^3.3.0 |
| Database | Azure Cosmos DB (NoSQL/Core SQL) via `@azure/cosmos` | ^4.2.0 |
| AI | Anthropic Claude API via `@anthropic-ai/sdk` | ^0.36.3 |
| Runtime | Node.js 20 |  |
| Deployment | Azure App Service Free (F1), Canada Central |  |
| CI/CD | GitHub Actions (OIDC, SHA-pinned actions) |  |

---

## Project Structure

```
/
├── app/
│   ├── api/
│   │   ├── admin/route.ts          GET (auth check), POST (PIN verify), DELETE (logout)
│   │   ├── announcements/route.ts  GET, POST (admin), DELETE (admin)
│   │   ├── claude/route.ts         POST — admin-only AI proxy, rate-limited
│   │   ├── players/route.ts        GET, POST (sign-up), PATCH (admin), DELETE (self/admin)
│   │   └── session/route.ts        GET, PUT (admin only)
│   ├── globals.css                 Global styles: aurora background, glass card, buttons,
│   │                               shared text classes (.section-label, .list-header-green,
│   │                               .list-header-amber), form inputs, scrollbar
│   ├── layout.tsx                  Root layout — aurora blob background, Material Icons font
│   └── page.tsx                    Root client component — tab state, renders one tab at a time
├── components/
│   ├── AdminTab.tsx                PIN gate → AdminPanel → SessionEditor | AdminPlayersPanel |
│   │                               AnnouncementsPanel; CSV export; promote/restore/purge flows
│   ├── BottomNav.tsx               Fixed bottom nav — Home | Players | Admin tabs
│   ├── DatePicker.tsx              Custom calendar picker, portal-rendered (escapes stacking ctx),
│   │                               min-width 280px, value format YYYY-MM-DD
│   ├── GlassPhysics.tsx            Headless component — tracks mouse position into CSS vars
│   │                               --mx / --my for the glass card radial gradient effect
│   ├── HomeTab.tsx                 4 sign-up states: open / signed-up / waitlisted / full+join-waitlist
│   └── PlayersTab.tsx              Active player card (court SVG top half) + waitlist card
│                                   (same SVG, scaleY(-1) = court bottom half)
├── lib/
│   ├── auth.ts                     HTTP-only cookie helpers: setAdminCookie, clearAdminCookie,
│   │                               isAdminAuthed, unauthorized; cookie = SHA-256(badminton-admin:<PIN>)
│   ├── cosmos.ts                   getContainer() — returns real Cosmos container or in-memory mock;
│   │                               SESSION_ID constant; DEFAULT_SESSION fallback
│   ├── formatters.ts               fmtDate(iso) — locale-formatted weekday + date string
│   ├── rateLimit.ts                checkRateLimit(key, max, windowMs); getClientIp() reads
│   │                               X-Client-IP first (Azure real-client header), then X-Forwarded-For
│   └── types.ts                    Session, Player, Announcement interfaces
├── .env.local.example              Template for required env vars
├── .github/workflows/
│   └── main_badminton-app.yml      Auto-deploy: push to main → build → zip standalone → Azure deploy
├── next.config.js                  basePath: /bpm; output: standalone; security headers
├── tailwind.config.js              Custom colors: court (#4ade80), forest-900, forest-800
├── AZURE.md                        Full Azure architecture, Cosmos DB containers, cost info
└── DESIGN.md                       UI design system notes
```

---

## Architecture Overview

### Request Lifecycle

The app is a **single-page application** rendered as a Next.js App Router client component. `app/page.tsx` is `'use client'` and holds tab state. The layout renders the aurora background and Material Icons. All data fetching is done client-side via `fetch()` to the API routes — there are no server-rendered pages.

```
Browser → GET /bpm → page.tsx (client) → fetch /bpm/api/* → Cosmos DB / Anthropic
```

All API routes live under `app/api/` and are Next.js Route Handlers. Every route handler imports from `lib/` and never imports from `components/`.

### Base Path

The app is mounted at `/bpm` (`basePath` in `next.config.js`). Every client-side `fetch()` call prepends `process.env.NEXT_PUBLIC_BASE_PATH ?? ''`. This env var is baked into the client bundle at build time — it must be set correctly at build time (CI sets it to `/bpm`).

### Auth Flow

```
User enters PIN
  → POST /api/admin { pin }
    → timingSafeEqual against env ADMIN_PIN
    → set HttpOnly cookie admin_session = SHA-256("badminton-admin:<PIN>")
  ← 200 { success: true }

Protected route handler
  → isAdminAuthed(req) reads cookie, recomputes SHA-256, timingSafeEqual comparison
  → returns true / false (never throws)
```

Cookie attributes: `HttpOnly`, `SameSite=Strict`, `Secure` (production only), 8-hour TTL, `path='/'`.

`GET /api/admin` just returns `{ authed: bool }` — AdminTab calls this on mount to skip the PIN gate if the cookie is still valid.

### Data Model and DB Access

Three Cosmos DB containers, all partitioned by `/sessionId`:

| Container | Partition Key | Purpose |
|-----------|---------------|---------|
| `players` | `/sessionId` | Player registrations |
| `sessions` | `/sessionId` | Session config |
| `announcements` | `/sessionId` | Admin announcements |

**Single-session pattern**: `SESSION_ID = 'current-session'` (hardcoded in `lib/cosmos.ts`). Every query filters `WHERE c.sessionId = @sessionId`. There is no multi-tenancy and no concept of historical sessions.

**`getContainer(name)`** is the only DB entry point. If `COSMOS_CONNECTION_STRING` is not set, it returns an in-memory mock that mirrors the real Cosmos API surface. Never import `CosmosClient` directly — always use `getContainer`.

### Key Design Decisions

- **Soft delete over hard delete**: Players are marked `{ removed: true, removedAt, cancelledBySelf }` rather than deleted. This allows the admin to restore them, see who cancelled, and prevent duplicate name sign-ups from creating orphan records (re-signup restores the existing record).
- **Hard purge is a separate explicit action**: `DELETE { purgeAll: true }` permanently removes all records. This is irreversible and intended for clearing between seasons, not weekly resets.
- **deleteToken for self-cancellation**: Players receive a `randomBytes(16).toString('hex')` token on sign-up (the only time it is returned). They store it in `localStorage`. The server stores it in Cosmos. `DELETE /api/players` requires either the token or an admin cookie. This prevents anonymous cancellation of other players.
- **Datetime includes local timezone offset**: Session datetimes are stored with the admin's local timezone offset so they display correctly for all users regardless of timezone. The `withLocalTz(date, time)` function in AdminTab builds the ISO string with offset.
- **In-memory rate limiter**: Uses a `Map` on the server process. Resets on restart. Not shared across multiple instances (acceptable for Free tier single-instance deployment).

---

## Data Models

```typescript
// lib/types.ts

interface Session {
  id: string;           // always 'current-session'
  sessionId?: string;   // also 'current-session' (set on PUT for Cosmos partition)
  title: string;        // session name, max 100 chars
  locationName?: string;  // venue name, max 200 chars
  locationAddress?: string; // street address, max 300 chars — linked to Google Maps if set
  datetime: string;     // ISO 8601 with local TZ offset, e.g. "2026-03-29T10:00:00+11:00"
  deadline: string;     // sign-up deadline, same format
  courts: number;       // number of courts, 1–20
  maxPlayers: number;   // capacity, 1–100; waitlisted players do NOT count toward this
}

interface Player {
  id: string;           // randomBytes(12).toString('hex') — 24 hex chars
  name: string;         // trimmed, max 50 chars, case-insensitive duplicate check
  sessionId: string;    // always SESSION_ID ('current-session')
  timestamp: string;    // ISO 8601, sign-up time (reset on restore)
  paid?: boolean;       // false by default; toggled by admin only
  waitlisted?: boolean; // true = on waitlist; active when false or undefined
  removed?: boolean;    // true = soft-deleted
  removedAt?: string;   // ISO 8601 timestamp of removal
  cancelledBySelf?: boolean; // true = player cancelled; false = admin removed
  deleteToken?: string; // NEVER sent to clients — stripped in GET /api/players response
}

interface Announcement {
  id: string;           // randomBytes(12).toString('hex')
  text: string;         // max 500 chars
  time: string;         // ISO 8601, creation time
  sessionId: string;    // always SESSION_ID
}
```

---

## API Routes

All routes are under `/bpm/api/` (due to `basePath`).

### `GET /api/session`
- Auth: none
- Returns the current session document, or `DEFAULT_SESSION` if not found
- `export const dynamic = 'force-dynamic'` prevents caching

### `PUT /api/session`
- Auth: admin cookie required
- Body: `{ title, locationName, locationAddress, datetime, deadline, courts, maxPlayers }`
- Server sanitises: strings trimmed/sliced, courts clamped 1–20, maxPlayers clamped 1–100, datetimes validated with `Date.parse()`
- Upserts the session document with `id = SESSION_ID`

### `GET /api/players`
- Auth: none (public); `?all=true` + admin cookie includes soft-deleted records
- Returns players array with `deleteToken` stripped from every item
- Default query excludes `removed = true` records
- Order: ascending by `timestamp`

### `POST /api/players`
- Auth: none; rate-limited 10 req/min per IP
- Body: `{ name: string, waitlist?: boolean }`
- Validation: name required, trimmed, max 50 chars; duplicate name (case-insensitive) returns 409
- Capacity: checks active (non-waitlisted, non-removed) count against `maxPlayers`
- If full and `waitlist: true`: creates with `waitlisted: true`
- If full and no `waitlist: true`: returns 409
- Re-signup: if a soft-deleted record exists with that name, restores it (upsert) instead of creating new
- Returns: `{ ...player, deleteToken }` — the only time `deleteToken` is sent to the client (status 201)

### `PATCH /api/players`
- Auth: admin cookie required
- Body: `{ id: string, paid?: boolean, removed?: boolean, waitlisted?: boolean }`
- Accepts multiple update fields at once; only known boolean fields are applied
- Capacity check when `removed: false` (restore) or `waitlisted: false` (promote): verifies active count < maxPlayers excluding self
- Returns updated player with `deleteToken` stripped

### `DELETE /api/players`
- Auth: rate-limited 10 req/min per IP; then either admin cookie or valid `deleteToken`
- Three modes (checked in order):
  1. `{ purgeAll: true }` — admin only; hard-deletes ALL records for the session (irreversible)
  2. `{ clearAll: true }` — admin only; soft-deletes all non-removed players (weekly reset)
  3. `{ name, deleteToken? }` — soft-deletes a single named player; requires token OR admin cookie

### `GET /api/admin`
- Auth: none
- Returns `{ authed: boolean }` — used by AdminTab on mount to check cookie status

### `POST /api/admin`
- Auth: none; rate-limited 5 req/15 min per IP
- Body: `{ pin: string }` (max 20 chars)
- Compares with `timingSafeEqual` against `ADMIN_PIN` env var
- On success: sets `admin_session` HTTP-only cookie; returns `{ success: true }`

### `DELETE /api/admin`
- Auth: admin cookie required
- Clears the `admin_session` cookie; returns `{ success: true }`

### `GET /api/announcements`
- Auth: none
- Returns all announcements for the session, ordered newest first

### `POST /api/announcements`
- Auth: admin cookie required
- Body: `{ text: string }` (max 500 chars, trimmed)
- Creates announcement with `randomBytes(12)` ID; returns 201

### `DELETE /api/announcements`
- Auth: admin cookie required
- Body: `{ id: string }`
- Verifies the announcement belongs to the current session before deleting

### `POST /api/claude`
- Auth: admin cookie required; rate-limited 10 req/min per IP
- Body: `{ prompt: string }` (max 4000 chars)
- Proxies to Anthropic `claude-sonnet-4-20250514`, max_tokens 1024
- Returns `{ text: string }`
- Used for team generation and announcement polishing — the browser never calls Anthropic directly

---

## Component Guide

### `app/page.tsx`
Root page, `'use client'`. Holds `activeTab` state (`'home' | 'players' | 'admin'`). Renders `GlassPhysics` (always), then the active tab component, then `BottomNav`. Tab switching is handled here and passed down as `onTabChange` prop.

### `components/GlassPhysics.tsx`
Headless client component. Listens to `mousemove` and updates CSS custom properties `--mx` / `--my` on `:root` via `requestAnimationFrame`. These drive the radial gradient highlight on `.glass-card` elements. Renders `null`.

### `components/BottomNav.tsx`
Fixed bottom navigation bar. Receives `activeTab` and `onTabChange`. Uses Material Icons. Active tab gets `.nav-tab-active` class and green color. Three tabs: Home, Players, Admin.

### `components/HomeTab.tsx`
Fetches session, players, and announcements in parallel on mount. Reads `localStorage` for `badminton_username` and `badminton_deletetoken`.

Four mutually exclusive sign-up states:
1. **Open** — normal sign-up form; `POST /api/players { name }`
2. **Signed up** — green banner, "View Sign Up List" button
3. **Waitlisted** — amber banner with waitlist position; "View Sign Up List" button
4. **Full** — orange "Session Full" banner + "Join Waitlist" form; `POST /api/players { name, waitlist: true }`

On successful sign-up, stores name and deleteToken in `localStorage`. On 409 conflict, reloads data (handles race conditions gracefully).

### `components/PlayersTab.tsx`
Fetches players and session in parallel. Splits players into `activePlayers` (not waitlisted) and `waitlistPlayers` (waitlisted). Self-cancel flow: shows "Cancel" button for the current user's row → confirm prompt → `DELETE /api/players { name, deleteToken }` → clears localStorage.

Court SVG decoration: active card shows court top half; waitlist card shows same SVG with `transform: scaleY(-1)` (court bottom half, visually continuing the court across cards).

### `components/AdminTab.tsx`
Three-phase component:
1. **PIN gate** (`AdminTab` default export) — checks auth on mount, shows PIN form if not authed
2. **AdminPanel** — segment control switching between three sub-panels
3. Sub-panels: `SessionEditor`, `AdminPlayersPanel`, `AnnouncementsPanel`

`AdminPlayersPanel` features:
- Add player (POST, same endpoint as self-signup)
- Toggle paid status (PATCH `{ id, paid }`)
- Remove player with confirm prompt (DELETE `{ name }` — admin auth via cookie)
- Promote waitlisted player (PATCH `{ id, waitlisted: false }`) — capacity-checked
- Restore soft-deleted player (PATCH `{ id, removed: false }`) — capacity-checked
- Collapsed "Cancelled" section showing soft-deleted players
- Soft-clear (clearAll) vs hard-purge (purgeAll) with mode toggle and confirm prompt
- CSV export of active players: columns `#, Name, Signed Up, Paid`

`SessionEditor` features:
- Custom `DatePicker` component for date fields (avoids browser native date input inconsistency)
- `withLocalTz(date, time)` builds datetime string with local timezone offset before PUT

`fmtSessionLabel(datetime)` (AdminTab-local, not exported) formats the session date header as "TODAY" / weekday name / "MAR 29" depending on how far away it is.

### `components/DatePicker.tsx`
Custom calendar picker. Props: `value: string` (YYYY-MM-DD), `onChange: (v: string) => void`, `placeholder?: string`. Renders a trigger button and a calendar dropdown portal-ed to `document.body` (`createPortal`) to escape all CSS stacking contexts. Min width 280px. Repositions on scroll while open.

---

## Coding Conventions

### File Naming
- Route handlers: `app/api/<resource>/route.ts`
- Components: PascalCase `.tsx` in `components/`
- Utilities: camelCase `.ts` in `lib/`

### Component Structure
- All components and pages are `'use client'` — there are no React Server Components in this project
- Components manage their own data fetching via `useEffect` + `fetch()`
- All `fetch()` calls prepend `const BASE = process.env.NEXT_PUBLIC_BASE_PATH ?? ''` (defined at top of each file)
- Loading states show an animated `refresh` Material Icon

### API Route Patterns
- Import `isAdminAuthed` and call it at the top of the handler for protected routes
- Import `checkRateLimit` and `getClientIp` for rate-limited routes; return 429 before any other logic
- Always validate and sanitise request body fields before using them
- Use `NextResponse.json(data, { status })` for all responses
- Wrap all DB operations in try/catch; log with `console.error('<route> error:', error)` and return appropriate status
- Strip `deleteToken` from all GET responses: `const { deleteToken: _dt, ...safe } = player`

### ID Generation
Always use `randomBytes` from Node.js `crypto` module — never `Math.random()`:
- Player/Announcement IDs: `randomBytes(12).toString('hex')` → 24-char hex string
- deleteToken: `randomBytes(16).toString('hex')` → 32-char hex string

### CSS / Styling Rules
Use the shared CSS classes from `globals.css` — do not recreate these inline:
- `.glass-card` — the standard card container with backdrop blur and border
- `.btn-primary` — green gradient action button
- `.btn-ghost` — neutral/white ghost button
- `.section-label` — `text-xs font-bold tracking-widest uppercase text-green-400`
- `.list-header-green` — tinted card row header, active/green variant
- `.list-header-amber` — tinted card row header, secondary/amber variant
- `.status-banner-green` / `.status-banner-orange` — alert banners
- `.nav-glass` — bottom nav container
- `.nav-tab-active` — active nav tab pill
- Material Icons are loaded from Google Fonts CDN; use `<span className="material-icons">icon_name</span>`

Custom Tailwind colors available:
- `court` = `#4ade80` (the court green)
- `forest-900` = `#050f07`
- `forest-800` = `#0a1f0e`

CSS custom properties available:
- `--court-green: #4ade80`
- `--forest-900: #050f07`
- `--forest-800: #0a1f0e`
- `--mx`, `--my` — mouse position (0.0–1.0), updated by GlassPhysics for glass highlight

### Design Language
- Dark background: `#100F0F`
- Text: `#e2e8f0` (default), `rgba(255,255,255,0.5)` (muted)
- No hard divider lines between sections — use spacing and background tints
- All interactive elements should have `transition` animations
- Confirm prompts for destructive actions (remove, cancel, purge) are always inline, not modal dialogs

### TypeScript
- `strict: true` is set in `tsconfig.json`; all code must type-check cleanly
- `tsconfig.json` path alias: `@/*` maps to project root (e.g. `@/lib/auth`)
- Use explicit type annotations for function parameters and return types in `lib/` files

### Cosmos DB Queries
- All queries must include `WHERE c.sessionId = @sessionId` — never query without session scoping
- Use parameterised queries (`parameters: [{ name: '@field', value }]`) — never string-interpolate
- Capacity checks always use a query that explicitly excludes `removed = true` AND `waitlisted = true`

---

## Security Rules

1. **Never expose `deleteToken` to clients.** GET `/api/players` strips it. PATCH responses strip it. The only moment it is sent is the POST 201 response when a player first signs up.
2. **Never bypass `isAdminAuthed(req)` on protected routes.** Protected routes: `PUT /api/session`, `POST /api/announcements`, `DELETE /api/announcements`, `PATCH /api/players`, `POST /api/claude`, `DELETE /api/admin`.
3. **Never use `Math.random()` for security-sensitive values.** Use `randomBytes` from `crypto`.
4. **Always use `timingSafeEqual` for secret comparisons.** Both PIN verification and cookie verification use it. Length must be checked first (different lengths → short-circuit false, not `timingSafeEqual`).
5. **Admin PIN must be set in production.** `lib/auth.ts` throws if `ADMIN_PIN` is unset in production.
6. **All API inputs must be validated and sanitised server-side.** Name ≤ 50 chars, announcement ≤ 500 chars, prompt ≤ 4000 chars, courts 1–20, maxPlayers 1–100, datetimes validated with `Date.parse()`.
7. **Do not add new external origins to the CSP.** The current policy allows `fonts.googleapis.com` and `fonts.gstatic.com` only. Any new external dependency requires a CSP update in `next.config.js`.
8. **Rate limits protect all mutating public endpoints.** If adding a new public POST/DELETE endpoint, add `checkRateLimit` before any business logic.
9. **Cosmos queries must always filter by `sessionId`.** Without this filter, a query returns data for all sessions (currently there is only one, but the pattern must be maintained).
10. **The Anthropic API key is never sent to the browser.** All Claude calls route through `/api/claude`, which verifies admin auth.

---

## Environment Variables

| Variable | Required | Description |
|----------|----------|-------------|
| `ADMIN_PIN` | Yes (production) | Admin PIN; use 8+ chars with letters and numbers. App throws on startup in production if unset. |
| `ANTHROPIC_API_KEY` | Yes for AI features | Anthropic API key for Claude calls |
| `COSMOS_CONNECTION_STRING` | Yes for persistence | Azure Cosmos DB connection string. If unset, app uses in-memory mock (data lost on restart). |
| `COSMOS_DB_NAME` | No | Cosmos database name. Defaults to `badminton`. |
| `NEXT_PUBLIC_MAX_PLAYERS` | No | Default max players per session. Defaults to `12`. Baked into client bundle at build time. |
| `NEXT_PUBLIC_BASE_PATH` | Yes | Must match `basePath` in `next.config.js`. Currently `/bpm`. Baked into client bundle at build time — must be set at build time, not just at runtime. |

`NEXT_PUBLIC_*` variables are baked into the client bundle at build time. Changing them in Azure App Settings does NOT take effect without a new deployment.

---

## Deployment

### Primary (Automatic)

Every push to `main` triggers `.github/workflows/main_badminton-app.yml`:

1. Checkout, Node 20, `npm ci`
2. `npm run build` with `NEXT_PUBLIC_BASE_PATH=/bpm` and `NEXT_PUBLIC_MAX_PLAYERS=12`
3. `cp -r .next/static .next/standalone/.next/static` — merge static assets into standalone bundle
4. `cd .next/standalone && zip -r ../../standalone-deploy.zip .` — zip with `server.js` at root
5. OIDC login to Azure (no stored secrets, uses federated credentials)
6. `azure/webapps-deploy` uploads the zip to the `Production` slot

All action SHAs are pinned (not floating tags) for supply chain safety.

### Manual Deploy (Fallback Only)

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

**Critical**: `server.js` must be at the zip root. Always zip from inside `.next/standalone/`, not from the project root. Verify: `zipinfo standalone-deploy.zip | grep "server.js"` — must show `server.js`, not `.next/standalone/server.js`.

### Azure Resources

| Resource | Value |
|----------|-------|
| App Service name | `badminton-app` |
| Resource group | `grantzou` |
| Region | Canada Central |
| Tier | Free (F1) — 60 CPU-min/day, no Always On |
| Live URL | `https://badminton-app-gzendxb6fzefafgm.canadacentral-01.azurewebsites.net/bpm` |
| Cosmos DB account | `cosmos-bd` (NoSQL/Core SQL) |
| Cosmos DB | Database `badminton`, 400 RU/s shared throughput |
| Claude model | `claude-sonnet-4-20250514` |

---

## Known Constraints and Gotchas

### Race Condition on Signup
The capacity check (`SELECT count`) and insert are not atomic. Under concurrent load, 1–2 players can exceed `maxPlayers`. Fixing this properly requires Cosmos DB optimistic concurrency (ETags) or a stored procedure — not currently implemented.

### In-Memory Rate Limiter
The `Map`-based rate limiter in `lib/rateLimit.ts` is per-process and resets on server restart. It is not shared across multiple instances. Acceptable for the Free tier (single instance) but would need Redis for multi-instance deployments.

### Cold Starts
The Free (F1) tier idles after ~20 min of inactivity. First request after idle takes 10–20 seconds to wake up. There is no mitigation — this is a free tier constraint.

### No Test Suite
There are currently no unit or integration tests. `npm run lint` (ESLint with `next/core-web-vitals`) is the only automated quality check.

### `NEXT_PUBLIC_*` Variables Are Build-Time Only
Changing `NEXT_PUBLIC_BASE_PATH` or `NEXT_PUBLIC_MAX_PLAYERS` in Azure App Settings does not take effect without a new build and deploy. The GitHub Actions workflow hardcodes these values at build time.

### Single Session Design
`SESSION_ID = 'current-session'` is hardcoded. There is no concept of multiple simultaneous sessions or session history. "Clearing" a session for a new week is done via soft-delete (clearAll) or hard-purge (purgeAll), not by creating a new session record.

### Stale Deployment Cache
If Azure reports success but changes are not visible: always run `rm -rf .next` before building locally, and verify the zip structure before uploading. Check in a private/incognito window to rule out browser cache.

### DatePicker Is a Custom Component
The native `<input type="date">` was replaced with a custom calendar (`components/DatePicker.tsx`) to achieve consistent styling with the glass design. It portal-renders to `document.body` — any changes must account for this and the fact it repositions on scroll.

### Cosmos Firewall
Cosmos DB network access is restricted to Azure datacenters (not public internet). Local dev must use the in-memory mock or configure a VPN/firewall exception.

---

## Rules Before Making Any Change

1. **Read the relevant route handler and any `lib/` files it imports before touching API code.** The auth, rate-limit, and Cosmos patterns are load-bearing — an error in any of them is a security or data-integrity issue.
2. **Check if a shared CSS class already exists in `globals.css` before adding inline styles.** `.section-label`, `.list-header-green`, `.list-header-amber`, `.glass-card`, `.btn-primary`, `.btn-ghost`, `.status-banner-green`, `.status-banner-orange` must be used, not duplicated.
3. **Do not expose `deleteToken` to clients.** Any new query, serialisation path, or API response that includes Player data must strip `deleteToken`.
4. **Capacity checks must exclude both `removed = true` AND `waitlisted = true` records.** The active player count for capacity purposes is: non-removed AND non-waitlisted.
5. **Never hardcode `SESSION_ID`.** Always import it from `lib/cosmos.ts`. Never use a literal string `'current-session'` in queries.
6. **Always use `getContainer(name)` for DB access.** Direct `CosmosClient` usage bypasses the in-memory mock and will break local development.
7. **Do not add `'use server'` or server components.** The entire app is client-side rendered with client components. API routes are the server boundary.
8. **Rate-limit any new public mutating endpoint** (POST, DELETE, PATCH accessible without admin auth) using `checkRateLimit` + `getClientIp`.
9. **New admin-only routes must call `isAdminAuthed(req)` as the first check** and return `unauthorized()` immediately if false.
10. **Test with `npm run lint` before committing.** There is no test suite — lint is the only automated check.
11. **Deployment changes require updating `AZURE.md`** and verifying the GitHub Actions workflow builds correctly with the new change.
12. **Do not add new domains to the CSP** (`next.config.js`) without explicit review — the current policy is intentionally restrictive.
