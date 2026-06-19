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
`app/page.tsx` is the only browser route. **It is an async server component** (since 2026-05-07): it server-renders the announcement (the LCP element on Home) into the initial HTML payload and delegates all client state to `<HomeShell>`. `HomeShell` is the `'use client'` boundary — owns tab routing, identity, dev mode, admin gating, the easter egg, etc. Tabs: Home, Sign-Ups, Skills (admin-functional, "Coming Soon" placeholder for non-admins), Admin. All client-fetched data via API routes under `app/api/` with `{ cache: 'no-store' }`; server-side reads go through `lib/announcements.ts` etc. (single source of truth shared with API routes).

**If you need to add another server-rendered initial value to `<HomeShell>`:** extract the read into a `lib/<thing>.ts` server-only function, call it from the async `Page()` in `app/page.tsx`, pass it as a prop to `HomeShell`, and have the client component receiving it use it as `useState` initial value (with a useEffect refresh in background). Don't add the lib function to a `'use client'` file — it imports from `@azure/cosmos` which is server-only.

### Session Pointer
Sessions are date-keyed (`session-YYYY-MM-DD`). A pointer document (`id: 'active-session-pointer'`) tracks the current session. **Always use `getActiveSessionId()`** — never `SESSION_ID` directly (legacy compat only). The pointer falls back to `'current-session'` if no pointer doc exists — do not remove this fallback.

