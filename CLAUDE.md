# CLAUDE.md — Badminton Session Manager

## Purpose

Mobile-first web app for managing casual weekly badminton sessions. Players sign up (or join waitlist when full), admin manages sessions, players, payments, and announcements. Built for "BPM Badminton", deployed on Azure App Service B1 tier at `/bpm`. Sessions are date-keyed and archived.

## Quick Start

```bash
npm install
npm run dev   # → http://localhost:3000/bpm
```

Omit `COSMOS_CONNECTION_STRING` from `.env.local` to use the in-memory mock store (all routes work offline). See `.env.local.example` for all env vars.

`NEXT_PUBLIC_*` vars are baked at build time — changes require rebuild + redeploy.

## Key Architecture

### Single-Page App
`app/page.tsx` is the only browser route. Tabs: Home, Sign-Ups, Skills (admin-functional, "Coming Soon" placeholder for non-admins), Admin. All data via API routes under `app/api/`. Every fetch uses `{ cache: 'no-store' }`.

### Session Pointer
Sessions are date-keyed (`session-YYYY-MM-DD`). A pointer document (`id: 'active-session-pointer'`) tracks the current session. **Always use `getActiveSessionId()`** — never `SESSION_ID` directly (legacy compat only). The pointer falls back to `'current-session'` if no pointer doc exists — do not remove this fallback.

### Auth
- Admin: HTTP-only cookie via PIN, validated with `timingSafeEqual`. All admin routes call `isAdminAuthed(req)`.
- Player self-cancel: `deleteToken` (random 16 bytes hex) returned once at sign-up, stored in `localStorage`, validated server-side.

### Soft Delete
Players are never hard-deleted by default (`removed: true` + `removedAt`). `?all=true` (admin only) includes removed. Admins restore via `PATCH { removed: false }` — capacity-checked.

### Waitlist
Full session + `POST { waitlist: true }` → `waitlisted: true`. Promote via `PATCH { waitlisted: false }` — capacity-checked.

### Invite List
`session.approvedNames` — when non-empty, `POST /api/players` enforces case-insensitive name match (403 otherwise). Admins bypass.

### Sign-Up Gating
`session.signupOpen` (boolean) — `false` blocks non-admin sign-ups. New sessions via advance always start `signupOpen: false`. `session.deadline` enforced server-side.

### Stats Tab
Bottom-nav "Stats" (formerly "Skills"; `nav.skills` i18n key kept for backcompat). Non-admin and admin both see the same layout: live content up top, compact "Coming soon" cards in a 2-col grid at the bottom. `StatsPlaceholder` accepts three slots — `heroSlot` (streak hero), `attendanceContent` (live heatmap), `skillProgressionContent` (admin-only SkillsRadar, lands below the grid full-width). Per-card flags determine which slot is filled; slot absence falls back to the compact skeleton card.

- **Live Attendance** is flag-gated behind `NEXT_PUBLIC_FLAG_STATS_ATTENDANCE`. `AttendanceCardLive` resolves an active name from three sources in order: `badminton_identity` (real player), `badminton_stats_preview_name` (admin/anon picker selection), or fallback to the autocomplete picker. The preview-name key is intentionally separate from the real identity so picking a name for stats viewing doesn't give a fake `deleteToken` or muddy self-cancel semantics.
- **Attendance heatmap** — `AttendanceHeatmap` is a pure-SVG 7×N grid (7 rows = day-of-week, N columns = weeks). Solid accent = attended, outlined = missed session, empty = no session that day. Zoom 3M/6M/1Y swaps the `weeks` query param; API clamps to [1, 260].
- **Streak hero** — `StatsStreakHero` fetches 52 weeks and shows a personal-best flame state when `streak >= longestStreak && streak >= 3`. Hidden when streak is 0. Renders above the card grid via `heroSlot`.

### Design System
Canonical bundle mirrored at `docs/design-system/` (43 files — tokens, 28 specimen HTMLs, UI-kit JSX refs, self-hosted fonts). `app/globals.css` is the **single source of truth** for tokens in the running app; the docs folder is pristine reference only (never imported).

