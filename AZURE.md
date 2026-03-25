# Azure Architecture — Badminton App

## 1. Architecture Overview

```
                        ┌─────────────────────────────────────┐
                        │      Azure App Service (F1)         │
  Browser  ────────────▶│  badminton-app  (Next.js standalone) │
                        │  basePath: /bpm                     │
                        └──────────┬──────────────────────────┘
                                   │
                    ┌──────────────┴──────────────┐
                    │                             │
                    ▼                             ▼
        ┌───────────────────────┐    ┌─────────────────────────┐
        │  Azure Cosmos DB      │    │  Anthropic Claude API   │
        │  cosmos-bd (NoSQL)    │    │  (external, pay-per-use)│
        │  Database: badminton  │    │ claude-sonnet-4-20250514│
        └───────────────────────┘    └─────────────────────────┘
```

All browser traffic goes to the App Service. The App Service makes server-side
calls to Cosmos DB (for data persistence) and to the Anthropic API (for AI
features). The Anthropic API key and Cosmos DB connection string are never
exposed to the browser.

---

## 2. Azure App Service

| Setting | Value |
|---------|-------|
| Resource name | `badminton-app` |
| Resource group | `grantzou` |
| Region | Canada Central |
| Pricing tier | Free (F1) |
| Runtime stack | Node.js 20 (Next.js standalone) |
| Startup command | `node server.js` |
| Base path | `/bpm` (set via `basePath` in `next.config.js`) |
| Live URL | `https://badminton-app-gzendxb6fzefafgm.canadacentral-01.azurewebsites.net/bpm` |

### Build output

`next.config.js` sets `output: 'standalone'`, which produces a self-contained
Node.js server under `.next/standalone/`. The deployment zip bundles:

- `.next/standalone/` — server and all required `node_modules`
- `.next/static/` — hashed client assets

### Deployment steps

> **Critical**: always `cd` into `.next/standalone` before zipping so that
> `server.js` sits at the zip root. If you zip from the project root the path
> becomes `.next/standalone/server.js` and Azure's `node server.js` startup
> command won't find it — the old deployment keeps running silently.

```bash
# 1. Clean build (always delete .next first to avoid stale cache)
rm -rf .next
npm run build

# 2. Copy hashed static assets into standalone output
cp -r .next/static .next/standalone/.next/static

# 3. Package — cd INTO standalone so server.js is at the zip root
cd .next/standalone
zip -r ../../standalone-deploy.zip .
cd ../..

# 4. Deploy
az webapp deploy \
  --resource-group grantzou \
  --name badminton-app \
  --src-path standalone-deploy.zip \
  --type zip
```

Deployment takes ~30 seconds. Watch for `Status: Site started successfully.`

### Required Application Settings (env vars)

Set once in Azure Portal → App Service → Configuration → Application settings,
or via CLI:

```bash
az webapp config appsettings set \
  --resource-group grantzou \
  --name badminton-app \
  --settings \
    ADMIN_PIN="<pin>" \
    ANTHROPIC_API_KEY="<key>" \
    COSMOS_CONNECTION_STRING="<connection-string>" \
    COSMOS_DB_NAME="badminton" \
    NEXT_PUBLIC_MAX_PLAYERS="12" \
    NEXT_PUBLIC_BASE_PATH="/bpm"
```

| Variable | Purpose |
|----------|---------|
| `ADMIN_PIN` | Admin PIN — use 8+ chars, mix letters and numbers |
| `ANTHROPIC_API_KEY` | Anthropic API key for Claude calls |
| `COSMOS_CONNECTION_STRING` | Full Cosmos DB connection string |
| `COSMOS_DB_NAME` | Database name (defaults to `badminton` if unset) |
| `NEXT_PUBLIC_MAX_PLAYERS` | Max players per session (default `12`) |
| `NEXT_PUBLIC_BASE_PATH` | Must match `basePath` in `next.config.js` — currently `/bpm` |

### Security headers

Set globally via `next.config.js`:

- `X-Frame-Options: DENY`
- `X-Content-Type-Options: nosniff`
- `Referrer-Policy: strict-origin-when-cross-origin`
- `Permissions-Policy: camera=(), microphone=(), geolocation=()`
- `Strict-Transport-Security: max-age=31536000; includeSubDomains`
- `Content-Security-Policy` (dev adds `unsafe-eval` for HMR; prod does not)

### Firewall note

App Service outbound IPs must be added to the Cosmos DB firewall allowlist,
or "Allow access from Azure datacenters" must be enabled. The Free tier does
not provide a static outbound IP, so the datacenter option is typically used.

---

## 3. Azure Cosmos DB

| Setting | Value |
|---------|-------|
| Account name | `cosmos-bd` |
| API | NoSQL (Core SQL) |
| Database name | `badminton` (env var `COSMOS_DB_NAME`) |
| Throughput | 400 RU/s shared across containers |

