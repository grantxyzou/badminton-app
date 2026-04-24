# Badminton Session Manager

A Next.js 16 app for managing casual weekly badminton sessions — sign-ups (with invite-list gating), waitlist, payment tracking, session history, AI-polished announcements, and a formalized design system.

**Deployed as two App Services from a single `main` branch:**

- `bpm-stable` (friend-facing): https://badminton-app-gzendxb6fzefafgm.canadacentral-01.azurewebsites.net/bpm
- `bpm-next` (preview, auto-deploys `main`): https://vnext-badminton-app-enhcave5djcvafe9.canadacentral-01.azurewebsites.net/bpm

See [`docs/deployment-model.md`](docs/deployment-model.md) for the promotion runbook.

---

## Features

| Tab | Description |
|-----|-------------|
| **Home** | BPM + date/time tile row, announcements (with dynamic cost-per-person line), 7-state sign-up card at the bottom for one-handed thumb reach |
| **Sign-Ups** | Full player list + waitlist card; self-cancel flow via `deleteToken` |
| **Stats** | GitHub-style attendance heatmap with 3M / 6M / 1Y zoom + streak hero (flag-gated via `NEXT_PUBLIC_FLAG_STATS_ATTENDANCE`); compact "Coming soon" cards for cost / partners / skill progression. Admin also gets the full ACE Skills Matrix radar (7 dimensions × 6 levels) with inline score editing + Add Player form as a live card at the bottom |
| **Admin** | PIN-gated — session/cost editors, member/alias management, bird inventory (with runway hero + per-brand grouping + retro-assignable session usage), player admin (paid toggle, promote, restore), markdown-formatted announcements. Hidden by default; revealed via member role or 5-tap easter egg |

### Supporting features

- **Dual-deployment pipeline** — `bpm-next` auto-deploys every push; `bpm-stable` deploys only on tag dispatch
- **Feature flag registry** (`lib/flags.ts`) — staged rollout between next + stable, typed `FlagName` union, `plannedRemoval` date on every flag
- **i18n** — `next-intl` v4, cookie-based locale (`NEXT_LOCALE`), English + Simplified Chinese, `America/Vancouver` datetime formatting on both server and client
- **Theme system** — light/dark with system-preference auto-follow; `data-theme` attribute drives CSS custom properties
- **Persistent member identity** — `members` collection with admin/member roles; consolidated `{ name, token, sessionId }` localStorage
- **Branded chrome** — cold-start splash, `<BpmWordmark />` tempo-dot logo, `<ShuttleLoader />` waveform loading, dynamic OG image for link previews

### Design system

The formalized token bundle lives under [`docs/design-system/`](docs/design-system/) — 43 files mirroring the pristine drop from claude.ai/design: color/type/motion/radii/spacing tokens, 28 preview specimen HTMLs, UI-kit JSX references, and three self-hosted variable fonts.

A hidden **`/bpm/design`** preview route renders the specimen cards live (flag-gated behind `NEXT_PUBLIC_FLAG_DESIGN_PREVIEW`, 404 on stable).

**Locked decisions (in use on live surfaces):**

- **Fonts**: Space Grotesk (display) + IBM Plex Sans (body) + JetBrains Mono (data). Self-hosted variable TTFs via `next/font/local`, loaded from `app/fonts/`.
- **Icons**: Material Symbols Rounded, subsetted to ~43 glyphs (~20 KB vs. ~100 KB full webfont). `.material-icons` class aliased so call-sites stay unchanged.
- **Backgrounds**: `02 Aurora` (3-blob slate-blue + court-green + warm-yellow) on Home / Skills / Admin; `03 Court` (real badminton-doubles proportions, aspect-locked) on Sign-Ups only.

---

## Tech Stack

- **Next.js 16** (App Router, Turbopack), TypeScript, Tailwind CSS
- **next/font/local** for self-hosted variable fonts; `next/font/google` for JetBrains Mono
- **Recharts** — radar chart for Skills tab (dynamic import, `ssr: false`)
- **Azure Cosmos DB** (NoSQL) — database `badminton`, 7 containers at 400 RU/s shared throughput
- **Anthropic Claude API** (`claude-sonnet-4-20250514`) — announcement polishing, admin-only
- **Azure App Service** — Canada Central, B1 Basic tier, `output: standalone`, Always On
- **Vitest** — 316 tests, 39 suites, CI-gated before deploy

---

## Project Structure

