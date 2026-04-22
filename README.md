# Badminton Session Manager

A Next.js 16 app for managing casual weekly badminton sessions — sign-ups (with invite-list gating), waitlist, payment tracking, session history, and AI-polished announcements.

Deployed to **Azure App Service** (Canada Central, Free tier).
Live URL: `https://badminton-app-gzendxb6fzefafgm.canadacentral-01.azurewebsites.net/bpm`

---

## Features

| Tab | Description |
|-----|-------------|
| **Home** | BPM + date/time tile row, announcements (with dynamic cost-per-person line), sign-up card at the bottom for one-handed thumb reach. 7 sign-up states (open, closed, finished, signed-up, waitlisted, full, deadline-past). |
| **Sign-Ups** | Full player list + waitlist card; self-cancel flow with delete token |
| **Skills** | "Progress together?" placeholder for regular users; admin gets a persistent ACE Skills Matrix radar (7 dimensions × 6 levels), per-player score editing via drag-to-dismiss bottom sheet, and inline Add Player form |
| **Admin** | PIN-gated panel — session/cost editors (two-card split), member/alias management, bird inventory, player admin (paid toggle, promote, restore, history), AI-polished announcements. Hidden by default; revealed via member role or 5-tap easter egg. |

### Additional Features

- **Theme system** — light/dark mode with system preference auto-follow (`ThemeToggle`)
- **Persistent member identity** — `members` collection with admin/member roles
- **Consolidated localStorage identity** — `{ name, token, sessionId }` with stale session detection
- **Dynamic OG image** — branded preview for link sharing (session title, date, player count)
- **ShuttleLoader** — BPM-branded waveform loading animation

---

## Tech Stack

- **Next.js 16** (App Router), TypeScript, Tailwind CSS
- **Recharts** — radar chart for Skills tab
- **Azure Cosmos DB** (NoSQL) — database: `badminton`, 7 containers at 400 RU/s shared throughput
- **Anthropic Claude API** (`claude-sonnet-4-20250514`) — announcement polishing
- **Azure App Service** — Canada Central, B1 Basic tier (Always On), `output: standalone`
- **Vitest** — 245 tests, 29 suites, CI-gated before deploy

---

## Project Structure

```
app/
  api/
    admin/route.ts            GET (auth check) · POST (PIN verify) · DELETE (logout)
    aliases/route.ts          GET · POST · PATCH · DELETE — admin-only e-transfer alias management
    announcements/route.ts    GET · POST · PATCH · DELETE
    birds/route.ts            GET · POST · PATCH · DELETE — shuttle purchase inventory, stock deduction
    claude/route.ts           POST (AI proxy, admin only, rate-limited)
    members/route.ts          GET · POST · PATCH · DELETE — persistent player identity
    players/route.ts          GET · POST · PATCH · DELETE — per-session sign-ups
    session/route.ts          GET · PUT (admin only)
    session/advance/route.ts  POST (admin only) — create next session and archive current
    sessions/route.ts         GET (admin only) — list all archived sessions
    skills/route.ts           GET · POST · PATCH · DELETE — per-session ACE skill scores (lazy container bootstrap)
  globals.css
  layout.tsx
  page.tsx
  opengraph-image.tsx    Dynamic OG image generator
components/
  BottomNav.tsx            Fixed bottom nav (Home, Sign-Ups, Skills, Admin)
  DatePicker.tsx           Custom calendar picker, portal-rendered
  GlassPhysics.tsx         Mouse-tracking CSS var updater for glass card hover effect
  HomeTab.tsx              7-state sign-up card (bottom, thumb zone) + tile row (BPM|Date) + announcement with cost line
  PlayersTab.tsx           Active player list + waitlist card; self-cancel flow
  ShuttleLoader.tsx        BPM waveform loading animation
  SkillsTab.tsx            ACE skill radar entrypoint + add-player form (admin); "Progress together?" (non-admin)
  SkillsRadar.tsx          Recharts radar + solo/overlay mode + drag-dismissable bottom sheet
  ThemeToggle.tsx          Light/dark theme toggle (system preference + localStorage)
  admin/
    AdminDashboard.tsx     Drill-down shell with 3 custom hooks (players, announcements, session nav)
    SessionDetailsEditor.tsx  Two-card split: Session Details + Cost Details, per-person preview
    DateTimeEditor.tsx     Session date/time/deadline editor
    MembersView.tsx        Invite list + e-transfer aliases
    BirdInventoryView.tsx  Shuttle purchase CRUD with stock remaining indicator
    AdvanceSessionForm.tsx Next-week session creation with pointer flip
    SessionContextBar.tsx  Small "Editing · date" pill at top of admin
    VenueSummary.tsx       Venue name + capacity/cost summary pill
    AdminBackHeader.tsx    Consistent back button for drill-down views
    hooks/                 usePlayerManagement, useAnnouncements, useSessionNavigation
lib/
  auth.ts          HTTP-only cookie auth helpers
  birdUsages.ts    normalizeBirdUsages shim (legacy single-object + new array shapes), totalTubes, totalBirdCost
  cosmos.ts        DB connection + session pointer helpers + in-memory mock + ensureContainer for lazy bootstrap
  formatters.ts    Shared fmtDate utility
  identity.ts      Consolidated localStorage identity (getIdentity/setIdentity/clearIdentity)
  rateLimit.ts     In-memory rate limiter (per client IP)
  skills-data.ts   ACE Skills Matrix — 7 dimensions × 6 levels with descriptive text per level
  types.ts         Session, Player, Member, Alias, Announcement, BirdUsage, BirdPurchase, PlayerSkills interfaces
```