- **Fonts**: Space Grotesk (display — h1/h2/h3, wordmark, splash) + IBM Plex Sans (body — `var(--font-sans)`) + JetBrains Mono (data — `var(--font-mono)`). Self-hosted variable TTFs in `app/fonts/`, loaded via `next/font/local`. Italic variant wired for IBM Plex.
- **Icons**: `.material-icons` class aliased to Material Symbols Rounded, subsetted to ~43 glyphs via Google Fonts `icon_names=` param (~20 KB). New glyphs must be added to the URL in `app/layout.tsx` — missing glyphs render as raw text (e.g. `EXPAND_LESS`) instead of failing loud.
- **Backgrounds** live on the `.court-bg` element (rendered once in root layout). `02 Aurora` (3 blobs with transform-only animation) is the default; `03 Court` (real badminton-doubles proportions, aspect-locked via `aspect-ratio: 100/220` + `background-size: contain`) activates on Sign-Ups via `html[data-tab="players"]` selectors.
- **Preview route** at `/bpm/design` (7 sub-pages, flag-gated behind `NEXT_PUBLIC_FLAG_DESIGN_PREVIEW`). Not linked from BottomNav.
- **Corner radii ladder** — rectangular surfaces capped at **16px**. 6/8/10/12/16 for rect; 100px for pill. Glass-card was at 24px historically (self-inflicted spec violation); now 16.

## Coding Conventions

- **Components**: PascalCase files, default export. **Lib**: camelCase files.
- **API routes**: `export async function GET/POST/PATCH/DELETE(req: NextRequest)`
- **CSS**: Use named classes from `globals.css` for shared patterns. No hard divider lines between list items. New shared patterns go in `globals.css`.
- **Segment controls**: Use `.segment-control` / `.segment-tab-active` / `.segment-tab-inactive` classes.
- **IDs**: Always `randomBytes` from `crypto` — never `Math.random()`.
- **Datetimes**: ISO 8601 with timezone offset via `withLocalTz(date, time)`. Never store plain `YYYY-MM-DDThh:mm:00`.
- **Session IDs**: `sessionIdFromDate(iso)` → `'session-YYYY-MM-DD'`. Legacy `'current-session'` exists in prod.
- **Cosmos DB**: Use `getContainer(name)`. **Containers**: `sessions` (PK `/sessionId`), `players` (PK `/sessionId`), `announcements` (PK `/sessionId`), `members` (PK `/id`), `aliases` (PK `/id`), `birds` (PK `/id`), `skills` (PK `/sessionId`). Always filter by `sessionId` on `players`, `announcements`, `skills`. `aliases`, `birds`, `members` are global (no sessionId filter).
- **Cosmos `item()` calls**: `container.item(docId, partitionKeyValue)` — the second arg is the partition key VALUE, not the doc ID. The mock store ignores partition keys, so wrong values only break in production. Always use the correct partition key (e.g., `sessionId` for skills/players containers).
- **New containers** must use `ensureContainer(name, partitionKeyPath)` from `lib/cosmos.ts` on first handler call — real Cosmos doesn't auto-create containers the way the mock does. See `app/api/skills/route.ts` for the lazy-promise pattern.
- **Bird usages**: `session.birdUsages` is an array of `BirdUsage` objects. Legacy single-object `session.birdUsage` is read-tolerated via `normalizeBirdUsages()` in `lib/birdUsages.ts` but never written. Next admin save promotes legacy docs to array shape.
- **React `{0 && ...}` renders `0`**: Never use a numeric value as the left side of `&&` in JSX. Use `(value ?? 0) > 0` or `!!value` to get a boolean. This applies to `perPersonCost`, `prevCostPerPerson`, player counts, etc.
- **Cost inputs use `null` for empty**: `costPerCourt` form state is `number | null`. Empty input = `null`, displayed as placeholder "None". Send `0` to the API when null (API validates `typeof === 'number'`). The `$` prefix appears dynamically when value > 0.
- **Errors**: API returns `NextResponse.json({ error }, { status })`. Client shows `<p className="text-red-400 text-xs" role="alert">`.
- **Theme**: `data-theme` on `<html>`, CSS custom properties in `globals.css`. Prefer existing Tailwind classes with light-mode overrides.
- **localStorage**: `badminton_identity` (JSON: `{ name, token, sessionId }` — use `lib/identity.ts` helpers), `badminton_theme`