### Containers

| Container | Partition Key | Purpose |
|-----------|---------------|---------|
| `players` | `/sessionId` | Player registrations (includes `deleteToken` for self-cancellation auth) |
| `sessions` | `/sessionId` | Session config (title, location, datetime, deadline, courts, maxPlayers) |
| `announcements` | `/sessionId` | Admin announcements |

### Single-session pattern

All documents carry `sessionId = 'current-session'` (the constant `SESSION_ID`
from `lib/cosmos.ts`). Every query filters on this value.

### Local development fallback

When `COSMOS_CONNECTION_STRING` is not set, `lib/cosmos.ts` activates an
in-memory mock store attached to `global`. The app runs fully offline without
any Azure dependency. Mock data is wiped on process restart.

### Firewall

Network access restricted to Azure datacenters. Public internet access is not enabled.

---

## 4. Anthropic Claude API (External)

| Setting | Value |
|---------|-------|
| Provider | Anthropic |
| SDK | `@anthropic-ai/sdk` |
| Model | `claude-sonnet-4-20250514` |
| Max tokens per call | 1024 |
| Rate limit | 10 requests/min per IP (server-side) |

### Usage

Claude is used for two admin-only features:
- **Team generation** — builds balanced court groupings from the player list
- **Announcement polishing** — rewrites draft text into a cleaner message

The browser never calls Anthropic directly. All requests proxy through
`POST /api/claude`, which verifies the admin cookie and enforces the rate limit
before forwarding to Anthropic.

---

## 5. Auth Model

Admin auth uses an HTTP-only cookie:

1. `POST /api/admin` verifies the PIN with `timingSafeEqual`
2. On success, sets cookie `admin_session = SHA-256("badminton-admin:<PIN>")`
3. Cookie is `HttpOnly`, `SameSite=Strict`, `Secure` in production, 8-hour TTL
4. Protected routes call `isAdminAuthed(req)` to verify the cookie
5. `DELETE /api/admin` clears the cookie (logout)

Rate limit on login: **5 attempts / 15 min per client IP**.

> `getClientIp` reads `X-Client-IP` first (Azure's dedicated real-client header),
> falling back to the first entry in `X-Forwarded-For`. Do NOT use the last
> entry — on Azure App Service that is the proxy IP, making the limit global.

### Self-cancellation auth (players)

Players receive a random `deleteToken` when they sign up (returned once in the
POST response, stored client-side in `localStorage`). To self-cancel, they send
this token with the DELETE request. The server verifies the token against the
stored value. Admin cookie bypasses the token check.

---

## 6. Data Flow

### Player sign-up

```
Browser
  POST /api/players  { name }
    → rate-limit check (10 req/min per IP)
    → duplicate name check (Cosmos)
    → capacity check against sessions.maxPlayers
    → create { id, name, sessionId, timestamp, deleteToken }
    → Cosmos DB players container
  ← 201 { id, name, sessionId, timestamp, deleteToken }
  (client stores deleteToken in localStorage — only time it is sent)
```

### Player self-cancellation

```
Browser
  DELETE /api/players  { name, deleteToken }
    → rate-limit check
    → find player by name
    → verify deleteToken matches stored value
    → delete document
  ← 200 { success: true }
```

### Admin login

```
Browser
  POST /api/admin  { pin }
    → rate-limit (5 / 15 min per IP)
    → timingSafeEqual against SHA-256 hash
    → set HttpOnly cookie
  ← 200 OK
```

---

## 7. Cost Considerations

| Resource | Cost |
|----------|------|
| App Service Free (F1) | $0/month — 60 CPU-min/day, no custom domain SSL, shared infra |
| Cosmos DB 400 RU/s | ~$23 USD/month; serverless pricing available for low-traffic |
| Anthropic Claude API | Pay-per-token; admin-only, low volume |

### Free tier caveats

- App idles after ~20 min inactivity → **10–20 s cold start** on first request
- 60 CPU-min/day cap
- No custom domain SSL (HTTPS only on `*.azurewebsites.net`)

### Upgrade path

- **B1 Basic (~$18 CAD/month)**: adds Always On (no cold starts), dedicated compute
- **Vercel (free Hobby tier)**: no cold starts, native Next.js support, deploys on `git push`
- **Cosmos DB Serverless**: eliminates ~$23/month baseline, charges per RU consumed

---

## 8. Known Deployment Gotcha

The most common deployment issue is deploying a **stale cached build**:

- Always run `rm -rf .next` before `npm run build`
- Always `cd .next/standalone` before zipping (not from project root)
- Verify the zip has `server.js` at root: `zipinfo standalone-deploy.zip | grep "server.js"`
- Verify the file date is today's date in that output

If Azure reports success but changes aren't visible, confirm with a private/incognito window.
