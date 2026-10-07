# Azure Architecture — Badminton App

Last verified against the repo: 2026-10-07. Rows marked **†** cannot be derived
from anything in this repository; they are what the Azure portal said when
someone last looked, and the "Observed in the portal" section at the end is
where a fresh look gets recorded.

## 1. Architecture Overview

```
                        ┌──────────────────────────────────────┐
                        │   Azure App Service plan (B1 †)      │
  Phones  ─────────────▶│   vnext-badminton-app · 1 instance   │
  bpm.grantzou.com/bpm  │   Next.js standalone · basePath /bpm │
                        └──────────┬───────────────────────────┘
                                   │
                    ┌──────────────┴──────────────┐
                    │                             │
                    ▼                             ▼
        ┌───────────────────────┐    ┌─────────────────────────┐
        │  Azure Cosmos DB      │    │  Anthropic Claude API   │
        │  account cosmos-bd †  │    │  (external, pay-per-use)│
        │  database `badminton` │    │  two model ids, below   │
        │  25 containers        │    │                         │
        └───────────────────────┘    └─────────────────────────┘
```

All browser traffic goes to the App Service. The App Service makes server-side
calls to Cosmos DB (for data persistence) and to the Anthropic API (for AI
features). The Anthropic API key and Cosmos DB connection string are never
exposed to the browser.

**There is ONE deployment.** `main` deploys to production on every push. The
app service's name, `vnext-badminton-app`, is inverted and historical: the
service called `badminton-app` was deleted on 2026-08-25 along with
`deploy-stable.yml`. Verify which app is live by DNS, never by name.
`docs/deployment-model.md` describes the two-deployment topology that preceded
this and is kept as a record.

---

## 2. Azure App Service

| Setting | Value |
|---------|-------|
| Resource name | `vnext-badminton-app` (`deploy-next.yml`) |
| Resource group † | `grantzou` |
| Region † | Canada Central |
| Pricing tier † | B1 Basic (~$13 USD/mo) — Always On enabled |
| Instances † | 1 (the in-memory rate limiter and session-pointer memo assume this; see `CLAUDE.md` Gotchas) |
| Runtime stack | Node.js 22 (`package.json` engines `>=22.22.2`; the workflow builds on 22) |
| Startup | `node server.js` from the standalone bundle |
| Base path | `/bpm` (`basePath` in `next.config.js`; `NEXT_PUBLIC_BASE_PATH` must match) |
| Production URL | `https://bpm.grantzou.com/bpm` (`APP_ORIGIN` in the workflow) |
| Custom domain + certificate † | bound in the portal; expiry not recorded here |

### Build output

`next.config.js` sets `output: 'standalone'`, which produces a self-contained
Node.js server under `.next/standalone/`. The deployment zip bundles:

- `.next/standalone/` — server and all required `node_modules`
- `.next/static/` — hashed client assets, copied in by the workflow
- `public/` — copied in by the workflow (Next does not include it in standalone)

### Deployment — GitHub Actions

One workflow, `.github/workflows/deploy-next.yml`, on every push to `main` and
on manual dispatch:

1. `npm ci` — install from lockfile
2. `npm run typecheck` and `npm test` — the deploy itself gates on both
3. `npm run build` — with `NEXT_PUBLIC_BASE_PATH=/bpm`, `APP_ORIGIN`,
   `NEXT_PUBLIC_ENV=stable` (deliberate: `next` made production render the
   preview banner) and every `NEXT_PUBLIC_FLAG_*` the registry knows
4. copy `.next/static` and `public` into the standalone folder, `cd` into it,
   zip with `server.js` at the zip root
5. `azure/webapps-deploy@v3` to app `vnext-badminton-app`, slot `Production`,
   authenticated with a **publish profile** stored as a repository secret
   (not OIDC; an earlier version of this page said OIDC)
6. `node scripts/smoke-prod.mjs --sha $GITHUB_SHA` — read-only proof that the
   new SHA is serving and that Cosmos is reachable (it reads `_rid` from
   `GET /api/releases`, which stays public under members-only)

All GitHub Actions SHAs are pinned (not floating tags).

**Rollback** is re-dispatching the same workflow at an older commit:
`gh workflow run deploy-next.yml --ref <good-sha>`. Runbook: the
`deploy-promotion` skill. A rollback runs older code against the same live
database, which is why `lib/types.ts` changes are additive-and-optional only.