## Security Rules

1. **`deleteToken` never in responses.** Strip after any GET/PATCH: `const { deleteToken: _dt, ...safe } = record`.
2. **`timingSafeEqual` for all secret comparisons.** Never `===` for PINs or cookies.
3. **Auth before DB.** `isAdminAuthed(req)` at top of every admin route, before body parsing.
4. **Rate limit before auth.** Rate limiting first in handler so it can't be bypassed.
5. **`POST /api/claude` is admin-only.** Unauthenticated access would expose API key budget.
6. **`getClientIp(req)` for IP.** Reads `X-Client-IP` then `X-Forwarded-For`. Never `req.ip` (returns Azure proxy IP).
7. **`sessionId` override is admin-only.** Gate `?sessionId=` and body `sessionId` with auth check.
8. **Capacity-check restores and promotions.** `removed: false` or `waitlisted: false` must check active count first → 409 if full.
9. **`purgeAll: true` is irreversible.** Hard-deletes all records including soft-deleted.
10. **Aliases require admin auth.** E-transfer names are sensitive payment data.
11. **PIN comparison hashes first.** `admin/route.ts` hashes both PIN and admin PIN to SHA-256 before `timingSafeEqual` to avoid leaking PIN length via timing.

## Gotchas

- **Race condition on signup**: Capacity check + insert not atomic. Can exceed `maxPlayers` by 1-2 spots.
- **In-memory rate limiter**: Resets on cold start. Single-instance only.
- **Cold starts**: ~10-20s wake after 20min idle (Free tier).
- **`NEXT_PUBLIC_BASE_PATH` must match `basePath`**: Both must be `/bpm` or API fetches 404.
- **`endDatetime` is optional**: May be absent in legacy records. Guard with `session?.endDatetime ? ... : false`.
- **`signupOpen` defaults to open**: Absent = open. New sessions via advance start closed.
- **Announcements are session-scoped**: Advancing hides old announcements.
- **DatePicker is custom**: Portal-rendered to escape `backdrop-filter` stacking. Don't replace with native.
- **4 tabs**: Home, Sign-Ups, **Stats**, Profile. Admin reachable via Profile → "Admin tools →" or `?tab=admin` deep link. (Tab id is still `'skills'` for backcompat; the `nav.skills` i18n key renders "Stats" / "数据".) Both admin and non-admin see `<StatsPlaceholder />` — compact coming-soon cards for most slots, live Attendance heatmap when `NEXT_PUBLIC_FLAG_STATS_ATTENDANCE` is on, admin gets the SkillsRadar + Add Player form as a full-width live card at the bottom.
- **Auth taxonomy** (since 2026-04-30): three distinct concepts.
  - **Sign up** = register for the active session. HomeTab anonymous form is name-only. PIN-protected members get 401 `pin_required` → client auto-opens RecoverySheet.
  - **Create account** = identity creation (name + PIN). Profile → "Create an account" sheet. POSTs `{ name, pin, sessionSignup: false }`. Refuses with 409 `account_exists` if a member already has a `pinHash` (prevents account hijack).
  - **Sign in** = name + PIN auth. Profile inline form OR HomeTab "Already a player?" link → RecoverySheet. POST `/api/players/recover` falls back to `members.pinHash` when no session player exists, auto-creating a session player on open + capacity. Constant-time miss against `FAKE_HASH`. Rate-limited 5/hr per `(name, IP)`.
  - PINs scrypt-hashed via `lib/recoveryHash.ts`. Lost-device admin code via `POST /api/players/reset-access` (10/hr per IP, 6-digit, 15-min TTL — in-memory `lib/recoveryCodes.ts`, does NOT survive cold starts).
  - Profile signed-in: PIN management lives in Settings as `New PIN` / `Update PIN` row → opens `RecoveryPinSheet` (Set/Change only — no Remove). Status sourced from `/api/members/me?name=X` returning `hasPin`, refetched on identity change.
  - **`ForcePinModal` is no longer mounted** — PIN is opt-in. The component file remains for reference but `app/page.tsx` does not render it.
  - **Admin login**: per-player auth via name + own PIN (`POST /api/admin`); cookie HMAC-signed via `SESSION_SECRET`. `member.role === 'admin'` required. Bootstrap names via `ADMIN_NAMES` env var.