---

## Auth Model

- Admin PIN stored in `ADMIN_PIN` env var (use 8+ chars with letters and numbers)
- Login: `POST /api/admin` verifies with `timingSafeEqual`, sets HTTP-only cookie (SHA-256 of `badminton-admin:<PIN>`)
- Cookie: `HttpOnly`, `SameSite=Strict`, `Secure` in production, 8-hour TTL
- Protected routes check cookie via `isAdminAuthed(req)`
- Rate limit on login: 5 attempts / 15 min per **client** IP (reads `X-Client-IP` first — the real client IP on Azure, not the proxy IP)

### Self-cancellation auth

Players get a random `deleteToken` on sign-up (returned once, stored in `localStorage` as part of `badminton_identity`). Cancellation requires the token OR an admin cookie. Prevents anyone who knows a player's name from removing them.

---

## Rate Limits

| Endpoint | Limit |
|----------|-------|
| `POST /api/admin` | 5 req / 15 min per IP |
| `POST /api/claude` | 10 req / min per IP |
| `POST /api/players` | 10 req / min per IP |
| `DELETE /api/players` | 10 req / min per IP |

---

## Environment Variables

| Variable | Description |
|----------|-------------|
| `ADMIN_PIN` | Admin PIN for protected routes |
| `ANTHROPIC_API_KEY` | Anthropic API key |
| `COSMOS_CONNECTION_STRING` | Azure Cosmos DB connection string |
| `COSMOS_DB_NAME` | Database name (default: `badminton`) |
| `NEXT_PUBLIC_MAX_PLAYERS` | Max players per session (default: `12`) |
| `NEXT_PUBLIC_BASE_PATH` | Base path prefix — must match `basePath` in `next.config.js` (currently `/bpm`) |

---

## Local Development

```bash
npm install
# Create .env.local with the required env vars above
npm run dev
# → http://localhost:3000/bpm
```

When `COSMOS_CONNECTION_STRING` is not set, the app uses an in-memory mock store so all routes work offline.

---

## Deployment (Azure App Service)

Two Azure App Services run from the same `main` branch — `bpm-stable` (friend-facing, tag-promoted only) and `bpm-next` (preview, auto-deploys every push). See `docs/deployment-model.md` for the full runbook and `AZURE.md` for the architecture.

```text
git push  →  deploy-next.yml  →  bpm-next App Service (auto, always at HEAD)
git tag + dispatch  →  deploy-stable.yml  →  bpm-stable App Service (manual, by tag)
```

Workflows live at `.github/workflows/deploy-next.yml` and `deploy-stable.yml`. The next pipeline uses a publish profile secret; the stable pipeline uses OIDC. All action SHAs are pinned for supply chain safety.

### Manual deploy (fallback only)

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

---

## API Routes