```
app/
  api/                     All server-side routes (see API table below)
  design/                  Hidden design-system preview route (flag-gated)
    layout.tsx, page.tsx, _nav.ts
    tokens/, components/, logo/, fonts/, backgrounds/, perf/
  fonts/                   Self-hosted variable TTFs
    SpaceGrotesk-VariableFont_wght.ttf
    IBMPlexSans-VariableFont_wdth_wght.ttf
    IBMPlexSans-Italic-VariableFont_wdth_wght.ttf
  globals.css              All tokens + class utilities (single source of truth)
  layout.tsx               Root shell: splash, aurora stub blobs, toggles, i18n provider
  page.tsx                 SPA tab container (Home / Sign-Ups / Stats / Admin)
  opengraph-image.tsx      Dynamic OG image generator

components/
  BottomNav.tsx            Fixed bottom pill nav (canonical per bundle spec)
  BottomSheet/             Portal primitive with scroll-lock, focus-trap, CSS animation
  BpmWordmark.tsx          "bpm." tempo-dot logo component
  DatePicker.tsx           Portal-rendered calendar popover, RAF-coalesced scroll
  GlassPhysics.tsx         Mouse-tracking CSS var for glass-card hover (touch devices skip)
  HomeTab.tsx              7-state sign-up card + tile row + announcement
  HydrationMark.tsx        Root-mounted; flips html[data-hydrated="true"] to hide splash
  PlayersTab.tsx           Active list + waitlist; court background variant
  ShuttleIcon.tsx          Brand shuttlecock SVG (replaces sports_tennis in empty states)
  ShuttleLoader.tsx        BPM waveform loading animation
  SkillsTab.tsx            ACE radar entrypoint + add-player form
  SkillsRadar.tsx          Recharts radar + drag-dismissable bottom sheet
  ThemeToggle.tsx          Light/dark toggle (system-pref + localStorage)
  admin/                   Admin drill-down components + hooks

docs/
  design-system/           43-file canonical bundle mirror
  deployment-model.md      bpm-stable / bpm-next runbook
  saas-productization-findings.md
  user-research-simulation.md

lib/
  auth.ts                  HTTP-only cookie auth
  birdUsages.ts            normalizeBirdUsages, totalTubes, totalBirdCost
  cosmos.ts                DB connection + mock store + lazy ensureContainer
  flags.ts                 Typed feature-flag registry + isFlagOn helper
  formatters.ts
  identity.ts              Consolidated localStorage identity helpers
  rateLimit.ts             In-memory per-IP rate limiter
  skills-data.ts           ACE Skills Matrix (7 × 6)
  types.ts

public/brand/              SVG + PNG brand assets (shuttlecock, wordmark)
```

---

## Auth Model