### Manual deploy (fallback only)

> **Critical**: always `cd` into `.next/standalone` before zipping so that
> `server.js` sits at the zip root. If you zip from the project root the path
> becomes `.next/standalone/server.js` and Azure's `node server.js` startup
> command won't find it — the old deployment keeps running silently.

```bash
rm -rf .next
npm run build
cp -r .next/static .next/standalone/.next/static
cp -r public .next/standalone/public
cd .next/standalone
zip -r ../../standalone-deploy.zip .
cd ../..
az webapp deploy \
  --resource-group grantzou \
  --name vnext-badminton-app \
  --src-path standalone-deploy.zip \
  --type zip
```

Verify zip structure before deploying: `zipinfo standalone-deploy.zip | grep "server.js"` — `server.js` must appear at the root, not under a subdirectory.

### Application Settings (env vars)

`.env.local.example` is the authoritative, annotated list and says which
variables are required in production, which are server-only (changeable in App
Settings without a rebuild) and which are `NEXT_PUBLIC_*` (baked at build time,
so they live in `deploy-next.yml`, not in App Settings). The ones production
cannot run without:

| Variable | Purpose |
|----------|---------|
| `COSMOS_CONNECTION_STRING` | Full Cosmos DB connection string. The only credential the app holds for the database; there is no managed identity (see "Observed in the portal") |
| `COSMOS_DB_NAME` | Database name (defaults to `badminton` if unset) |
| `SESSION_SECRET` | HMAC key for both session cookies. Must be ≥32 chars in production or the app refuses to sign sessions (fail-closed, `lib/auth.ts`) |
| `APP_ORIGIN` | Absolute origin for every outbound link. Required in production; the app never derives it from the request's Host header |
| `ANTHROPIC_API_KEY` | Claude calls |
| `VAPID_PRIVATE_KEY`, `VAPID_SUBJECT` | Web push (server side; the public key is build-time in the workflow) |
| `FCM_SERVICE_ACCOUNT_JSON` | Native push via Firebase; carries a private key |
| `MIGRATION_KEY` | Only on a deployment that has decided to run the multi-group backfill; unset answers 503 |

`ADMIN_PIN` is no longer read anywhere: admin auth has been per-member PIN
since the auth restructure (section 5). Remove it from App Settings when
convenient.

### Security headers

Set globally in `next.config.js` `headers()`:

