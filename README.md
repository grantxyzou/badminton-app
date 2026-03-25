# Badminton Session Manager

A Next.js 14 app for managing casual badminton sessions — sign-ups, team generation via Claude AI, and session announcements.

Deployed to **Azure App Service** (Canada Central, Free tier).
Live URL: `https://badminton-app-gzendxb6fzefafgm.canadacentral-01.azurewebsites.net/bpm`

---

## Features

| Tab | Description |
|-----|-------------|
| **Home** | Session info (date, location, deadline), sign up or view the sign-up list, announcements |
| **Players** | Full sign-up list with the game date as the card header |
| **Teams** | Generate balanced doubles teams using Claude AI (admin only) |
| **Admin** | PIN-gated panel — edit session details, manage players, post AI-polished announcements |

---

## Tech Stack

- **Next.js 14** (App Router), TypeScript, Tailwind CSS
- **Azure Cosmos DB** (NoSQL) — database: `badminton`, 3 containers at 400 RU/s shared throughput
- **Anthropic Claude API** (`claude-sonnet-4-20250514`) — team generation and announcement polishing
- **Azure App Service** — Canada Central, Free tier, `output: standalone`

---

## Project Structure

```
app/
  api/
    admin/route.ts          GET (auth check) · POST (PIN verify) · DELETE (logout)
    announcements/route.ts  GET · POST · DELETE
    claude/route.ts         POST (AI proxy, admin only, rate-limited)
    players/route.ts        GET · POST · DELETE (self-cancel with token, or admin cookie)
    session/route.ts        GET · PUT (admin only)
  globals.css
  layout.tsx
  page.tsx
components/
  AdminTab.tsx
  BottomNav.tsx
  DatePicker.tsx
  HomeTab.tsx
  PlayersTab.tsx
  TeamsTab.tsx
lib/
  auth.ts          HTTP-only cookie auth helpers
  cosmos.ts        DB connection + SESSION_ID + in-memory mock for local dev
  rateLimit.ts     In-memory rate limiter (per client IP)
  types.ts         Shared TypeScript interfaces
```

---

## Auth Model

- Admin PIN stored in `ADMIN_PIN` env var (use 8+ chars with letters and numbers)
- Login: `POST /api/admin` verifies with `timingSafeEqual`, sets HTTP-only cookie (SHA-256 of `badminton-admin:<PIN>`)
- Cookie: `HttpOnly`, `SameSite=Strict`, `Secure` in production, 8-hour TTL
- Protected routes check cookie via `isAdminAuthed(req)`
- Rate limit on login: 5 attempts / 15 min per **client** IP (reads `X-Client-IP` first — the real client IP on Azure, not the proxy IP)

### Self-cancellation auth

Players get a random `deleteToken` on sign-up (returned once, stored in `localStorage`). Cancellation requires the token OR an admin cookie. Prevents anyone who knows a player's name from removing them.

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

See `AZURE.md` for the full architecture and environment setup.

Deployment is automatic via GitHub Actions — every push to `main` builds and deploys.

```
git push  →  GitHub Actions builds standalone →  deploys to Azure App Service
```

The workflow lives at `.github/workflows/main_badminton-app.yml`. It uses OIDC (federated credentials) — no long-lived secrets. All action SHAs are pinned for supply chain safety.

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
| `GET` | `/api/session` | — | Get current session info |
| `PUT` | `/api/session` | Admin | Update session details |
| `GET` | `/api/players` | — | List all players (deleteToken stripped) |
| `POST` | `/api/players` | — | Sign up; returns deleteToken once |
| `DELETE` | `/api/players` | Token or Admin | Remove a player |
| `GET` | `/api/admin` | — | Check auth cookie status |
| `POST` | `/api/admin` | — | Verify PIN, set cookie |
| `DELETE` | `/api/admin` | Admin | Logout, clear cookie |
| `GET` | `/api/announcements` | — | Get all announcements (newest first) |
| `POST` | `/api/announcements` | Admin | Post an announcement |
| `DELETE` | `/api/announcements` | Admin | Delete an announcement by ID |
| `POST` | `/api/claude` | Admin | Proxy to Claude AI |

---

## Security Notes

- All datetimes stored with the admin's local timezone offset so they display correctly for all users
- `DELETE /api/players` requires either the player's own `deleteToken` or an admin cookie — not just a name
- Rate limiter reads `X-Client-IP` (Azure's real client header) — limits are per-person, not global
- Cookie cleared on logout with all security attributes (`HttpOnly`, `Secure`, `SameSite`)
- `NEXT_PUBLIC_BASE_PATH` is baked into the client bundle at build time — set it in `.env.local` for local dev and in Azure App Settings for production

---

## Known Limitations

- **Race condition on signup**: capacity check and insert are not atomic — concurrent signups can exceed `maxPlayers` by 1-2 spots (needs Cosmos DB optimistic concurrency to fix properly)
- **Rate limiter is in-memory**: resets on server restart; not shared across multiple instances (would need Redis for multi-instance)
- **Free tier cold starts**: first request after ~20 min idle takes 10–20 s to wake up
