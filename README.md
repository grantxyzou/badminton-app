# Badminton Session Manager

A Next.js 16 app for casual badminton clubs — sign-ups (with invite-list gating), waitlist, payment tracking, session history, AI-polished announcements, and a formalized design system. Several clubs share one deployment: an account is a person, a membership carries their role in each club, and every club-scoped read is filtered by group (`docs/plans/multi-group.md`). Each club is run by its own organisers; one operator runs the service (`app/legal/privacy`).

**One deployment**: every push to `main` deploys to production at https://bpm.grantzou.com/bpm via `.github/workflows/deploy-next.yml` (the app service is named `vnext-badminton-app`; the name is historical — verify by DNS, never by name). The second App Service was deleted 2026-08-25. Runbook: the `deploy-promotion` skill; history in [`docs/deployment-model.md`](docs/deployment-model.md).

---

## Features

| Tab | Description |
|-----|-------------|
| **Home** | Location + date/time tiles, announcement (with cost-per-person line), the sign-up card — which opens the numbered roster and waitlist, carries per-name kudos and self-cancel — then your balance and stringing status. The Sign-Ups tab folded into this card on 2026-09-16 |
| **Stringing** | Request a restring, pick strings and tension, follow the job; stringers and admins run the queue |
| **Stats** | **You** (AI greeting, skill trend, where you sit in the club, kudos received) · **Play** (your record, who you play with, give kudos) · **Learn** (weekly focus + drills) · **Gear** (racket and strings set-up, fit verdict). Nothing on it counts sessions you missed — the attendance heatmap and streaks were removed in Stage 8 (2026-08-20) |
| **Profile** | Identity, sign-in methods (PIN, Google, Apple, email), push notifications, language and theme, your clubs, account deletion. Admin tools → opens the console |
| **Admin** | Command Center — next session, payments and e-transfer inbox, invites, roster, bird inventory, stringing shop, ledger and metrics, settings. Reached via Profile → "Admin tools →" or `?tab=admin` |

### Supporting features

- **Multi-group** (`NEXT_PUBLIC_FLAG_MULTI_GROUP`) — one account, many clubs; `lib/groupScope.ts` is the only way a route reads a group-scoped container, and a stranger from the store creates their own club from the sign-up page
- **Feature flag registry** (`lib/flags.ts`) — gates unfinished work inside the single deployment, typed `FlagName` union, `plannedRemoval` date on every flag
- **i18n** — `next-intl` v4, cookie-based locale (`NEXT_LOCALE`), English + Simplified Chinese, `America/Vancouver` datetime formatting on both server and client
- **Theme system** — light/dark with system-preference auto-follow; `data-theme` attribute drives CSS custom properties
- **Persistent member identity** — `members` collection with admin/member roles; consolidated `{ name, token, sessionId }` localStorage
- **Branded chrome** — cold-start launch screen (`components/launch/`), `<BpmWordmark />` tempo-dot logo, measured card skeletons while data loads (`components/primitives/CardSkeleton.tsx`; the old `ShuttleLoader` is gone), dynamic OG image for link previews

### Design system

The formalized token bundle lives under [`docs/design-system/`](docs/design-system/) — 48 files mirroring the pristine drop from claude.ai/design: color/type/motion/radii/spacing tokens, 31 preview specimen HTMLs, UI-kit JSX references, and the self-hosted fonts.

A hidden **`/bpm/design`** preview route renders the specimen cards live (flag-gated behind `NEXT_PUBLIC_FLAG_DESIGN_PREVIEW`, 404 in production).

**Locked decisions (in use on live surfaces):**

- **Fonts**: Space Grotesk (display) + IBM Plex Sans (body) + JetBrains Mono (data). Self-hosted subset WOFF2 files via `next/font/local`, loaded from `app/fonts/` — never `next/font/google`, which fetches at build time and fails the deploy when unreachable.
- **Icons**: Material Symbols Rounded, self-hosted and subsetted to 95 glyphs (11.7 KB) from `lib/iconNames.ts` by `scripts/fetch-icon-font.mjs`. `.material-icons` class aliased so call-sites stay unchanged.
- **Backgrounds**: each tab gets a coloured radial-gradient field (Home green, Stringing amber, Stats blue, Profile violet, Admin orange); the `03 Court` motif (real badminton-doubles proportions, aspect-locked) sits under the Stringing field, the Stats dot grid under its own. `02 Aurora` is the default under `/design`.

---

## Tech Stack

