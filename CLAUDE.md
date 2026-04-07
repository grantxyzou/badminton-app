# CLAUDE.md — Badminton Session Manager

## Purpose

Mobile-first web app for managing casual weekly badminton sessions. Players sign up (or join waitlist when full), admin manages sessions, players, payments, and announcements. Built for "BPM Badminton", deployed on Azure App Service Free tier at `/bpm`. Sessions are date-keyed and archived.

## Quick Start

```bash
npm install
npm run dev   # → http://localhost:3000/bpm
```

Omit `COSMOS_CONNECTION_STRING` from `.env.local` to use the in-memory mock store (all routes work offline). See `.env.local.example` for all env vars.

`NEXT_PUBLIC_*` vars are baked at build time — changes require rebuild + redeploy.

## Key Architecture

### Single-Page App
`app/page.tsx` is the only browser route. Tabs: Home, Sign-Ups, Skills (Coming Soon), Admin. All data via API routes under `app/api/`. Every fetch uses `{ cache: 'no-store' }`.

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
- **Cosmos DB**: Use `getContainer(name)`. Always filter by `sessionId` on `players` and `announcements`. Partition key on `players` is `sessionId`. `aliases` are global (no sessionId). `sessions` partition key is doc `id`.
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

## Gotchas

- **Race condition on signup**: Capacity check + insert not atomic. Can exceed `maxPlayers` by 1-2 spots.
- **In-memory rate limiter**: Resets on cold start. Single-instance only.
- **Cold starts**: ~10-20s wake after 20min idle (Free tier).
- **`NEXT_PUBLIC_BASE_PATH` must match `basePath`**: Both must be `/bpm` or API fetches 404.
- **`endDatetime` is optional**: May be absent in legacy records. Guard with `session?.endDatetime ? ... : false`.
- **`signupOpen` defaults to open**: Absent = open. New sessions via advance start closed.
- **Announcements are session-scoped**: Advancing hides old announcements.
- **DatePicker is custom**: Portal-rendered to escape `backdrop-filter` stacking. Don't replace with native.
- **4 tabs**: Home, Sign-Ups, Skills (Coming Soon), Admin. Skills tab shows "Progress together?" for non-admins, SkillsRadar for admins.
- **SkillsRadar uses recharts**: Imported with `dynamic(() => import(...), { ssr: false })` because recharts requires `window`.
- **`.azure/` is gitignored**: Never commit.
- **Mock store**: Test without DB by omitting `COSMOS_CONNECTION_STRING`. Verify mock query filters match real Cosmos queries.

## Deployment

Push to `main` triggers GitHub Actions: test → build → standalone zip → OIDC Azure deploy. Tests must pass before build proceeds. See `.github/workflows/main_badminton-app.yml`. Runtime env vars set in Azure App Settings.

## Testing

```bash
npm test              # run all tests (vitest)
npm run test:watch    # watch mode
```

61 tests across 7 suites covering API routes (admin auth, player CRUD, player self-pay, members, sessions, birds). Tests use the in-memory mock store — no DB needed. Test helpers in `__tests__/helpers.ts`. Each test gets a unique IP via `X-Client-IP` to avoid rate limiter collisions.
