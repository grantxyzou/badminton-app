# Azure Architecture — Badminton App

Last verified against the repo: 2026-10-11. Rows marked **†** cannot be derived
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
        │  27 containers        │    │                         │
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
convenient; `.env.local.example` still lists the line.

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

Cosmos is reached over its public endpoint, and the account's IP firewall is
ON (read with `az cosmosdb show` on 2026-10-14, §9). What it holds:

- **`0.0.0.0`** — the "Accept connections from within Azure datacenters"
  switch. This is how the APP gets in: `vnext-badminton-app` has no VNet
  integration (`az webapp vnet-integration list` is empty), so its requests
  arrive from Azure's shared ranges and nothing narrower would admit them.
  Microsoft's own page says the switch admits every Azure customer's
  subscriptions, so it is not a meaningful second wall; a valid key is still
  required. The narrower options — listing B1's published outbound IPs, or a
  private endpoint — remain undone.
- **Grant's client IPs, hand-added one at a time** (five as of 2026-10-14,
  all Vancouver ISP addresses that rotate with DHCP). The Data Explorer on the
  NoSQL API sends its data-plane requests from the BROWSER, so each new home
  IP has to be added before the portal can read a container; the symptom is
  "Request originated from IP … blocked by your Cosmos DB account firewall
  settings" on every container. There is no durable fix for that on an IP
  firewall — Microsoft's doc says to add your current IP — only the two
  portal middleware IPs below, which cover the portal's own services.
- **`52.247.163.6`, `52.244.134.181`** — the Azure portal middleware IPs for
  all APIs (added 2026-10-14; Microsoft's current list, replacing the legacy
  `104.42.195.92`-family). They let the portal's server-side features reach
  the account; they do not stand in for the client IP above.
- **One virtual-network rule** on `gzlearnscix/vnet-westus2/snet-westus2-1`
  (service endpoint `Microsoft.AzureCosmosDB`). That subnet belongs to
  another project's resource group and nothing of this app runs in it; the
  rule is a leftover and admits nothing this app uses. Left in place because
  it is not ours to judge.

Adding an address replaces the whole list, so carry every existing entry:

```bash
az cosmosdb update --name cosmos-bd --resource-group grantzou \
  --ip-range-filter "0.0.0.0,<existing…>,<new IP>"
```

Firewall edits take up to 15 minutes to reach the data plane.

---

## 3. Azure Cosmos DB

| Setting | Value |
|---------|-------|
| Account name † | `cosmos-bd` |
| API | NoSQL |
| Database name | `badminton` (env var `COSMOS_DB_NAME`) |
| Throughput | **400 RU/s, on the FREE TIER** (read in the portal 2026-10-15, §9): the `badminton` database holds 400 RU/s shared, the minimum for a shared database, and the account's free tier covers the first 1000 RU/s and 25 GB, so the Cosmos bill is **$0** and was $0 even while `aliases` carried its own 400 RU/s on top (800 total, read 2026-10-14). The fold's win was the two shared slots and the cap headroom, not money — the earlier claim that the dedicated container doubled the bill was wrong, corrected the day the free-tier banner was read. Free headroom now: one more dedicated 400 RU/s container (800 ≤ 1000) costs nothing; a second would bill the 200 RU/s over. **The shared database was at Microsoft's 25-container cap.** The code defined 27 on the day of the reading; in the portal 26 of them sit on the shared throughput and `aliases` is the one dedicated container — created by hand with its own throughput, which is why it does not count against the shared cap. Past 25, a new container can only be added with its own dedicated throughput (another 400 RU/s minimum — free while the account total stays under the free tier's 1000). **2026-10-10: the first create past the cap was refused in production** — the string inventory shipped with a 28th container, `stringStock`, and its admin card failed to load the day it deployed; the portal shows no `stringStock` row, which confirms the refusal. The fix moved those rows into `clubSettings` (`CLAUDE.md`, Cosmos DB convention: a new doc KIND goes into an existing container). **The fold shipped** (`docs/plans/container-fold.md`): `aliases` into `clubSettings`, `feedback` into `releases`, `authmigration` into `authhandoff`. The copy ran in production on 2026-10-15 (14 aliases, 4 reports, zero remaining), the code defines 24, and Grant deleted the three old containers the same day: the database reads 400 RU/s with 23 shared containers, two slots free (§9) |
| Backup mode | **Continuous, 7-day** — the cost export of 2026-10-14 carries a `PITR · Cont 7D Bkup Continuous Backup` meter for `cosmos-bd` (at $0, inside the free tier). Point-in-time restore to any moment in the last week; a restore has still never been exercised |
| Access † | Primary/secondary keys via connection string; no RBAC role assignments, no managed identity |