- **Next.js 16** (App Router, Turbopack), TypeScript, Tailwind CSS
- **next/font/local** for all four self-hosted faces (no `next/font/google` anywhere; a canary fails the build on one)
- **No charting library** — `recharts` left with the Stage 8 Stats rewrite; Stats draws its bars and trend as inline SVG
- **Azure Cosmos DB** (NoSQL) — database `badminton`, 27 containers (`lib/containers.ts` is the registry), shared throughput (400 RU/s †)
- **Anthropic Claude API** — `lib/aiModels.ts` picks the model per job (`PROSE_MODEL` for announcements and verdicts, `INSIGHT_MODEL` for the Stats greeting); `POST /api/claude` is admin-only
- **Azure App Service** — `output: standalone`; Canada Central, B1 Basic tier, Always On † (portal facts, see `docs/azure.md`)
- **Vitest** — 456 test files, ~4,830 tests (2026-10-08), the required `verify` check on every PR

---

## Project Structure

```
app/
  api/                     All server-side routes (see API table below)
  design/                  Hidden design-system preview route (flag-gated)
    layout.tsx, page.tsx, _nav.ts
    tokens/, components/, logo/, fonts/, backgrounds/, perf/, stats/, level-trend/, racket-render/
  fonts/                   Self-hosted subset WOFF2 faces
    SpaceGrotesk-Subset.woff2
    IBMPlexSans-Subset.woff2
    JetBrainsMono-Subset.woff2
    MaterialSymbolsRounded-Subset.woff2 (+ its manifest)
  globals.css              All tokens + class utilities (single source of truth)
  layout.tsx               Root shell: launch screen, court-bg, toggles, i18n provider
  page.tsx                 Async server component: decides signed-in / signed-out / no-club, then <HomeShell> (Home / Stringing / Stats / Profile, Admin from Profile)
  legal/                   privacy, terms, support, delete-account (server-rendered)
  opengraph-image.tsx      Dynamic OG image generator

components/
  BottomNav.tsx            Fixed bottom pill nav (canonical per bundle spec)
  BottomSheet/             Portal primitive with scroll-lock, focus-trap, CSS animation
  BpmWordmark.tsx          "bpm." tempo-dot logo component
  DatePicker.tsx           Portal-rendered calendar popover, RAF-coalesced scroll
  HomeShell.tsx            'use client' boundary: tab routing, identity, admin gating
  HomeTab.tsx              Sign-up card + tile row + announcement + balance
  home/                    WhoElseIsIn roster, ShuttleBurst, Home cards
  StringingTab.tsx         Stringing requests and job status
  SkillsTab.tsx            Stats entrypoint → StatsV2Shell (You / Play / Learn / Gear)
  stats/                   Stats registers and cards (own CLAUDE.md)
  ProfileTab.tsx           Identity, sign-in methods, settings, clubs
  launch/                  Cold-start launch screen (LaunchScreen) + the lockup it shares with Welcome (LaunchArt)
  onboarding/              SignedOutShell (Welcome / Sign up / Log in / no-club doors), CreateGroupPage, JoinGroupPage
  primitives/              CardHeader, StatusBadge, ListRow, CardSkeleton, Reveal, MemberAvatar …
  ShuttleIcon.tsx          Brand shuttlecock SVG (replaces sports_tennis in empty states)
  ThemeToggle.tsx          Light/dark toggle (system-pref + localStorage)
  admin/                   Command Center cards, pages and hooks

docs/
  design-system/           43-file canonical bundle mirror
  deployment-model.md      HISTORICAL: the two-deployment pipeline retired 2026-08-25
  plans/                   One file per piece of work: intent → decisions → record
  azure.md                 Infrastructure, with portal-only facts marked
  saas-productization-findings.md
  user-research-simulation.md

lib/
  auth.ts                  HTTP-only cookie auth, requireMember (members-only gate)
  containers.ts            The one registry of Cosmos containers, partition keys and scope
  groupScope.ts            The only way a route reads or writes a group-scoped container
  pageGate.ts              decidePage: app / signed-out / no-club, on the server
  birdUsages.ts            normalizeBirdUsages, totalTubes, totalBirdCost
  cosmos.ts                DB connection + mock store + lazy ensureContainer
  flags.ts                 Typed feature-flag registry + isFlagOn helper
  identity.ts              Consolidated localStorage identity helpers
  rateLimit.ts             In-memory per-IP rate limiter
  skills-data.ts           ACE Skills Matrix
  types.ts

public/brand/              SVG + PNG brand assets (shuttlecock, wordmark)
```

---

## Auth Model

- Admin auth is **per-player**: a member signs in with their own name and PIN, and `role: 'admin'` on their Member record is what authorizes them. The shared `ADMIN_PIN` is gone (`ADMIN_NAMES` only bootstraps the first admin)
- `POST /api/admin` → verifies the PIN with `verifyPin` (scrypt) against `member.pinHash`, then sets an HTTP-only cookie carrying a signed `{ memberId, name, groupId, typ: 'admin' }` payload (HMAC-SHA256 over `SESSION_SECRET`)
- Cookie: `HttpOnly`, `SameSite=Lax`, `Secure` in production, **30-day** TTL, scoped to path `/bpm`
- **Read-only** admin routes call the sync `isAdminAuthed(req)`; **mutating** routes `await isAdminAuthedWithMember(req)`, which re-reads the Member so a demotion takes effect on the next request
- Rate limit on login: **5 attempts / 15 min per client IP** — keyed on the first `X-Forwarded-For` entry, which App Service overwrites. `X-Client-IP` is NOT read (see Security Notes)

