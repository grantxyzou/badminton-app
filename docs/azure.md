# Azure Architecture — Badminton App

## 1. Architecture Overview

```
                        ┌─────────────────────────────────────┐
                        │      Azure App Service (B1)         │
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
| Pricing tier | B1 Basic (~$13 USD/mo) — Always On enabled |
| Runtime stack | Node.js 22 LTS (Next.js standalone) |
| Startup command | `node server.js` |
| Base path | `/bpm` (set via `basePath` in `next.config.js`) |
| Live URL | `https://badminton-app-gzendxb6fzefafgm.canadacentral-01.azurewebsites.net/bpm` |

### Build output

`next.config.js` sets `output: 'standalone'`, which produces a self-contained
Node.js server under `.next/standalone/`. The deployment zip bundles:

- `.next/standalone/` — server and all required `node_modules`
- `.next/static/` — hashed client assets

### Deployment — GitHub Actions (primary)

Two workflows share the same build recipe but target different App Services. See `docs/deployment-model.md` for the full runbook.

- **`.github/workflows/deploy-next.yml`** — auto-deploys `main` to `vnext-badminton-app` on every push (preview/testing).
- **`.github/workflows/deploy-stable.yml`** — manual dispatch by tag only, deploys to `badminton-app` (friend-facing).

Both run the same build steps:

1. `npm ci` — install from lockfile
2. `npm run build` — with `NEXT_PUBLIC_BASE_PATH=/bpm`
3. `cp -r .next/static .next/standalone/.next/static` — merge static assets
4. `cd .next/standalone && zip -r ../../standalone-deploy.zip .` — package with `server.js` at zip root
5. OIDC login to Azure (short-lived token, no stored secret)
6. `azure/webapps-deploy@v3` — uploads zip to App Service

All GitHub Actions SHAs are pinned (not floating tags) for supply chain safety.

### Manual deploy (fallback only)

> **Critical**: always `cd` into `.next/standalone` before zipping so that
> `server.js` sits at the zip root. If you zip from the project root the path
> becomes `.next/standalone/server.js` and Azure's `node server.js` startup
> command won't find it — the old deployment keeps running silently.

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

Verify zip structure before deploying: `zipinfo standalone-deploy.zip | grep "server.js"` — `server.js` must appear at the root, not under a subdirectory.

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
| `sessions` | `/sessionId` | Session config + active-session pointer document |
| `players` | `/sessionId` | Per-session player registrations (includes `deleteToken` for self-cancellation auth) |
| `announcements` | `/sessionId` | Admin announcements (session-scoped) |
| `members` | `/id` | Persistent player identity (name, role, sessionCount, lastSeen, stage) |
| `aliases` | `/id` | E-transfer name mappings (global, not session-scoped) |
| `birds` | `/id` | Shuttle purchase inventory (name, tubes, cost, speed, quality, notes) |
| `skills` | `/sessionId` | Per-session ACE skill scores (`name`, `scores: { dimensionId: 0..6 }`). **Bootstrapped lazily** via `ensureContainer()` on first request — see `app/api/skills/route.ts`. |

### Session pointer architecture

Sessions are date-keyed (`session-YYYY-MM-DD`) instead of a single hard-coded ID.
A pointer document (`id = 'active-session-pointer'`) in the `sessions` container
tracks the currently active session. `getActiveSessionId()` reads the pointer and
falls back to `'current-session'` for backward compatibility with legacy data.

`POST /api/session/advance` creates a new date-keyed session, copies `approvedNames`,
sets `signupOpen: false`, and atomically updates the pointer. Old sessions are
archived (not deleted) and queryable via `GET /api/sessions` (admin only).

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

Claude is used for one admin-only feature:
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
  POST /api/players  { name, waitlist?: boolean }
    → rate-limit check (10 req/min per IP)
    → signupOpen check (403 if closed, admin bypasses)
    → deadline check (403 if past, admin bypasses)
    → approvedNames check (403 if name not in list, admin bypasses)
    → duplicate name check (restores soft-deleted record if exists)
    → capacity check (if full and no waitlist flag → 409)
    → create { id, name, sessionId, timestamp, deleteToken, waitlisted? }
    → Cosmos DB players container
  ← 201 { id, name, sessionId, timestamp, deleteToken }
  (client stores deleteToken in localStorage — only time it is sent)
```

### Player self-cancellation (soft delete)

```
Browser
  DELETE /api/players  { name, deleteToken }
    → rate-limit check
    → find player by name
    → verify deleteToken matches stored value
    → upsert with { removed: true, removedAt, cancelledBySelf: true }
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
| App Service B1 Basic | ~$13 USD/month — Always On, dedicated compute, no cold starts |
| Cosmos DB 400 RU/s | ~$23 USD/month; serverless pricing available for low-traffic |
| Anthropic Claude API | Pay-per-token; admin-only, low volume |

### Previous tier (for reference)

The app ran on Free (F1) until the cold-start wake time (10–20s) became disruptive for live-session use. B1 Basic added Always On, which eliminates the cold start entirely. The upgrade is worth the ~$13/mo for any app used during time-sensitive windows.

### Alternative hosting paths

- **Vercel (free Hobby tier)**: no cold starts, native Next.js support, deploys on `git push`
- **Cosmos DB Serverless**: eliminates ~$23/month baseline, charges per RU consumed — a good option if traffic is low

---

## 8. Known Deployment Gotcha

The most common deployment issue is deploying a **stale cached build**:

- Always run `rm -rf .next` before `npm run build`
- Always `cd .next/standalone` before zipping (not from project root)
- Verify the zip has `server.js` at root: `zipinfo standalone-deploy.zip | grep "server.js"`
- Verify the file date is today's date in that output

If Azure reports success but changes aren't visible, confirm with a private/incognito window.