### Containers

**`lib/containers.ts` is the registry** (partition key, scope, provisioning per
container) and `__tests__/containers-registry.test.ts` pins it to the source.
`CLAUDE.md` groups them by key. The 24, by partition key:

| Partition key | Containers |
|---|---|
| `/sessionId` | `sessions`, `players`, `announcements`, `skills`, `gameResults` |
| `/memberId` | `events`, `assessments`, `insights`, `playerGear`, `pushSubscriptions`, `drillCompletions`, `stringingJobs`, `ledger` |
| `/id` | `members`, `birds`, `identities`, `authhandoff`, `releases`, `clubSettings`, `groups`, `payments` |
| `/groupId` | `memberships` |
| `/recipientMemberId` | `kudos` |
| `/category` | `equipmentCatalog` |

**Five of these keys are inferred, not declared** — `sessions`, `players`,
`announcements`, `members`, `birds` were created by hand in the
portal before `ensureContainer()` existed. The registry records what every call
site assumes. The portal is ground truth; see "Observed in the portal". †

The other 19 are created on first touch by `ensureContainer(name, pk)` in
`lib/cosmos.ts`, memoized per process. `ensureContainer` passes no throughput,
so a container created past the shared database's 25th would be refused unless
the account is exempt (see the Throughput row above).

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
stored value. The admin cookie bypasses the token check, and so does the row's
own member's `member_session` (re-read through `requireGroupMember` and matched
on the row's `memberId`), for members whose token lives in another browser.

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
| App Service B1 Basic | ~$12 USD/month (the 2026-10-14 cost export: $5.64 for 1–14 Oct) — Always On, dedicated compute, no cold starts |
| Microsoft Defender for Cloud, App Service plan protection | **~$13 USD/month, one plan** since 2026-10-14. The 1–14 Oct export billed `Standard Node` on TWO plans, $6.25 each: production's `granxyzou-vnext-bpm` and `asp-grantzou-b0c9`, whose only app was the idle Free-tier `staging-badminton-app`. Grant moved that app onto the production plan and deleted the Free plan the same day, which ends the second charge. Whether to keep Defender on production is still his call (Defender for Cloud → Environment settings → Defender plans → App Service) |
| Cosmos DB 400 RU/s | **$0 — free tier** (first 1000 RU/s and 25 GB; read in the portal 2026-10-15). Would be ~$23 USD/month at list price |
| Anthropic Claude API | Pay-per-token; low volume |

### Previous tier (for reference)

The app ran on Free (F1) until the cold-start wake time (10–20s) became
disruptive for live-session use. B1 Basic added Always On, which eliminates the
cold start entirely. `staging-badminton-app` still exists, holds no deployment,
and is the natural target for a restore drill; since 2026-10-14 it sits on the
production B1 plan (its own Free plan was deleted — see §9, 2026-10-14).

### Alternative hosting paths

- **Cosmos DB Serverless**: charges per RU consumed instead of a provisioned
  baseline. Pointless while the free tier makes the baseline $0; switching
  would mean a new account (free tier is one per subscription and does not
  move) and a data copy, so it is a step backwards today.
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

### 2026-10-14 — Cosmos → Data Explorer, container list (Grant, screenshot)