### Self-cancellation

Players get a random `deleteToken` (16-byte hex) once at sign-up, stored in `localStorage` as part of `badminton_identity`. Cancellation requires the token, OR the row's own member's `member_session` cookie (since 2026-09-29 — the token lives in one browser's storage), OR an admin cookie — prevents anyone-who-knows-a-name from removing a player.

---

## Rate Limits

| Endpoint | Limit |
|----------|-------|
| `POST /api/admin` | 5 req / 15 min per IP |
| `POST /api/claude` | 10 req / min per IP |
| `POST /api/players` | 10 req / min per IP (60 with members-only on, then 10 / min per signed-in member) |
| `DELETE /api/players` | 10 req / min per IP |

---

## Environment Variables

| Variable | Required | Description |
|----------|:---:|-------------|
| `SESSION_SECRET` | ✓ | HMAC secret for both session cookies (≥32 chars); rotating it signs everyone out |
| `ADMIN_NAMES` | — | Bootstraps the first admin(s) by name; BPM only |
| `ADMIN_PIN` | — | LEGACY — no longer read; admins sign in with their own PIN |
| `ANTHROPIC_API_KEY` | ✓ | Anthropic API key for announcement polishing and Stats copy |
| `COSMOS_CONNECTION_STRING` | — | Full Cosmos DB connection string; omit to use the in-memory mock store |
| `COSMOS_DB_NAME` | — | Database name (default `badminton`) |
| `NEXT_PUBLIC_MAX_PLAYERS` | — | Max players per session (default `12`) |
| `NEXT_PUBLIC_BASE_PATH` | ✓ | Must match `basePath` in `next.config.js` (currently `/bpm`) |
| `NEXT_PUBLIC_ENV` | — | `stable` / `next` / `dev` — drives the preview banner only; production is `stable` |
| `NEXT_PUBLIC_FLAG_*` | — | Feature flags; the literal string `"true"` is the only on value. Registry in `lib/flags.ts`, production values in `deploy-next.yml` |
| `SUPPORT_EMAIL` | — | The operator's address on the support and delete-account pages |

The full list, including the OAuth, Apple, FCM and payments keys, is `.env.local.example`.

All `NEXT_PUBLIC_*` vars are **baked at build time** — changes require a rebuild + redeploy.

---

## Local Development

```bash
npm install
cp .env.local.example .env.local   # if provided, otherwise create manually
npm run dev
# → http://localhost:3000/bpm
```

Omit `COSMOS_CONNECTION_STRING` to use the in-memory mock store — all routes work offline.

```bash
npm test              # ~456 test files (vitest, mock store)
npm run test:watch    # watch mode
npm run build         # production build (static analysis + route compile)
npm run lint          # eslint
```

---

## Deployment

**One deployment, trunk-based.** Every merge to `main` deploys to production.

```text
branch → draft PR → `verify` (pr-ci.yml: strict lockfile, lint, tests, build) → merge
merge to main      →  deploy-next.yml  →  vnext-badminton-app (= production, https://bpm.grantzou.com/bpm)
```

`main` is PR-only with no bypass. `deploy-next.yml` deploys with a publish profile and sets `NEXT_PUBLIC_ENV: stable` on purpose. All action SHAs pinned. `deploy-stable.yml` and the second App Service were deleted 2026-08-25; a rollback is a revert merged to `main`.

Runbook + rollback: the `deploy-promotion` skill. Infrastructure: [`docs/azure.md`](docs/azure.md). History of the two-deployment model: [`docs/deployment-model.md`](docs/deployment-model.md).

---

## API Routes

A representative subset — there are ~100 route files under `app/api/` (auth, groups, stringing, payments, ledger, stats, push, kudos …). **With `NEXT_PUBLIC_FLAG_MEMBERS_ONLY` on (production), every club-data `GET` requires a signed-in member**; `__tests__/members-only-coverage.test.ts` classifies each one.

| Method | Route | Auth | Description |
|--------|-------|------|-------------|
| `GET` | `/api/session` | Member | Active session info (404 `no_active_session` for a club with no session yet) |
| `PUT` | `/api/session` | Admin | Update session |
| `POST` | `/api/session/advance` | Admin | Create next session, archive current |
| `GET` | `/api/sessions` | Admin | List archived sessions |
| `GET` | `/api/sessions/costs` | Admin | Recent cost-per-court history |
| `GET` | `/api/players` | Member | List players (deleteToken stripped); `?all=true` and `?sessionId=` admin-only |
| `POST` | `/api/players` | Member | Sign up for the active session (rate-limited); returns deleteToken once |
| `PATCH` | `/api/players` | Admin | Toggle paid, promote from waitlist, restore |
| `DELETE` | `/api/players` | Token, own session, or Admin | Soft-delete, clearAll, or purgeAll |
| `GET` | `/api/members` | Member | The roster (admins see more fields; credentials always stripped) |
| `GET` | `/api/members/me` | — | The adaptive sign-up probe: has this name a PIN, is this device signed in |
| `DELETE` | `/api/members/me` | Member | Self-service account deletion (App Store 5.1.1(v), PIPEDA) |
| `POST` `PATCH` `DELETE` | `/api/members` | Admin | Create / update / soft-delete |
| `GET` `POST` `PATCH` `DELETE` | `/api/aliases` | Admin | E-transfer name mappings |
| `GET` | `/api/announcements` | Member | Newest first, session-scoped |
| `POST` `PATCH` `DELETE` | `/api/announcements` | Admin | Create / edit / delete |
| `GET` `POST` `PATCH` `DELETE` | `/api/birds` | Admin | Shuttle purchases + stock remaining |
| `GET` `POST` `PATCH` `DELETE` | `/api/skills` | Admin | ACE skill profiles (lazy container bootstrap) |
| `GET` `POST` `DELETE` | `/api/admin` | varies | Auth-check / PIN-verify / logout |
| `POST` | `/api/claude` | Admin | Anthropic proxy (rate-limited) |
| `GET` | `/api/releases` | — | Release-notes feed (public: app data, not club data) |

---

## Known Limitations

- **Race condition on sign-up**: capacity check + insert are not atomic — concurrent sign-ups can exceed `maxPlayers` by 1–2 spots. Would need Cosmos DB optimistic concurrency (`_etag`) to fix properly.
- **In-memory rate limiter**: resets on cold start, not shared across instances. Single App Service instance only. Would need Redis for multi-instance.
- **Cosmos DB firewall** †: App Service has no static outbound IP → "Allow access from Azure datacenters" is enabled instead of IP-allowlisting (a portal setting; the repo cannot verify it).
- **Legacy `birdUsage` single-object docs**: read-tolerated via `normalizeBirdUsages()` but never written; legacy docs get promoted to array shape on next admin save.

---

## Security Notes

- All datetimes stored with ISO 8601 offset; displayed in `America/Vancouver` via `next-intl` `useFormatter`
- `deleteToken` is stripped from every API response after creation (it's only returned once at sign-up)
- Rate limiter keys on the **first** `X-Forwarded-For` entry, which App Service overwrites with the address it saw on the socket. Never the last entry — nothing appends after Azure, so keying on it would make the limit global. **`X-Client-IP` is deliberately NOT read**: Azure never set that header, so it arrived caller-controlled, and forging it reset every per-IP limit in the app (fixed in #389). `TRUSTED_IP_HEADER` names one header to trust instead, behind a different proxy.
- `NEXT_PUBLIC_*` vars are baked at build time — set in `.env.local` for dev and in `deploy-next.yml`'s build `env:` for production (App Settings alone do not reach the client bundle)
- Security headers (CSP, HSTS, X-Frame-Options, etc.) set in `next.config.js`; `proxy.ts` adds body-size and cross-site guards on every `/api/*` request
- Same-origin architecture — frontend and API share the same App Service, no CORS needed
- `approvedNames` gates sign-ups when the invite list is active
- `signupOpen` toggle lets admin open/close sign-ups; `session.deadline` enforced server-side
- `POST /api/claude` is admin-only — unauthenticated access would expose the API-key budget

---

## Further reading

- [`CLAUDE.md`](CLAUDE.md) — instructions for AI coding assistants (architecture, conventions, gotchas)
- [`DESIGN.md`](DESIGN.md) — design principles
- [`ROADMAP.md`](ROADMAP.md) — what's shipped, what's staged, what's deferred
- [`docs/azure.md`](docs/azure.md) — infrastructure details
- [`docs/deployment-model.md`](docs/deployment-model.md) — the two-deployment promotion model, retired 2026-08-25 (history)
- [`docs/design-system/`](docs/design-system/) — canonical bundle (tokens, specimens, UI-kit refs)
- [`CHANGELOG.md`](CHANGELOG.md) — what shipped, per version
- [`docs/plans/`](docs/plans/) — intent, decisions and record for each piece of work
- [`docs/OWNER-KB.md`](docs/OWNER-KB.md) — the owner's operating manual

† marks a fact that lives only in the Azure portal and cannot be checked from this repository.