- **`pinHash` is a strip-canary**: like `deleteToken`, it must be removed from every GET/PATCH/POST player response. The strip pattern in `app/api/players/route.ts` destructures both fields. New endpoints that return player records must mirror this — search for `pinHash: _ph` to find existing strip sites.
- **SkillsRadar uses recharts**: Imported with `dynamic(() => import(...), { ssr: false })` because recharts requires `window`.
- **Bottom sheet primitive**: Use `<BottomSheet>` from `components/BottomSheet/` for any new sheet/drawer. It handles portal mount, body scroll lock, focus trap, Escape-to-close, and CSS-driven animation (180ms ease-out-quart). Inline `zIndex: 60` (sheet only — no backdrop, no backdrop-tap dismiss). Pass `maxHeight="75vh"` for taller sheets (default 80vh). Consumers: `ReleaseNotesSheet`, `SkillsRadar`'s `SkillDetailSheet`, `AssignUsageSheet`, `RecoverySheet`, `EnterCodeSheet`, `CreateAccountSheet`, `RecoveryPinSheet`. DatePicker is NOT a bottom sheet (popover anchored to an input).
- **Sheet body lock**: Use `position: fixed` on `<body>` (handled inside `useBodyScrollLock`). Plain `overflow: hidden` doesn't stop iOS rubber-band / pull-to-refresh. The `<BottomSheet>` primitive applies this automatically while open.
- **HomeTab card order** is deliberately context-on-top, action-on-bottom for one-handed thumb reach: `BPM|Date tile row → CostCard → Announcement → Sign-Up card → PrevPaymentReminder`. Don't flip this back without a reason.
- **Cost per person** renders as a standalone `<CostCard />` between the tile row and the Announcement card. Visibility is gated on `showCostBreakdown && perPersonCost > 0 && datetime` — independent of announcement presence (research finding 4.7).
- **Previous session snapshot**: `session.prevSessionDate` and `session.prevCostPerPerson` are frozen at advance time. `<PrevPaymentReminder />` renders below the sign-up card, gated on `hasIdentity` (not `isSignedUp`) — so players who played last week still see what they owe even before signing up for the next session (research finding 4.8). `hasIdentity` must be kept in sync with `setIdentity` / `clearIdentity` call sites. Not live-updated if the archived session is edited later.
- **Cold-start splash**: Pre-hydration splash lives in `app/layout.tsx` (pure HTML in the server component body). `<HydrationMark />` is mounted in the **root layout** (`app/layout.tsx`, not `app/page.tsx`) so it fires on every route including `/design/*` — not just the SPA index. Sets `html[data-hydrated="true"]` on mount; CSS hides the splash via that selector. A 5.4s CSS-keyframe failsafe also fades the splash if hydration stalls silently. Splash uses `var(--page-bg)` so it honors the current theme.
- **Per-tab backgrounds**: `app/page.tsx` writes `document.documentElement.setAttribute('data-tab', activeTab)` via a `useEffect` on every tab change. CSS rules under `html[data-tab="players"]` swap the global aurora for the 03 Court pattern (only on Sign-Ups). Home / Skills / Admin keep the 3-blob aurora. Add future per-tab variants via the same mechanism — no component changes needed.
- **Design-system cascade trap**: Do NOT import `docs/design-system/colors_and_type.css` anywhere in the app. Its `:root` block re-asserts dark-mode tokens and shadows `app/globals.css`'s `[data-theme="light"]` overrides (same specificity, later-wins). `globals.css` is the single source of truth for tokens; the docs file is the pristine bundle reference only.
- **Component tests need `afterEach(cleanup)`**: Per-file `// @vitest-environment jsdom` docblock enables component tests, but Vitest globals aren't configured — so `cleanup()` from `@testing-library/react` must be called manually between cases when multiple tests render overlapping text. See `__tests__/components/PrevPaymentReminder.test.tsx` for the pattern.
- **DevPanel**: Add `?dev` to the URL to show a floating control panel for testing UI states (cost visibility, payment reminder, signed-up status, player count). Controls override real API data. Only active when `?dev` is in the URL.
- **Advance form shows success toast**: 1.2s green banner before `onBack()`. Don't remove the delay — it's intentional user feedback.
- **`.azure/` is gitignored**: Never commit.
- **Mock store**: Test without DB by omitting `COSMOS_CONNECTION_STRING`. Verify mock query filters match real Cosmos queries.
- **i18n is cookie-based, not URL-based**: `NEXT_LOCALE` cookie drives the locale. `proxy.ts` (formerly `middleware.ts`, renamed in Next 16) sets it on first visit from `Accept-Language`; `LanguageToggle` writes it on tap. Cookie `path` must be `/bpm` (matches `basePath`) — not `/`.
- **Server reads cookie, client writes cookie**: never use `navigator.language` or `localStorage` for locale — it will desync server and client and cause hydration mismatches. Always go through `useLocale()` on client and `getLocale()` on server.
- **Missing translation keys fall back to English**: `i18n/request.ts` deep-merges `messages/en.json` under the active locale, so a missing `zh-CN` key renders the English string rather than throwing. Do not rely on throwing behavior for "missing translation" detection — use the `canary-strings.test.tsx` assertion pattern.
- **next-intl HMR is sticky on new top-level branches**: editing existing keys in `messages/*.json` hot-reloads cleanly, but adding a brand-new top-level namespace (e.g. `admin.resetAccess`, `signup.pinPrompt`) sometimes leaves the running dev server with the old in-memory message tree, so `useTranslations('that.new.path')` throws `MISSING_MESSAGE` even though the key exists in the file. **Restart the dev server after adding any new namespace branch.** `pkill -f next-server` alone races with the next `npm run dev` (the new instance sees port 3000 still bound and exits). The reliable pattern: `ps aux | grep next-server` to find the PID, then `kill -9 <pid>`, then `npm run dev`. Editing nested keys inside an already-loaded namespace doesn't have this problem.
- **Rich-text strings use `t.rich`, not `t`**: any message containing `<tag>...</tag>` must be rendered via `t.rich('key', { tag: (chunks) => <Component>{chunks}</Component> })`. Using plain `t()` on a rich-text key prints the raw `<tag>` characters.
- **Component tests need a provider wrapper**: components that call `useTranslations()` must be rendered inside `<NextIntlClientProvider locale="en" messages={enMessages}>` in tests, or they throw "No intl context found". See `__tests__/components/CostCard.test.tsx` for the pattern.
- **Announcements are stored as raw markdown text**: the API accepts any string (up to 800 chars) and `HomeTab` / `AdminDashboard` list rendering both route through `renderMarkdown()` from `lib/miniMarkdown.tsx`. Legacy plain-text announcements render identically (no markdown tokens in them). Server does not parse, normalize, or sanitize the string — the parser is JSX-only with no raw-HTML injection API, so XSS cannot originate from this path even with hostile input.
- **`PATCH /api/session/bird-usage` vs `PUT /api/session`**: `/api/session` PUT replaces the entire active-session doc and only targets the active session. `/api/session/bird-usage` PATCH is additive: it upserts a single purchase's entry in a specific session's `birdUsages` array, by `sessionId`, so admins can retro-assign tubes to archived sessions from the bird inventory page. Posting `tubes: 0` removes the entry (undo). Both paths validate tubes ∈ [0, 100] in 0.25 increments and look up the purchase for authoritative cost snapshotting.
- **Stats preview-name is separate from identity**: `badminton_stats_preview_name` stores a name picked for viewing someone else's stats (admin browsing, incognito). It is NEVER written into `badminton_identity` because that would fake a `deleteToken` and break self-cancel semantics. `AttendanceCardLive` and `StatsStreakHero` both resolve identity → preview-name → picker in that order. Signing up for a session upgrades the preview-name to a real identity and the preview key is ignored from that point forward.
- **`NEXT_PUBLIC_FLAG_STATS_ATTENDANCE` is off by default on every deployment**: the flag gates only the live heatmap + streak hero — without it set to literal `'true'`, the Stats tab falls back to the compact coming-soon skeleton for attendance. Set it in Azure App Settings per deployment; `.env.local` flip only affects local dev.