- `X-Frame-Options: DENY`
- `X-Content-Type-Options: nosniff`
- `Referrer-Policy: strict-origin-when-cross-origin`
- `Permissions-Policy: camera=(), microphone=(), geolocation=()`
- `Strict-Transport-Security: max-age=31536000; includeSubDomains` — `preload`
  is deliberately NOT set (one-way submission; Grant's call)
- `Content-Security-Policy` with `frame-ancestors 'none'`, `base-uri 'self'`,
  `object-src 'none'`, `form-action 'self'` (dev adds `unsafe-eval` for HMR)

`proxy.ts` adds two request guards on every `/api/*` call before any handler:
a 413 for bodies over 256 KB and a 403 for cross-site non-safe methods.

### Networking: outbound to Cosmos

Cosmos is reached over its public endpoint. The account's firewall was set to
"Accept connections from within public Azure datacenters" because the Free
tier had no static outbound IP. **Two things have changed since:** B1 publishes
its outbound IPs (App Service → Properties), and Microsoft's own page says the
datacenters switch admits requests from every Azure customer's subscriptions,
so it is not a meaningful second wall. A valid key is still required. The
narrower options are listing the outbound IPs, or a private endpoint inside a
virtual network. Neither has been done. †

---

## 3. Azure Cosmos DB

| Setting | Value |
|---------|-------|
| Account name † | `cosmos-bd` |
| API | NoSQL |
| Database name | `badminton` (env var `COSMOS_DB_NAME`) |
| Throughput † | 400 RU/s shared across containers — the minimum for a shared database, which covers the first 25 containers. There are exactly 25 |
| Backup mode † | Not recorded. The `deploy-promotion` skill claims 7-day point-in-time restore; nothing in the repo shows it was set or exercised |
| Access † | Primary/secondary keys via connection string; no RBAC role assignments, no managed identity |

### Containers

**`lib/containers.ts` is the registry** (partition key, scope, provisioning per
container) and `__tests__/containers-registry.test.ts` pins it to the source.
`CLAUDE.md` groups them by key. The 25, by partition key:

| Partition key | Containers |
|---|---|
| `/sessionId` | `sessions`, `players`, `announcements`, `skills`, `gameResults` |
| `/memberId` | `events`, `assessments`, `insights`, `playerGear`, `pushSubscriptions`, `drillCompletions`, `stringingJobs` |
| `/id` | `members`, `aliases`, `birds`, `identities`, `authhandoff`, `authmigration`, `feedback`, `releases`, `clubSettings`, `groups` |
| `/groupId` | `memberships` |
| `/recipientMemberId` | `kudos` |
| `/category` | `equipmentCatalog` |

**Six of these keys are inferred, not declared** — `sessions`, `players`,
`announcements`, `members`, `aliases`, `birds` were created by hand in the
portal before `ensureContainer()` existed. The registry records what every call
site assumes. The portal is ground truth; see "Observed in the portal". †

The other 19 are created on first touch by `ensureContainer(name, pk)` in
`lib/cosmos.ts`, memoized per process.

### Session pointer architecture

Sessions are date-keyed (`session-YYYY-MM-DD` for BPM; `${groupId}:session-…`
for any other group). A pointer document per group (`active-session-pointer`
for BPM, `${groupId}:active-session-pointer` otherwise) in the `sessions`
container tracks the current session. `getActiveSessionId(groupId)` reads it,
memoizes it for 5 seconds per process against real Cosmos, and for BPM alone
falls back to `'current-session'` for legacy data.

`POST /api/session/advance` creates a new date-keyed session, copies
`approvedNames`, sets `signupOpen: false`, and updates the pointer. Old sessions
are archived (not deleted).

### Local development fallback

When `COSMOS_CONNECTION_STRING` is not set, `lib/cosmos.ts` activates an
in-memory mock store attached to `global`. The app runs fully offline. The mock
ignores partition keys and filters by parameter name, not SQL — the two traps
`CLAUDE.md` documents at length.

---

## 4. Anthropic Claude API (External)

| Setting | Value |
|---------|-------|
| SDK | `@anthropic-ai/sdk` |
| Models | `PROSE_MODEL = claude-sonnet-5`, `INSIGHT_MODEL = claude-sonnet-4-6` (`lib/aiModels.ts`) |
| Max output tokens | `MAX_OUTPUT_TOKENS = 8192` (`lib/claudeLimits.ts`) |
| Rate limit | `POST /api/claude`: 10 requests/min per IP, before auth |

### Callers

Three routes call the SDK:

- `POST /api/claude` — admin-only prose (announcements, release notes). Uses
  the async `isAdminAuthedWithMember` check, accepting the cost, because it
  spends API budget.
- `GET /api/stats/insight` — the member-facing weekly read on Stats.
- `POST /api/equipment/fit-verdict` — the racket-fit verdict, flag-gated.

The browser never calls Anthropic directly. The shared voice in
`lib/aiPersona.ts` is opt-in per caller (see
`docs/plans/ai-governance-and-docs-accuracy.md`).

---

## 5. Auth Model

Admin auth is **per-player**: a member signs in with their own name and PIN, and
`role: 'admin'` on their Member record (or, with groups on, their membership in
the claimed group) is what authorizes them. It was once a single shared
`ADMIN_PIN` hashed to a static cookie value — that cookie carried no identity,
so it could not be revoked for one person.

1. `POST /api/admin` takes `{ name, pin }`, resolves the member and verifies the
   PIN with `verifyPin` (scrypt) against `member.pinHash`. A name that matches
   nobody is still compared against `FAKE_HASH`, so a wrong name costs the same
   time as a wrong PIN. Every PIN check is also gated by the per-account lock in
   `lib/pinLockout.ts`.
2. On success, sets cookie `admin_session` to a signed payload
   `{ memberId, name, groupId, typ: 'admin', iat, exp }`, HMAC-SHA256 with
   `SESSION_SECRET`. The cookie proves IDENTITY; the Member's role is the
   authorization, so demoting someone revokes them on their next request.
3. Cookie is `HttpOnly`, `SameSite=Lax`, `Secure` in production, **30-day** TTL,
   scoped to path `/bpm`. `Strict` is not an option: the OAuth callback arrives
   as a cross-site navigation and a Strict cookie is silently withheld from it.
4. **Read-only** routes call the sync `isAdminAuthed(req)` — signature, audience
   and expiry only, no Cosmos round trip. **Mutating** routes must
   `await isAdminAuthedWithMember(req)`, which re-reads the Member so a
   demotion or deactivation takes effect on the very next request.
5. `DELETE /api/admin` clears the cookie (logout).

The `typ: 'admin'` claim is load-bearing. The client chooses which cookie name
it sends a value in, so without an audience check any signed-in member could
replay their own `member_session` value as `admin_session` and pass a
signature-only check.

Rate limit on login: **5 attempts / 15 min per client IP**.

> `getClientIp` reads the FIRST entry of `X-Forwarded-For`, which App Service
> overwrites with the address it saw on the socket, **and strips the `:port`
> App Service appends to it**. Do NOT use the last entry — nothing appends after
> Azure, so there is no proxy hop to skip and keying on it would make the limit
> global.
>
> The port matters more than it looks. App Service writes
> `X-Forwarded-For: <client-ip>:<source-port>`, and the source port changes with
> every TCP connection, so keying on the raw entry handed every new connection a
> fresh bucket. Measured 2026-09-13: four separate connections each got a clean
> 30 of a 30/min limit, while 40 requests sharing one connection throttled at
> exactly 30.
>
> **It does NOT read `X-Client-IP`, and that must not be added back.** Azure
> sets no such header, so it does not strip it either; a caller's value arrived
> intact and was trusted ahead of the real one. Measured against production on
> 2026-09-12: one changed byte bought a fresh allowance on every per-IP limit in
> the app. Fixed in #389. `TRUSTED_IP_HEADER` names a single header to trust
> instead, for a deployment behind a different proxy.

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
  POST /api/players  { name, waitlist?: boolean, pin? }
    → per-IP rate limit (10/min; 60/min with members-only on, because the
      per-MEMBER limit of 10/min then does the real work)
    → members-only: must be a signed-in active member; name comes from the
      account and the body's name is ignored
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
  POST /api/admin  { name, pin }
    → rate-limit (5 / 15 min per IP)
    → per-account PIN lock check
    → scrypt verify against member.pinHash (FAKE_HASH on a miss)
    → membership/role check in the claimed group
    → set HttpOnly admin_session cookie
  ← 200 OK
```

---

## 7. Cost Considerations

| Resource | Cost |
|----------|------|
| App Service B1 Basic † | ~$13 USD/month — Always On, dedicated compute, no cold starts |
| Cosmos DB 400 RU/s † | ~$23 USD/month; serverless pricing available for low-traffic |
| Anthropic Claude API | Pay-per-token; low volume |

### Previous tier (for reference)

The app ran on Free (F1) until the cold-start wake time (10–20s) became
disruptive for live-session use. B1 Basic added Always On, which eliminates the
cold start entirely. `staging-badminton-app` still exists on a Free plan, holds
no deployment, and is the natural target for a restore drill.

### Alternative hosting paths

- **Cosmos DB Serverless**: eliminates the ~$23/month baseline, charges per RU
  consumed. Switching means a new account and a data copy; do a restore drill
  first.
- **Vercel (free Hobby tier)**: no cold starts, native Next.js support.

---

## 8. Known Deployment Gotcha

The most common deployment issue is deploying a **stale cached build**:

- Always run `rm -rf .next` before `npm run build`
- Always `cd .next/standalone` before zipping (not from project root)
- Verify the zip has `server.js` at root: `zipinfo standalone-deploy.zip | grep "server.js"`
- Verify the file date is today's date in that output

If Azure reports success but changes aren't visible, confirm with a private/incognito window.

---

## 9. Observed in the portal

Everything marked † above is a claim until someone looks. Record each look
here with the date, so the next reader knows how old the fact is. The five
pages, and what to read on each, are in `docs/plans/infra-baseline.md`.

### 2026-10-07 — not yet observed

| Page | What to read | Observed |
|---|---|---|
| App Service → Custom domains | domain bound; certificate expiry | — |
| Cosmos → Data Explorer → Scale & Settings, six hand-made containers | real partition key of `sessions`, `players`, `announcements`, `members`, `aliases`, `birds` | — |
| App Service → Identity; Cosmos → Keys | system-assigned identity on/off; when keys were last regenerated | — |
| Cosmos → Networking | which access switch is on | — |
| Cosmos → Backup & Restore; App Service → Alerts | Periodic or Continuous; number of alert rules | — |