| Method | Route | Auth | Description |
|--------|-------|------|-------------|
| `GET` | `/api/session` | — | Get active session info |
| `PUT` | `/api/session` | Admin | Update session details |
| `POST` | `/api/session/advance` | Admin | Create next session, archive current |
| `GET` | `/api/sessions` | Admin | List all archived sessions |
| `GET` | `/api/players` | — | List players (deleteToken stripped); `?all=true` and `?sessionId=` admin-only |
| `POST` | `/api/players` | — | Sign up (rate-limited); returns deleteToken once |
| `PATCH` | `/api/players` | Admin | Toggle paid, promote from waitlist, restore |
| `DELETE` | `/api/players` | Token or Admin | Soft-delete player, clearAll, or purgeAll |
| `GET` | `/api/members` | — | List members (admin sees full records, public sees names only) |
| `POST` | `/api/members` | Admin | Create persistent member |
| `PATCH` | `/api/members` | Admin | Update member (name, stage, active) |
| `DELETE` | `/api/members` | Admin | Soft-delete (or hard-delete with `hard: true`) |
| `GET` | `/api/aliases` | Admin | List e-transfer aliases |
| `POST` | `/api/aliases` | Admin | Create alias |
| `PATCH` | `/api/aliases` | Admin | Update alias |
| `DELETE` | `/api/aliases` | Admin | Delete alias |
| `GET` | `/api/announcements` | — | Get announcements (newest first, session-scoped) |
| `POST` | `/api/announcements` | Admin | Post an announcement |
| `PATCH` | `/api/announcements` | Admin | Edit an announcement (sets editedAt) |
| `DELETE` | `/api/announcements` | Admin | Delete an announcement |
| `GET` | `/api/birds` | Admin | List shuttle purchases + current stock (sum across all session birdUsages) |
| `POST` | `/api/birds` | Admin | Create purchase (name, tubes, totalCost, optional speed/quality/notes) |
| `PATCH` | `/api/birds` | Admin | Update purchase; recalculates costPerTube if cost inputs change |
| `DELETE` | `/api/birds` | Admin | Delete purchase |
| `GET` | `/api/skills` | Admin | List per-session skill profiles (supports `?sessionId=` override) |
| `POST` | `/api/skills` | Admin | Upsert by `(sessionId, name)` case-insensitive; 0-6 integer scores |
| `PATCH` | `/api/skills` | Admin | Merge scores into existing record by id |
| `DELETE` | `/api/skills` | Admin | Remove a skill profile |
| `GET` | `/api/admin` | — | Check auth cookie status |
| `POST` | `/api/admin` | — | Verify PIN, set cookie |
| `DELETE` | `/api/admin` | Admin | Logout, clear cookie |
| `POST` | `/api/claude` | Admin | Proxy to Claude AI (rate-limited) |

---

## Security Notes

- All datetimes stored with the admin's local timezone offset so they display correctly for all users
- `DELETE /api/players` requires either the player's own `deleteToken` or an admin cookie — not just a name
- Rate limiter reads `X-Client-IP` (Azure's real client header) — limits are per-person, not global
- Cookie cleared on logout with all security attributes (`HttpOnly`, `Secure`, `SameSite`)
- `NEXT_PUBLIC_BASE_PATH` is baked into the client bundle at build time — set it in `.env.local` for local dev and in Azure App Settings for production
- `approvedNames` gating prevents unknown users from signing up when the invite list is active
- `signupOpen` toggle lets admin control when sign-ups are accepted
- Security headers set in `next.config.js`: CSP, X-Frame-Options, HSTS, X-Content-Type-Options, Referrer-Policy, Permissions-Policy
- All API routes return structured JSON errors — no stack traces or DB schema leaked in production
- Same-origin architecture (no CORS headers needed) — frontend and API share the same App Service

---

## Known Limitations

- **Race condition on signup**: capacity check and insert are not atomic — concurrent signups can exceed `maxPlayers` by 1-2 spots (needs Cosmos DB optimistic concurrency to fix properly)
- **Rate limiter is in-memory**: resets on server restart; not shared across multiple instances (would need Redis for multi-instance)
- **Cosmos DB firewall**: App Service has no static outbound IP — "Allow access from Azure datacenters" is used instead of IP-restricted access
- **Legacy `birdUsage` single-object docs**: still read-tolerated but never written; will migrate to array shape on next admin save per session