| What | Observed |
|---|---|
| Containers in `badminton` | the 27 the code defines, and no `stringStock` — the 2026-10-10 create was refused, not slow |
| Throughput per container | every container reads "400 (Shared)" except `aliases`, which reads a bare "400": its own dedicated throughput |
| Account total | **800 RU/s** — the shared 400 plus `aliases`'s 400. Read on the day as two billed minimums; the 2026-10-15 reading below showed the account is on the free tier, so this was $0 |
| Data | 3.69 MB in all; `events` is the largest at 1.48 MB (the usage-metrics rows, 396-day TTL) |

Consequences: §3's throughput row, and §10 item 1 is answered — a 28th
container needs its own throughput and never a free line in the registry. The
partition keys of the five hand-made containers are still unread (the list
page does not show them).

### 2026-10-15 — Cosmos → Data Explorer, after the container fold (Grant, screenshot)

| What | Observed |
|---|---|
| Containers in `badminton` | 24 — `aliases`, `feedback` and `authmigration` deleted by Grant after PR 2 (#619) deployed; the list matches `lib/containers.ts` |
| Database throughput (Scale) | 400 RU/s, manual |
| Free tier | the Scale page's banner: *"With free tier, you will get the first 1000 RU/s and 25 GB of storage in this account for free."* The Cosmos bill is $0, and was $0 at 800 RU/s too |
| Cost estimate shown | $23.36/mo at list price for 400 RU/s — what the free tier is absorbing |

Consequence: the fold bought two shared slots and headroom under the cap, not
money. One dedicated container can be added free (800 ≤ 1000); the shared
database is at 23 of 25.

### 2026-10-14 — App Service: staging moved onto the production plan (Grant, portal, evening Pacific)

| What | Observed |
|---|---|
| `staging-badminton-app` | moved from its own Free plan `ASP-grantzou-b0c9` (F1, Canada Central, Linux) onto `granxyzou-vnext-bpm` (B1, the production plan), via the app's App Service plan blade → Change plan |
| `ASP-grantzou-b0c9` | deleted in the same step (the "delete the unused plan" box) |
| Why | the cost export below billed Defender for App Service `Standard Node` on that plan, $6.25 a fortnight, for an idle Free-tier app. One plan is one Defender charge |

Consequence: the subscription has ONE App Service plan. Staging shares B1 with
production and costs nothing while idle; if it is ever used for a restore
drill, remember it competes with production for the one small instance.

### 2026-10-14 — Cost Management export, subscription, 1–14 Oct (Grant, CSV)

| What | Observed |
|---|---|
| `cosmos-bd` | $0 on every meter (`100 RU/s`, `Data Stored`, continuous 7-day backup): the free tier |
| `granxyzou-vnext-bpm` (production plan) | B1 Linux $5.64 USD; Defender for Cloud `Standard Node` $6.25 |
| `asp-grantzou-b0c9` (the staging slot's plan) | Defender for Cloud `Standard Node` $6.25 — on a plan whose only app is the Free-tier `staging-badminton-app` |
| `vnext-badminton-app` | bandwidth $0.05; a `Free Plan - Linux` meter at $0 |
| Not BPM | `portfolio-fd-prod` (Azure Front Door Standard) $14.80, two Basic container registries in `gzlearnscix` and `rg-migration` $2.17 each, the default Log Analytics workspace $1.15 |
| Subscription total | $38.47 USD ($53.33 CAD) for the fortnight, about $82 USD a month at that rate |

Consequence: the badminton app itself costs about $12 USD a month (B1) plus
pennies of bandwidth; Cosmos is $0. The two Defender charges are the one
BPM-side line worth a decision, and the Front Door base fee is the biggest
line on the subscription and belongs to another project.

### 2026-10-14 — Cosmos → Networking (`az cosmosdb show`, evening Pacific)

| What | Observed |
|---|---|
| Public network access | Enabled, IP firewall on |
| `ipRules` | `0.0.0.0` (Azure datacenters), five of Grant's client IPs (`205.250.77.220`, `207.216.56.95`, `207.216.103.119`, `207.216.101.80`, `206.116.167.17` — the last added that evening after the Data Explorer refused every container from it), and the two portal middleware IPs `52.247.163.6`, `52.244.134.181` (added the same evening) |
| Virtual-network rules | one, `gzlearnscix/vnet-westus2/snet-westus2-1`, another project's subnet |
| App Service VNet integration | none — the app reaches Cosmos through the datacenters switch |
| Private endpoints | none |

Consequence: §2's networking section rewritten — it had said no narrowing was
ever done, which the five client IPs and the VNet rule contradicted.

### 2026-10-07 — not yet observed

| Page | What to read | Observed |
|---|---|---|
| App Service → Custom domains | domain bound; certificate expiry | — |
| Cosmos → Data Explorer → Scale & Settings, six hand-made containers | real partition key of `sessions`, `players`, `announcements`, `members`, `aliases`, `birds` | — |
| App Service → Identity; Cosmos → Keys | system-assigned identity on/off; when keys were last regenerated | — |
| Cosmos → Networking | which access switch is on | — |
| Cosmos → Backup & Restore; App Service → Alerts | Periodic or Continuous; number of alert rules | — |

---

## 10. Multi-group readiness (assessed 2026-10-09)

Grant asked whether the Azure setup suits multi-group. The short answer, from
the repo plus Microsoft's published Cosmos limits: **good enough for the launch
scale of a handful of small clubs, not built for many.** No Azure change is
needed to turn the flag on. Three portal checks are, because hosting other
clubs' data makes the operator responsible for it (`app/legal/privacy`).

**Why multi-group costs nothing in Azure.** A club is a `groupId` field on each
row, not a database or container per club (`docs/plans/multi-group.md`). One
kitchen, one pantry, a club label on every jar. Adding a club adds no
resources, and rollback stays safe because older code reads the field as
unknown.

| Piece | Today | As clubs are added |
|---|---|---|
| App Service, B1, 1 instance † | always on, one small server | Fine for a few clubs. It cannot scale out: the rate limiter (`lib/rateLimit.ts`) and the session-pointer memo live in one process's memory, so a second instance needs a shared store first. |
| Cosmos, 400 RU/s shared † | one throughput budget for every container | Fine at low traffic. Every club's sign-up night draws on the same budget; throttling shows as HTTP 429 from Cosmos. |
| Data shape | club label on each row | Correct for this size. Club-wide aggregates (Metrics, Stats bands) read across partitions and get dearer as clubs grow, but not at tens of clubs. |
| One origin | `bpm.grantzou.com` | Every club shares it, so the link preview (`app/opengraph-image.tsx`) always shows BPM. A per-club card needs a per-club address first. |

**Before the flip — three portal reads** (they extend the walkthrough in
`docs/plans/infra-baseline.md`):

1. **Container count vs the 25 cap — done 2026-10-14 (§9).** The shared
   database is full at 25 (26 shared rows, `aliases` dedicated); the account is
   not exempt, and the 2026-10-10 refusal was the cap. Rule from here: a new
   doc kind goes into an existing container; a genuinely new container is a
   decision made before the code is written — free under the free tier up to
   one dedicated 400 RU/s, a budget line past that.
2. **Backup — answered 2026-10-14 by the cost export:** continuous, 7-day
   point-in-time restore (§3). A restore has still never been tried; that is
   the drill left.
3. **Alerts.** App Service → Alerts: at least one rule on HTTP 5xx. There are
   none known today.

**After the flip — one week of watching:** the `[group-leak]` log line (the
flip's own gate) and Cosmos 429s (Cosmos → Metrics → Total Requests, split by
status code).

**Start the scale work when one of these happens, not before:** Cosmos 429s
on a sign-up night (Cosmos → Metrics → Total Requests by status code); a second
club with real weekly traffic; a feature that needs a partition key no existing
container has. Until then the share-by-kind rule costs nothing and the free
tier makes the database bill $0.

**Only later, if clubs grow into the dozens:** a shared rate-limit store before
a second instance; per-club addresses for per-club previews; a cost review of
provisioned versus serverless Cosmos (a serverless account is a new account and
a data move, not a setting).