## Feature Flags

The repo runs two Azure deployments from a single `main` branch: **`bpm-stable`** (friend-facing, updates only when a git tag is promoted) and **`bpm-next`** (auto-deploys every push to `main`). Stage-by-stage rollout is gated by feature flags so `main` can ship unfinished work to `next` without touching stable.

- **Flag convention**: `NEXT_PUBLIC_FLAG_<STAGE>_<FEATURE>` (e.g., `NEXT_PUBLIC_FLAG_DESIGN_PREVIEW`, `NEXT_PUBLIC_FLAG_STATS_ATTENDANCE`). Must be registered in `lib/flags.ts` `FLAGS` registry — the typed `FlagName` union prevents typo'd lookups.
- **Reading flags**: always `isFlagOn('NEXT_PUBLIC_FLAG_X')` from `lib/flags.ts`. Never `process.env.NEXT_PUBLIC_FLAG_X` directly — Next.js only inlines literal accesses, and the helper's switch statement guarantees each flag is inlined.
- **Canonical value**: only the literal string `'true'` means on. `'1'`, `'yes'`, `'TRUE'` all read as off. Prevents accidental enablement from typo'd Azure App Settings.
- **Server vs client**: for flags that gate API response shape or DB writes, read the flag on the server only. Client flags can't protect the database — a user with devtools can flip bundle flags but cannot flip server env vars.
- **Env detection**: `getEnv()` returns `'stable' | 'next' | 'dev'` from `NEXT_PUBLIC_ENV`. `<PreviewBanner />` uses `isPreviewEnv()` to render the "preview build" warning on `bpm-next` only.
- **Retirement rule**: every flag in `lib/flags.ts` has a `plannedRemoval` date. Two weeks after a stage promotes to stable, delete the flag + its `off` branch. Long-lived flags become permanent tech debt.
- **Test requirement**: meaningful code paths gated by a flag should have tests covering both the `on` and `off` branches. Trivial UI-only flags (copy swaps, style tweaks) can skip. See `__tests__/flags.test.ts` for the pattern (mutate `process.env` in `beforeEach`).