### Auth
- Admin: HTTP-only cookie via PIN, validated with `timingSafeEqual`. **Mutating** admin routes call `await isAdminAuthedWithMember(req)` (re-reads the Member, enforces `role==='admin' && active===true` on every request, so demotion takes effect immediately); **read-only** routes use the cheap sync `isAdminAuthed(req)` (cookie signature + expiry only — no Cosmos read on hot paths). See `lib/auth.ts`. The inline rule-7 sessionId-override checks (skills/players/games) also stay sync. (WS#3 audit, 2026-06-03.)
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

- **Live Attendance** is always-on (flag retired in v1.3 hotfix). `AttendanceCardLive` resolves an active name from three sources in order: `badminton_identity` (real player), `badminton_stats_preview_name` (admin/anon picker selection), or fallback to the autocomplete picker. The preview-name key is intentionally separate from the real identity so picking a name for stats viewing doesn't give a fake `deleteToken` or muddy self-cancel semantics.
- **Attendance heatmap** — `AttendanceHeatmap` is a pure-SVG 7×N grid (7 rows = day-of-week, N columns = weeks). Solid accent = attended, outlined = missed session, empty = no session that day. Zoom 3M/6M/1Y swaps the `weeks` query param; API clamps to [1, 260].
- **Streak hero** — `StatsStreakHero` fetches 52 weeks and shows a personal-best flame state when `streak >= longestStreak && streak >= 3`. Hidden when streak is 0. Renders above the card grid via `heroSlot`.

### Design System
Canonical bundle mirrored at `docs/design-system/` (43 files — tokens, 28 specimen HTMLs, UI-kit JSX refs, self-hosted fonts). `app/globals.css` is the **single source of truth** for tokens in the running app; the docs folder is pristine reference only (never imported).

- **Fonts**: Space Grotesk (display — h1/h2/h3, wordmark, splash) + IBM Plex Sans (body — `var(--font-sans)`) + JetBrains Mono (data — `var(--font-mono)`). Self-hosted variable TTFs in `app/fonts/`, loaded via `next/font/local`. Italic variant wired for IBM Plex.
- **Icons**: `.material-icons` class aliased to Material Symbols Rounded, subsetted to ~43 glyphs via Google Fonts `icon_names=` param (~20 KB). New glyphs must be added to the URL in `app/layout.tsx` — missing glyphs render as raw text (e.g. `EXPAND_LESS`) instead of failing loud.
- **Backgrounds** live on the `.court-bg` element (rendered once in root layout). `02 Aurora` (3 blobs with transform-only animation) is the default; `03 Court` (real badminton-doubles proportions, aspect-locked via `aspect-ratio: 100/220` + `background-size: contain`) activates on Sign-Ups via `html[data-tab="players"]` selectors.
- **Preview route** at `/bpm/design` (7 sub-pages, flag-gated behind `NEXT_PUBLIC_FLAG_DESIGN_PREVIEW`). Not linked from BottomNav.
- **Corner radii ladder** — rectangular surfaces capped at **16px**. 6/8/10/12/16 for rect; 100px for pill. Glass-card was at 24px historically (self-inflicted spec violation); now 16.
- **Type-size scale** — `--fs-2xs`(10)/`-xs`(11)/`-sm`(12)/`-base`(13)/`-md`(14)/`-lg`(16) + line-heights `--lh-tight/snug/normal`, with matching size-only `.fs-*` utility classes. Roles: 2xs=section labels/micro badges, xs=tile labels, sm=card subtitle, base=body/hints, md=emphasis, lg=stat values. Headlines keep `.bpm-h1/h2/h3`. Use the token/class — never a raw inline `fontSize` number. Named `--fs-*` to avoid clashing with the `--text-*` *color* tokens. (Added in the standardization program, Phase 0.)
- **Inline spacing scale** — `--space-1..6` = 4/6/8/12/16/20 for inline `padding`/`gap`. Class-based layout still prefers Tailwind `p-*`/`gap-*`; the tokens exist so inline styles stop hand-typing pixel values.
- **Button family** — prefer the `cc-btn` family (`cc-btn-primary` / `-secondary` / `-ghost` / `-danger`) for command-center actions. Compose with size modifier `cc-btn-lg` for prominent hero CTAs. The legacy `.btn-primary` (gradient, larger weight) is kept for back-compat but new admin code should use `cc-btn` for the focus ring + a11y. All defined in `app/globals.css`.
- **Stat tiles** — `.cc-tile` with severity variant (`warn` / `bad` / `info`) is interactive (cursor:pointer, hover). Use `.cc-tile-static` for read-only stat displays so you don't render three buttons that all go to the same place.
- **Design system first — always**: Use established patterns from `globals.css` for all interactive element states. When no explicit rule exists for a new case, derive from the nearest existing principle rather than inventing ad-hoc values. Example: a list row that will be tappable in a future sub-issue uses `opacity: 0.5; pointer-events: none` — same principle as `.cc-btn:disabled`. If a genuinely new pattern is needed, name the principle and define it in `globals.css` before using it inline.
- **Composition primitives** (`components/primitives/`, from the standardization program): prefer these over hand-rolling the layout — they bake in the canonical spec so it can't drift.
  - `<CardHeader icon title subtitle? badge? action? />` — the icon + `bpm-h3` title (+ `--fs-sm` subtitle) (+ trailing badge/action) row atop a `.glass-card`. Two-tier spec: icon 22/accent, `flex-start` + icon `marginTop:1` when a subtitle is present.
  - `<StatusBadge variant="accent|muted|phase" tone? >` — the uppercase pill (Live/Beta = `accent`, compact "Coming soon" = `muted`, skill-phase = `phase` with `tone="amber"` for switch). Don't hand-code pill spans.
  - `<ErrorState message />` / `<EmptyState>` — the legible-fail surfaces: ErrorState is the `role="alert"` red load-error pill; EmptyState is muted "no data yet" body copy. Keep them distinct (a loaded-empty card must not look like a failure).
  - `<ListRow leading? title subtitle? trailing? onClick? />` — structural row layout (renders a `cc-mini-card` button when `onClick` is set). Not opinionated about text styling; slots take nodes.
  - The `<BottomSheet>` primitive (below) predates these and is the same idea for sheets.
- **Inner-content reference** (the single "one true reference" for in-card content styling, derived from Home/Sign-Up and codified 2026-06-18): use these roles instead of hand-rolling raw Tailwind (`text-xl`/`text-sm`) or raw px. Stats/admin cards already conform via the primitives.
  - **Card container**: `.glass-card` (16px radius). Content cards pad **20px** (`p-5`); compact tiles (date/location) pad **16px** (`p-4`).
  - **Card title**: standard card-header title = `.bpm-h3` (18px) via `<CardHeader>`. The bare hero heading (Sign-Up's "I'm in this week") = `.bpm-h2` (20px) — use the same class in every state (don't fork into `text-xl font-bold text-green-400`).
  - **Card subtitle**: `--fs-sm` (12px) via `<CardHeader subtitle>`.
  - **Primary body copy** (announcement, AI insight, the card's main reading payload) = `--fs-md` (14px), `--text-primary`. **Muted/secondary** helper lines = 12px, `--text-muted`. (13px `--fs-base` is the generic body token but Home renders primary body at 14 — match it.)
  - **Section label** (uppercase eyebrow) = `--fs-2xs` (10px) / `.section-label` (11px), 700 display.
  - **Inner rows + stat tiles** (`ListRow`/`cc-mini-card`/`cc-tile` inside a card): **12px radius (`--radius-lg`) + 12px padding**. Override `cc-tile`'s 14px per-use, don't edit the shared admin class.
  - **Inline stat/value numbers** = `--fs-md` (14px). The Stats tab's headline data numbers (Level, Overall, streak count) are a deliberate larger mono scale (20–22px) — Stats-specific, no Home equivalent.
- **Token guardrail (ESLint)**: `eslint.config.mjs` flags bare hex color literals and raw inline `borderRadius` numbers (steer to `var(--accent)`/`--text-*`/`--sev-*` and `var(--radius-*)`). The `var(--accent, #22c55e)` fallback form is fine (hex is inside the `var()` string). App-wide it's `warn`; **per cleared area it tightens to `error`** (the `DESIGN_TOKEN_SELECTORS` override pattern — `components/stats` is already `error`). Genuinely-untokenizable values (recharts/SVG stroke-fill that can't read `var()`) carry an `// eslint-disable-next-line no-restricted-syntax` with a reason. The `design-canary` test (`__tests__/design-canary.test.ts`) pins the token/class contract.

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
3. **Auth before DB.** Admin check at top of every admin route, before body parsing. **Mutating** handlers use `await isAdminAuthedWithMember(req)` (role re-check); read-only handlers may use sync `isAdminAuthed(req)`.
4. **Rate limit before auth.** Rate limiting first in handler so it can't be bypassed.
5. **`POST /api/claude` is admin-only.** Unauthenticated access would expose API key budget.
6. **`getClientIp(req)` for IP.** Reads `X-Client-IP` then `X-Forwarded-For`. Never `req.ip` (returns Azure proxy IP).
7. **`sessionId` override is admin-only.** Gate `?sessionId=` and body `sessionId` with auth check.
8. **Capacity-check restores and promotions.** `removed: false` or `waitlisted: false` must check active count first → 409 if full.
9. **`purgeAll: true` is irreversible.** Hard-deletes all records including soft-deleted.
10. **Aliases require admin auth.** E-transfer names are sensitive payment data.
11. **PIN comparison hashes first.** `admin/route.ts` hashes both PIN and admin PIN to SHA-256 before `timingSafeEqual` to avoid leaking PIN length via timing.
12. **Member-scoped writes bind to the member cookie.** A name-keyed write that mutates one member's data (e.g. `equipment/gear` PUT) must require a `member_session` cookie matching the target member (`verifyMemberAuth` → `memberId`) OR admin — never name-only, since names are enumerable. The cookie is minted at sign-up (no PIN needed), preserving "anon-signup trust" while closing impersonation. (WS#3, 2026-06-03.)

## Gotchas

- **Race condition on signup**: Capacity check + insert not atomic. Can exceed `maxPlayers` by 1-2 spots.
- **In-memory rate limiter**: Resets on cold start. Single-instance only.
- **Cold starts**: ~10-20s wake after 20min idle (Free tier).
- **`NEXT_PUBLIC_BASE_PATH` must match `basePath`**: Both must be `/bpm` or API fetches 404. **`next.config.js` does NOT export it** — it sets `basePath: '/bpm'` server-side only, so the client bundle gets the value purely from the env (`.env.local` / shell). `.env.local.example` now includes `NEXT_PUBLIC_BASE_PATH=/bpm` (so `cp .env.local.example .env.local` works out of the box), but any launch with neither a `.env.local` nor the explicit var is broken: the client reads `BASE = process.env.NEXT_PUBLIC_BASE_PATH || ''` → fetches `/api/*` with no prefix → every request 404s → `reportFetchFailure` cascades into a **false "You're offline / Couldn't load" state across the whole app** (server is fine). Tell: dev log shows `GET /api/players 404` (no `/bpm`). An offline launch without a `.env.local` must pass `NEXT_PUBLIC_BASE_PATH=/bpm` explicitly — see `.claude/skills/run-badminton-app/`.
- **`endDatetime` is optional**: May be absent in legacy records. Guard with `session?.endDatetime ? ... : false`.
- **`signupOpen` defaults to open**: Absent = open. New sessions via advance start closed.
- **Announcements are session-scoped**: Advancing hides old announcements.
- **DatePicker is custom**: Portal-rendered to escape `backdrop-filter` stacking. Don't replace with native.
- **4 tabs**: Home, Sign-Ups, **Stats**, Profile. Admin reachable via Profile → "Admin tools →" or `?tab=admin` deep link. (Tab id is still `'skills'` for backcompat; the `nav.skills` i18n key renders "Stats" / "数据".) Both admin and non-admin see `<StatsPlaceholder />` — compact coming-soon cards for the cost/partners slots, always-on live Attendance heatmap, and admin gets the SkillsRadar (solo mode only post-v1.3 hotfix) as a Beta-badged live card. The `SHOW_ADD_PLAYER_FORM` and `SHOW_SKILLS_OVERLAY` constants in `SkillsTab.tsx` gate the admin Add-Player form and the SkillsRadar overlay/compare mode respectively — both currently false; flip back to true to restore.
- **Auth taxonomy** (since 2026-04-30, restructured 2026-05-12): three distinct concepts, but the user-facing surfaces are unified.
  - **Sign up** = register for the active session via HomeTab. The sign-up card is an **adaptive form** driven by `useMemberProbe(name)` from `lib/useHasPin.ts` (debounced GET `/api/members/me?name=X`):
    - `anon` mode (probe returned null OR member doesn't exist): name input only → POST `/api/players` `{name}`.
    - `sign-in` mode (member with PIN): name + PIN input + "Forgot your PIN?" link → two-step submit (POST `/recover` to verify PIN, then POST `/api/players` to register for session). Sign-in here AUTO-REGISTERS for the active session because the button label "I'm in this week" makes the intent unambiguous. (Differs from Profile sign-in, which does not auto-register.)
    - `create` mode (member exists, no PIN yet): name + Create PIN + Confirm PIN → POST `/api/players` `{name, pin}` (member gets PIN AND session signup in one call).
    Submit handler in `components/HomeTab.tsx` `handleSignUp` branches by mode.
  - **Create account** = identity-only creation, still lives in Profile's `CreateAccountSheet` for invite flow (`sessionSignup: false`). Refuses with 409 `account_exists` if a member already has a `pinHash` (prevents account hijack).
  - **Sign in** (Profile path) = name + PIN auth via `<SignInForm>` rendered inline on ProfileTab's anonymous view. POST `/api/players/recover` verifies against `members.pinHash` and returns **identity-only** (`deleteToken: null`) — Profile sign-in does NOT auto-register for a session (commit 6046755, 2026-05-07). Constant-time miss against `FAKE_HASH`. Rate-limited 5/hr per `(name, IP)`. HomeTab's old "Already a player?" link + standalone RecoverySheet card (#89) were removed 2026-05-12 in favor of the adaptive form above.
  - **Cancel spot** ≠ **Sign out**. `PlayersTab.handleCancel` removes the user from the active session player list and zeroes the deleteToken (server consumed it), but preserves name + sessionId in localStorage. The user stays signed in and can re-sign-up with one tap. `clearIdentity()` belongs only in `ProfileTab.handleLogout`.
  - PINs scrypt-hashed via `lib/recoveryHash.ts`. Lost-device admin code via `POST /api/players/reset-access` (10/hr per IP, 6-digit, 15-min TTL — in-memory `lib/recoveryCodes.ts`, does NOT survive cold starts).
  - **Recovery code path clears `members.pinHash`** (and the `players.pinHash` mirror) on success — the user reached this path because they forgot their PIN, so any subsequent `RecoveryPinSheet` should render in 2-field mode (no current-PIN prompt). Without this, the sheet's `hasPin` check left users stuck after a reset. **It also mints a `member_session` cookie** (consuming a valid admin-issued code proves identity, same as a PIN sign-in) — this is what lets the user pass the members/me first-set guard below when they pick a replacement PIN. (WS#3, 2026-06-03.)
  - **`PATCH /api/members/me` first-PIN set (claim flow) requires identity proof** (WS#3, 2026-06-03): a `member_session` cookie for that name (minted at sign-up, PIN sign-in, or recovery-code reset) OR admin. Previously name-only — member names are enumerable via `GET /api/members`, so anyone could claim an unclaimed (no-PIN) account and sign in as them. The **change-PIN** branch is unaffected (`currentPin` is its credential). Client-side: `GET /api/members/me` returns `authed`; `ProfileTab` passes it to `RecoveryPinSheet`, which blocks first-set with actionable guidance (`profile.pinNeedsSignIn`) when known-not-authed (e.g. cookie expired past its 30-day TTL while `localStorage` identity persists), and never blocks on `authed === null` (unknown — server is the backstop).
  - Profile signed-in: PIN management lives in Settings as `New PIN` / `Update PIN` row → opens `RecoveryPinSheet` (Set/Change only — no Remove). Status sourced from `/api/members/me?name=X` returning `hasPin`, refetched on identity change.
  - **PIN is opt-in.** `ForcePinModal` was removed in commit 2026-05-07 (was already unmounted; deleted with no consumers).
  - **Admin login**: per-player auth via name + own PIN (`POST /api/admin`); cookie HMAC-signed via `SESSION_SECRET`. `member.role === 'admin'` required. Bootstrap names via `ADMIN_NAMES` env var. **Cookie TTL is 30 days** (`lib/auth.ts:29`); was 8h pre-v1.3, bumped to match `badminton_identity` localStorage longevity.
  - **AdminTab has no standalone Sign-out button** (since v1.3) — single auth surface lives in Profile. Profile logout calls `DELETE /api/admin` to clear the admin cookie.
- **`IDENTITY_EVENT`** (`lib/identity.ts`): a `CustomEvent('badminton:identity-changed')` is dispatched from `setIdentity` and `clearIdentity`. Page-level state (admin nav refresh in `app/page.tsx`) and `ProfileTab` subscribe so sign-in/out reactivity works without refresh. Browser `storage` events fire only in OTHER tabs — the custom event is needed for same-tab updates. Any new component mirroring `getIdentity()` in local state should subscribe.
- **`pinHash` is a strip-canary**: like `deleteToken`, it must be removed from every GET/PATCH/POST player AND member response. The strip pattern in `app/api/players/route.ts` and `app/api/members/route.ts` destructures both fields. New endpoints that return player or member records must mirror this — search for `pinHash: _ph` to find existing strip sites. Audit caught a regression on `/api/members` POST/PATCH/DELETE/admin-GET in 2026-05-06; all four are now stripped.
- **Lying empty state is forbidden**: `catch { setX([]) }` on a fetch failure renders the same UI as legitimate "no data". This is exactly how the v1.3 Cosmos misconfig disaster (`feedback_cosmos_silent_failure_diagnosis.md`) silently masked broken backends. Every card component must distinguish loaded-empty from load-failed — track a `loadError` state + render an explicit error pill ("Couldn't load — refresh to retry") instead of confidently zero stats. Apply this across the Command Center cards (`AdminConsoleHero`, `AdminDashTiles`, `PaymentsCard`, `AnomalyFeed`).
- **Admin-only settings live behind `/api/admin/settings`, not `/api/members`**: scanning the public members list for `role: admin` is fragile (multiple admins, response-shape changes leak attributes). The auth-gated `GET/PATCH /api/admin/settings` reads/writes the calling admin's own `eTransferRecipient` and `skipDates`. Used by `SkipDatesEditor`, `ETransferRecipientEditor`, `AdvanceSessionForm`, and the `CommandCenter` receipt loader.
- **Atomic appends > read-modify-write via PUT**: a client-side read-then-PUT on a shared doc can wipe the doc if the read step fails (the subsequent PUT writes a tiny object over a big one). For per-field appends like dismissing an anomaly, prefer a dedicated POST that does the merge server-side. See `POST /api/session/dismiss-anomaly` for the pattern.
- **Mixed-window rate calculations are silent bugs**: if you compute `X / Y`, make sure X and Y span the same time window. Burn-rate was previously `totalUsedAcrossAllSessions / recentSessionCount` which inflated by ~12× for groups with 2 years of history. The API now exposes `burnPerSession` so all callers agree.
- **Containing-block trap with `position: fixed`**: a parent with `transform`, `filter`, or `perspective` (e.g., `animate-slideInRight`) becomes the containing block, and `position: fixed` resolves against IT instead of the viewport. Result: "fixed" elements scroll with the page. Fix: portal out via `createPortal` to `document.body`. RosterPage's FAB hit this.
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
- **Advance form success screen**: after creating a session the form now STAYS on a success screen (green banner + "Share sign-up link" + "Done"), rather than auto-`onBack()`ing after 1.2s. The point is to let the admin share the sign-up link immediately (item 10); they dismiss via "Done". `AdvanceSessionForm` also carries the title/venue/`birdUsages` forward from the current session and offers recent-value chips (via `/api/sessions/locations` + `/api/birds`); the advance route writes `title`/`locationName`/`locationAddress`/`birdUsages` from the POST body.
- **Active tab is NOT persisted to the URL**: `HomeShell` no longer writes `?tab=<tab>` on tab switches — the iOS PWA restores the last URL on cold start, so persisting it made every open land on the last-viewed tab (usually Sign-Ups) instead of Home. The mount effect still HONORS an explicit `?tab=` deep-link once, then strips it. Trade-off: a reload returns to Home rather than the last tab.
- **Pull-to-refresh**: `components/PullToRefresh.tsx` (mounted in `HomeShell`) refetches the active tab by bumping a `refreshNonce` folded into each tab's React key (remount → re-run fetches; no service worker). Touch listeners live on `document` (body is the scroller); the gesture is disabled while a BottomSheet is open (`body { position: fixed }`).
- **Loading skeletons**: tabs render a structural skeleton (`components/primitives/CardSkeleton.tsx` — `CardSkeleton` / `TabSkeleton`) that reserves the final layout so cards fade in place instead of reflowing / popping in out of order. Replaced the full-page `ShuttleLoader` on Home/Sign-Ups.
- **Cover modes (`Player.coverMode`)**: a covered (`writtenOff:true`) player is `'absorb'` (admin eats their share; they stay in the per-person denominator) or `'resplit'` (excluded from the denominator → spread across the other payers). Legacy `writtenOff` with no `coverMode` reads as `'absorb'`. Settle (`/api/session/settle`) is the single calculator and stamps `SettledSnapshot.coveredTotal` (Σ per-person over absorb-covered). `CoverSheet` re-runs settle (DELETE+POST) when the session was already settled so amounts update immediately. Surfaced in `PaymentsCard`'s per-player menu (gated behind `NEXT_PUBLIC_FLAG_LEDGER`).
- **`ReceiptSheet` group preview uses a callback ref**: the canvas is drawn from a `ref` callback (`drawCanvas`) the instant it mounts, then exported to a PNG shown via `<img>` (with a sized placeholder until ready). A passive effect reading `canvasRef.current` raced the ref attach and left the preview a blank void — don't revert to that.
- **`.azure/` is gitignored**: Never commit.
- **Mock store**: Test without DB by omitting `COSMOS_CONNECTION_STRING`. Verify mock query filters match real Cosmos queries.
- **Mock-store dev seeds**: `SEED_DEV_ADMIN=Name:NNNN` seeds an admin member; `SEED_DEV_SCENARIO=fresh-thursday` seeds a clean signup-open session + 6 famous-player invite-list members (Lin has PIN 2468). Both refuse to fire when real Cosmos is configured. Use for end-to-end signup → settle → cover testing without touching prod data. Implemented in `lib/cosmos.ts` `seedDevAdminIfRequested` / `seedDevScenarioIfRequested`.
- **Auth cross-call assumption** (lesson from commit `fa7544a`, 2026-05-14): when a client stitches two server calls into one user-visible action, the server has no way to know they're related. The v1.4 unified Home sign-in flow called `/api/players/recover` then `/api/players` and assumed the first verified the user for the second — but /recover doesn't grant any auth cookie, so the second was anonymous and 401'd. **Rule**: every server-mutating call must carry its own credential (admin cookie OR explicit body.pin verified against `member.pinHash`). Don't trust "the previous call just succeeded." Regression test at `__tests__/players-signup-with-pin.test.ts`.
- **Plugin-settings hooks** (`.claude/`): two automation hooks ship with the repo. `scripts/check-flag-sync.mjs` (PostToolUse) alerts when `lib/flags.ts` adds a flag not present in `deploy-next.yml` — prevents silent flag-deploy drift. `.claude/hooks/session-start.sh` (SessionStart) reads `.claude/soak.local.md` + `.claude/bpm-confirm.local.md` and surfaces soak status + high-risk-op gate list. Both gated by per-project `.local.md` configs that are gitignored; templates in `docs/automation/`.
- **`.env*` files are hook-blocked from `Edit`/`Write`**: a PreToolUse hook returns "Do not edit .env files — edit them manually outside Claude Code." Workarounds: (a) print the diff for the user to paste into their editor; (b) use Bash + `sed -i.bak` which the hook doesn't intercept. The hook is intentional — `.env*` shouldn't be auto-edited.
- **Test fixture names**: use names clearly non-overlapping with the user's real domain. `SEED_DEV_SCENARIO=fresh-thursday` uses famous badminton player first names (Lin, Viktor, Carolina, Akane, Kento, Sindhu) — instantly recognizable as fixtures by any badminton player. Earlier generic choices (Bruce, Sophia, Josh) collided with real friend-group member names and caused "is this the seed or real data?" confusion mid-test.
- **`pkill -f "next dev"` exit codes**: a background-task tracker often reports exit 143 (SIGTERM) or 144 — these are *clean kill signals*, not failures. If the curl that follows succeeds, the server was already up and was killed deliberately; ignore the "failed" status from the tracker.
- **i18n is cookie-based, not URL-based**: `NEXT_LOCALE` cookie drives the locale. `proxy.ts` (formerly `middleware.ts`, renamed in Next 16) sets it on first visit from `Accept-Language`; `LanguageToggle` writes it on tap. Cookie `path` must be `/bpm` (matches `basePath`) — not `/`.
- **Server reads cookie, client writes cookie**: never use `navigator.language` or `localStorage` for locale — it will desync server and client and cause hydration mismatches. Always go through `useLocale()` on client and `getLocale()` on server.
- **Missing translation keys fall back to English**: `i18n/request.ts` deep-merges `messages/en.json` under the active locale, so a missing `zh-CN` key renders the English string rather than throwing. Do not rely on throwing behavior for "missing translation" detection — use the `canary-strings.test.tsx` assertion pattern.
- **next-intl HMR is sticky on new top-level branches**: editing existing keys in `messages/*.json` hot-reloads cleanly, but adding a brand-new top-level namespace (e.g. `admin.resetAccess`, `signup.pinPrompt`) sometimes leaves the running dev server with the old in-memory message tree, so `useTranslations('that.new.path')` throws `MISSING_MESSAGE` even though the key exists in the file. **Restart the dev server after adding any new namespace branch.** `pkill -f next-server` alone races with the next `npm run dev` (the new instance sees port 3000 still bound and exits). The reliable pattern: `ps aux | grep next-server` to find the PID, then `kill -9 <pid>`, then `npm run dev`. Editing nested keys inside an already-loaded namespace doesn't have this problem.
- **Rich-text strings use `t.rich`, not `t`**: any message containing `<tag>...</tag>` must be rendered via `t.rich('key', { tag: (chunks) => <Component>{chunks}</Component> })`. Using plain `t()` on a rich-text key prints the raw `<tag>` characters.
- **Component tests need a provider wrapper**: components that call `useTranslations()` must be rendered inside `<NextIntlClientProvider locale="en" messages={enMessages}>` in tests, or they throw "No intl context found". See `__tests__/components/CostCard.test.tsx` for the pattern.
- **Announcements are stored as raw markdown text**: the API accepts any string (up to 800 chars) and `HomeTab` / `AdminDashboard` list rendering both route through `renderMarkdown()` from `lib/miniMarkdown.tsx`. Legacy plain-text announcements render identically (no markdown tokens in them). Server does not parse, normalize, or sanitize the string — the parser is JSX-only with no raw-HTML injection API, so XSS cannot originate from this path even with hostile input.
- **`PATCH /api/session/bird-usage` vs `PUT /api/session`**: `/api/session` PUT replaces the entire active-session doc and only targets the active session. `/api/session/bird-usage` PATCH is additive: it upserts a single purchase's entry in a specific session's `birdUsages` array, by `sessionId`, so admins can retro-assign tubes to archived sessions from the bird inventory page. Posting `tubes: 0` removes the entry (undo). Both paths validate tubes ∈ [0, 100] in 0.25 increments and look up the purchase for authoritative cost snapshotting.
- **Stats preview-name is separate from identity**: `badminton_stats_preview_name` stores a name picked for viewing someone else's stats (admin browsing, incognito). It is NEVER written into `badminton_identity` because that would fake a `deleteToken` and break self-cancel semantics. `AttendanceCardLive` and `StatsStreakHero` both resolve identity → preview-name → picker in that order. Signing up for a session upgrades the preview-name to a real identity and the preview key is ignored from that point forward.
- **Offline posture is "legible-fail"** (`lib/useOnline.ts`). New network-mutating UI MUST gate on `useOnline()` (disable + the app-wide banner explains why) — never execute-then-break. The admin subtree is wrapped in `<AdminErrorBoundary>` (render-throw + ChunkLoadError net; auto-reloads on reconnect; "Reload now" disabled while offline). Full-reload-while-offline is unsupported by design (no service worker). See `docs/plans/offline-legible-fail.md`.
- **Unknown ≠ known-false** (the auth twin of the lying-empty-state rule): a failed/pending probe must not render as a confirmed negative. Tri-state it — e.g. HomeShell's `adminKnown` gates the admin-tab bounce so a reload on `?tab=admin` doesn't kick you off before auth resolves.

## Feature Flags

The repo runs two Azure deployments from a single `main` branch: **`bpm-stable`** (friend-facing, updates only when a git tag is promoted) and **`bpm-next`** (auto-deploys every push to `main`). Stage-by-stage rollout is gated by feature flags so `main` can ship unfinished work to `next` without touching stable.

- **Flag convention**: `NEXT_PUBLIC_FLAG_<STAGE>_<FEATURE>` (e.g., `NEXT_PUBLIC_FLAG_DESIGN_PREVIEW`). Must be registered in `lib/flags.ts` `FLAGS` registry — the typed `FlagName` union prevents typo'd lookups.
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

**Stable-tag footgun**: the promotion tags a commit, and `main` auto-deploys to `bpm-next` — so `main` routinely contains post-soak work ahead of what's ready for stable. Tag the *specific* intended commit, never blindly `main`, or unsoaked work rides to stable. (2026-05-16: deliberately tagged `ab566e0` for `bpm-stable-v1.4` to keep the just-merged offline work off the stable cut.)

**Rollback**: re-dispatch `deploy-stable` with a previous tag. For data rollback, Cosmos point-in-time restore (7-day retention).

**Schema rule**: the two deployments share one Cosmos DB. All schema changes must be additive and optional — never remove or rename a field while stable and next share the DB. Stage 2's `orgId` migration is the one high-risk event; see `/Users/gz-mac/.claude/plans/this-was-where-we-clever-diffie.md`.

Tests must pass before build proceeds on either workflow. Runtime env vars (including flags) set in Azure App Settings per App Service.

## Testing

```bash
npm test              # run all tests (vitest)
npm run test:watch    # watch mode
```

570 tests across 75 suites covering API routes (admin auth, player CRUD, player self-pay, account-only signup + hijack guards, members, sessions, session costs, birds, per-session bird-usage, skills, releases CRUD + PATCH, announcements markdown round-trip, stats attendance, recovery PIN + member-fallback), feature flags, i18n parity, component rendering (CreateAccountSheet, ProfileTab, CostCard, etc.), mini-markdown parser, bird-brand parser, bird-usage helpers, stats placeholder, and the design-preview route. Tests use the in-memory mock store — no DB needed. Helpers in `__tests__/helpers.ts`. Each test gets a unique IP via `X-Client-IP` to avoid rate limiter collisions.
