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
- **4 tabs**: Home, Sign-Ups, Skills, Admin. Skills tab shows "Progress together?" for non-admins; admins get the persistent `SkillsRadar` + inline Add Player form.
- **SkillsRadar uses recharts**: Imported with `dynamic(() => import(...), { ssr: false })` because recharts requires `window`.
- **Bottom sheet primitive**: Use `<BottomSheet>` from `components/BottomSheet/` for any new sheet/drawer. It handles portal mount, body scroll lock, focus trap, Escape-to-close, and CSS-driven animation (180ms ease-out-quart). Inline `zIndex: 60` (sheet only — no backdrop, no backdrop-tap dismiss). Two consumers exist: `ReleaseNotesSheet` and `SkillsRadar`'s `SkillDetailSheet`. DatePicker is NOT a bottom sheet (it's a popover anchored to an input) and stays separate.
- **Sheet body lock**: Use `position: fixed` on `<body>` (handled inside `useBodyScrollLock`). Plain `overflow: hidden` doesn't stop iOS rubber-band / pull-to-refresh. The `<BottomSheet>` primitive applies this automatically while open.
- **HomeTab card order** is deliberately context-on-top, action-on-bottom for one-handed thumb reach: `BPM|Date tile row → CostCard → Announcement → Sign-Up card → PrevPaymentReminder`. Don't flip this back without a reason.
- **Cost per person** renders as a standalone `<CostCard />` between the tile row and the Announcement card. Visibility is gated on `showCostBreakdown && perPersonCost > 0 && datetime` — independent of announcement presence (research finding 4.7).
- **Previous session snapshot**: `session.prevSessionDate` and `session.prevCostPerPerson` are frozen at advance time. `<PrevPaymentReminder />` renders below the sign-up card, gated on `hasIdentity` (not `isSignedUp`) — so players who played last week still see what they owe even before signing up for the next session (research finding 4.8). `hasIdentity` must be kept in sync with `setIdentity` / `clearIdentity` call sites. Not live-updated if the archived session is edited later.
- **Cold-start splash**: Pre-hydration splash lives in `app/layout.tsx` (pure HTML in the server component body). `<HydrationMark />` mounted in `app/page.tsx` sets `html[data-hydrated="true"]` on mount; CSS hides the splash via that selector. Splash uses `var(--page-bg)` so it honors the current theme.
- **Component tests need `afterEach(cleanup)`**: Per-file `// @vitest-environment jsdom` docblock enables component tests, but Vitest globals aren't configured — so `cleanup()` from `@testing-library/react` must be called manually between cases when multiple tests render overlapping text. See `__tests__/components/PrevPaymentReminder.test.tsx` for the pattern.
- **DevPanel**: Add `?dev` to the URL to show a floating control panel for testing UI states (cost visibility, payment reminder, signed-up status, player count). Controls override real API data. Only active when `?dev` is in the URL.
- **Advance form shows success toast**: 1.2s green banner before `onBack()`. Don't remove the delay — it's intentional user feedback.
- **`.azure/` is gitignored**: Never commit.
- **Mock store**: Test without DB by omitting `COSMOS_CONNECTION_STRING`. Verify mock query filters match real Cosmos queries.
- **i18n is cookie-based, not URL-based**: `NEXT_LOCALE` cookie drives the locale. `middleware.ts` sets it on first visit from `Accept-Language`; `LanguageToggle` writes it on tap. Cookie `path` must be `/bpm` (matches `basePath`) — not `/`.
- **Server reads cookie, client writes cookie**: never use `navigator.language` or `localStorage` for locale — it will desync server and client and cause hydration mismatches. Always go through `useLocale()` on client and `getLocale()` on server.
- **Missing translation keys fall back to English**: `i18n/request.ts` deep-merges `messages/en.json` under the active locale, so a missing `zh-CN` key renders the English string rather than throwing. Do not rely on throwing behavior for "missing translation" detection — use the `canary-strings.test.tsx` assertion pattern.
- **Rich-text strings use `t.rich`, not `t`**: any message containing `<tag>...</tag>` must be rendered via `t.rich('key', { tag: (chunks) => <Component>{chunks}</Component> })`. Using plain `t()` on a rich-text key prints the raw `<tag>` characters.
- **Component tests need a provider wrapper**: components that call `useTranslations()` must be rendered inside `<NextIntlClientProvider locale="en" messages={enMessages}>` in tests, or they throw "No intl context found". See `__tests__/components/CostCard.test.tsx` for the pattern.

## Deployment

Push to `main` triggers GitHub Actions: test → build → standalone zip → OIDC Azure deploy. Tests must pass before build proceeds. See `.github/workflows/main_badminton-app.yml`. Runtime env vars set in Azure App Settings.

## Testing

```bash
npm test              # run all tests (vitest)
npm run test:watch    # watch mode
```

92 tests across 8 suites covering API routes (admin auth, player CRUD, player self-pay, members, sessions, session costs, birds, skills). Tests use the in-memory mock store — no DB needed. Test helpers in `__tests__/helpers.ts`. Each test gets a unique IP via `X-Client-IP` to avoid rate limiter collisions.