## Deployment

Two deployments from one `main` branch (trunk-based + tag promotion):

- **`bpm-next`** — auto-deploys every push to `main` via `.github/workflows/deploy-next.yml`. Runs with `NEXT_PUBLIC_ENV=next` and most flags `on`. Preview banner visible. Friend-group beta testers bookmark this URL.
- **`bpm-stable`** — friend-facing production. Deploys only when `.github/workflows/deploy-stable.yml` is manually dispatched with a `tag` input (e.g., `bpm-stable-v1.0`). Runs with `NEXT_PUBLIC_ENV=stable` and flags `off` by default.

**Promotion runbook**: update `CHANGELOG.md` → tag `main` as `bpm-stable-vN.0` → push tag → dispatch `deploy-stable` with the tag → smoke test → announce.

**Rollback**: re-dispatch `deploy-stable` with a previous tag. For data rollback, Cosmos point-in-time restore (7-day retention).

**Schema rule**: the two deployments share one Cosmos DB. All schema changes must be additive and optional — never remove or rename a field while stable and next share the DB. Stage 2's `orgId` migration is the one high-risk event; see `/Users/gz-mac/.claude/plans/this-was-where-we-clever-diffie.md`.

Tests must pass before build proceeds on either workflow. Runtime env vars (including flags) set in Azure App Settings per App Service.

## Testing

```bash
npm test              # run all tests (vitest)
npm run test:watch    # watch mode
```

420 tests across 52 suites covering API routes (admin auth, player CRUD, player self-pay, account-only signup + hijack guards, members, sessions, session costs, birds, per-session bird-usage, skills, releases CRUD + PATCH, announcements markdown round-trip, stats attendance, recovery PIN + member-fallback), feature flags, i18n parity, component rendering (CreateAccountSheet, ProfileTab, CostCard, etc.), mini-markdown parser, bird-brand parser, bird-usage helpers, stats placeholder, and the design-preview route. Tests use the in-memory mock store — no DB needed. Helpers in `__tests__/helpers.ts`. Each test gets a unique IP via `X-Client-IP` to avoid rate limiter collisions.