- Admin PIN stored in `ADMIN_PIN` env var (use 8+ chars, letters + numbers)
- `POST /api/admin` → verifies with `timingSafeEqual` on SHA-256 hash, sets HTTP-only cookie
- Cookie: `HttpOnly`, `SameSite=Strict`, `Secure` in production, 8-hour TTL
- All admin routes call `isAdminAuthed(req)` before any other logic
- Rate limit on login: **5 attempts / 15 min per client IP** (reads `X-Client-IP` header first — Azure's real-client header — not `X-Forwarded-For` tail)

### Self-cancellation

Players get a random `deleteToken` (16-byte hex) once at sign-up, stored in `localStorage` as part of `badminton_identity`. Cancellation requires the token OR an admin cookie — prevents anyone-who-knows-a-name from removing a player.

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

| Variable | Required | Description |
|----------|:---:|-------------|
| `ADMIN_PIN` | ✓ | Admin PIN (8+ chars, letters + numbers) |
| `ANTHROPIC_API_KEY` | ✓ | Anthropic API key for announcement polishing |
| `COSMOS_CONNECTION_STRING` | — | Full Cosmos DB connection string; omit to use the in-memory mock store |
| `COSMOS_DB_NAME` | — | Database name (default `badminton`) |
| `NEXT_PUBLIC_MAX_PLAYERS` | — | Max players per session (default `12`) |
| `NEXT_PUBLIC_BASE_PATH` | ✓ | Must match `basePath` in `next.config.js` (currently `/bpm`) |
| `NEXT_PUBLIC_ENV` | — | `stable` / `next` / `dev` — drives preview banner + flag defaults |
| `NEXT_PUBLIC_FLAG_DESIGN_PREVIEW` | — | Set to `"true"` to expose `/bpm/design` |
| `NEXT_PUBLIC_FLAG_STATS_ATTENDANCE` | — | Set to `"true"` to flip the Stats-tab Attendance card from skeleton to live heatmap |
| `NEXT_PUBLIC_FLAG_DEMO` | — | End-to-end promotion test flag |
| `NEXT_PUBLIC_FLAG_STAGE0_NEW_NAV` | — | Stage 0a: new bottom nav labels |

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
npm test              # 316 tests, 39 suites
npm run test:watch    # watch mode
npm run build         # production build (static analysis + route compile)
npm run lint          # eslint
```

---

## Deployment

**Push goes to next. Tag goes to stable.**

```text
git push origin main      →  deploy-next.yml    →  bpm-next App Service (auto, always at HEAD)
git tag bpm-stable-v1.X   →  deploy-stable.yml  →  bpm-stable App Service (manual, by tag)
git push --tags
# Then: GitHub Actions → deploy-stable.yml → Run workflow → enter tag
```

Workflows at `.github/workflows/deploy-next.yml` (auto, publish profile) and `deploy-stable.yml` (OIDC, manual dispatch). All action SHAs pinned.

Full runbook + rollback procedure: [`docs/deployment-model.md`](docs/deployment-model.md). Infrastructure details: [`docs/azure.md`](docs/azure.md).

---

## API Routes

| Method | Route | Auth | Description |
|--------|-------|------|-------------|
| `GET` | `/api/session` | — | Active session info |
| `PUT` | `/api/session` | Admin | Update session |
| `POST` | `/api/session/advance` | Admin | Create next session, archive current |
| `GET` | `/api/sessions` | Admin | List archived sessions |
| `GET` | `/api/sessions/costs` | Admin | Recent cost-per-court history |
| `GET` | `/api/players` | — | List players (deleteToken stripped); `?all=true` and `?sessionId=` admin-only |
| `POST` | `/api/players` | — | Sign up (rate-limited); returns deleteToken once |
| `PATCH` | `/api/players` | Admin | Toggle paid, promote from waitlist, restore |
| `DELETE` | `/api/players` | Token or Admin | Soft-delete, clearAll, or purgeAll |
| `GET` | `/api/members` | — | List members (admin sees full records, public sees names only) |
| `GET` | `/api/members/me` | — | Public role lookup for admin tab visibility |
| `POST` `PATCH` `DELETE` | `/api/members` | Admin | Create / update / soft-delete |
| `GET` `POST` `PATCH` `DELETE` | `/api/aliases` | Admin | E-transfer name mappings |
| `GET` | `/api/announcements` | — | Newest first, session-scoped |
| `POST` `PATCH` `DELETE` | `/api/announcements` | Admin | Create / edit / delete |
| `GET` `POST` `PATCH` `DELETE` | `/api/birds` | Admin | Shuttle purchases + stock remaining |
| `GET` `POST` `PATCH` `DELETE` | `/api/skills` | Admin | ACE skill profiles (lazy container bootstrap) |
| `GET` `POST` `DELETE` | `/api/admin` | varies | Auth-check / PIN-verify / logout |
| `POST` | `/api/claude` | Admin | Anthropic proxy (rate-limited) |
| `GET` | `/api/releases` | — | Release-notes feed (user-facing terminal sheet) |

---

## Known Limitations

- **Race condition on sign-up**: capacity check + insert are not atomic — concurrent sign-ups can exceed `maxPlayers` by 1–2 spots. Would need Cosmos DB optimistic concurrency (`_etag`) to fix properly.
- **In-memory rate limiter**: resets on cold start, not shared across instances. Single App Service instance only. Would need Redis for multi-instance.
- **Cosmos DB firewall**: App Service has no static outbound IP → "Allow access from Azure datacenters" is enabled instead of IP-allowlisting.
- **Legacy `birdUsage` single-object docs**: read-tolerated via `normalizeBirdUsages()` but never written; legacy docs get promoted to array shape on next admin save.

---

## Security Notes

- All datetimes stored with ISO 8601 offset; displayed in `America/Vancouver` via `next-intl` `useFormatter`
- `deleteToken` is stripped from every API response after creation (it's only returned once at sign-up)
- Rate limiter reads `X-Client-IP` first (Azure's real-client header); falls back to the first `X-Forwarded-For` entry. Never uses the last entry (that's Azure's proxy IP).
- `NEXT_PUBLIC_*` vars are baked at build time — set in `.env.local` for dev and in Azure App Settings per environment for production
- Security headers (CSP, HSTS, X-Frame-Options, etc.) set in `next.config.js`
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
- [`docs/deployment-model.md`](docs/deployment-model.md) — two-deployment promotion runbook
- [`docs/design-system/`](docs/design-system/) — canonical bundle (tokens, specimens, UI-kit refs)
- [`CHANGELOG.md`](CHANGELOG.md) — what ships to stable, tagged per version
