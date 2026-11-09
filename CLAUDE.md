# CLAUDE.md — Badminton Session Manager

## Purpose

Mobile-first web app for managing casual weekly badminton sessions. Players sign up (or join waitlist when full), admin manages sessions, players, payments, and announcements. The app is **BPM** (short for Badminton Per Management, `lib/brand.ts`); its first club, Grant's Thursday night, is **BPM Core** (`Group.name`, renamed from Admin → Club name) — the two were one name until 2026-10-22. Deployed on Azure App Service B1 tier at `/bpm`. Sessions are date-keyed and archived.

## Quick Start

```bash
npm install
npm run dev   # → http://localhost:3000/bpm
npm run dev:next:mock   # all flags on (as prod since multi-group went on 2026-10-22) over the seeded mock store — see `.claude/skills/run-badminton-app/SKILL.md`
npm test && npm run lint && npm run typecheck   # the full gate — run all three between tasks, not only at the end
```

Omit `COSMOS_CONNECTION_STRING` from `.env.local` to use the in-memory mock store (all routes work offline). See `.env.local.example` for all env vars.

`NEXT_PUBLIC_*` vars are baked at build time — changes require rebuild + redeploy.

## Where the rules live

This file is loaded in full every session and must stay under 150k characters (Claude Code's limit; it was 211k on 2026-11-08). It holds the rules that apply to every edit. Detail that matters for one part of the code lives in a **path-scoped rule**, `.claude/rules/<topic>.md`, whose `paths:` frontmatter makes it load only when Claude touches a matching file: `.claude/rules/multi-group.md`, `.claude/rules/money.md`, `.claude/rules/push.md`, `.claude/rules/native.md`, `.claude/rules/design-system.md`, `.claude/rules/racket-fit.md`, `.claude/rules/app-shell.md`, `.claude/rules/home.md`, `.claude/rules/auth.md`, `.claude/rules/i18n.md`, `.claude/rules/stringing.md`, and `components/stats/CLAUDE.md` for the Equipment register. **Add new detail there, not here**, and keep each one under 40k characters — a file that loads on demand is cut off past that in a 200K-context session. `__tests__/docs-canary.test.ts` checks the rules like this file.

## Key Architecture

### Single-Page App
`app/page.tsx` is the only browser route. **It is an async server component** (since 2026-05-07): it server-renders the announcement (the LCP element on Home) into the initial HTML payload and delegates all client state to `<HomeShell>`. **Both shells reach the page through `components/PageShells.tsx`** (`next/dynamic`, server rendering on), so a member's browser downloads only the app shell and a stranger's only the signed-out one (2026-11-05: signed-out first load 254 → 220 KB gzipped, signed-in 254 → 245); a static import of either in `app/page.tsx` puts both back in every visitor's first load. `HomeShell` is the `'use client'` boundary — owns tab routing, identity, dev mode, admin gating, the easter egg, etc. Tabs: Home, Stringing, Stats, Profile, with Admin reached from Profile (see "4 tabs" in `.claude/rules/app-shell.md`). All client-fetched data via API routes under `app/api/` with `{ cache: 'no-store' }`; server-side reads go through `lib/announcements.ts` etc. (single source of truth shared with API routes).

**Members only (`docs/plans/members-only.md`; its flag `NEXT_PUBLIC_FLAG_MEMBERS_ONLY` retired 2026-10-17, ON branch kept): the page decides who is signed in ON THE SERVER, before it reads anything.** It calls the same `requireMember` the API routes use, on a `NextRequest` built from its own cookie header — not a second definition of "signed in". Refused → it returns `<SignedOutShell>` (`components/onboarding/SignedOutShell.tsx`: Welcome with Sign up / Log in, then a page for each) and reads nothing; passed → `HomeShell` gets `memberName`, the verified name. **With groups on there is a THIRD outcome** (`decidePage` in `lib/pageGate.ts`, 2026-10-07): a signed-in ACTIVE member with no membership in the claimed group — a new organiser half-way through "Create a club", or someone removed from the club their cookie names — gets the same shell in `noClub` mode (Create a club / I have an invite / Sign out, or a list of their other clubs to pick from) and still reads nothing; `HomeShell` never mounts for them. That is the members-only half of Phase 5's "what does a person in no club see", confirmed by Grant on 2026-10-09 (he kept the list over an automatic switch to the oldest group). The members-only-OFF half closed when the flag retired on 2026-10-17: there is no OFF case any more. A client-side gate over HomeShell would not do: child effects run before a parent's, so the tabs would fetch the roster before the gate decided. **Signing in anywhere on that screen reloads** — every way in ends in `setIdentity`, the shell answers IDENTITY_EVENT with one guarded `location.reload()`, and the server renders the app; there is no client-held opinion of "signed in" to drift from the cookie. `HomeShell` reconciles `badminton_identity` to `memberName` (a shared phone can hold the previous person), and Home's sign-up card is locked to that name — no name field, no PIN field, no `members/me` probe. The iOS-PWA handoff collection lives in `lib/useHandoffCollect.ts`, shared by both shells.

**If you need to add another server-rendered initial value to `<HomeShell>`:** extract the read into a `lib/<thing>.ts` server-only function, call it from the async `Page()` in `app/page.tsx`, pass it as a prop to `HomeShell`, and have the client component receiving it use it as `useState` initial value (with a useEffect refresh in background). Don't add the lib function to a `'use client'` file — it imports from `@azure/cosmos` which is server-only.

### Session Pointer
`getActiveSessionId` memoizes the pointer per group for 5 s against real Cosmos only (`setActiveSessionId` updates it in-process; a 404 memoizes the fallback, an outage never does; `__tests__/active-session-pointer-memo.test.ts`). Sessions are date-keyed (`session-YYYY-MM-DD` for BPM; `${groupId}:session-YYYY-MM-DD` for any other group, via `sessionIdFromDate(iso, groupId)`). A pointer document per group (`groupDocId(groupId, 'active-session-pointer')` — BPM keeps the bare legacy id) tracks its current session. **Always use `getActiveSessionId(groupId)`** — never `SESSION_ID` directly (legacy compat only) — and get `groupId` from `resolveGroupId(req)` in `lib/groupContext.ts` (or `resolveGroupIdFromCookieHeader` in a server component). The ONE exception is `app/opengraph-image.tsx`, which hardcodes BPM on purpose: it is the share card for the app's single public URL, and a per-group card needs a per-group URL first. **It returns `null` for a group with no pointer**, and BPM alone falls back to `'current-session'` — do not remove that fallback. Every caller handles `null` deliberately: a read or write that needs a session answers `noActiveSession()` (404 `no_active_session`); a list answers empty; an exclusion comparand or a best-effort mirror binds `''`; the advance route is the one caller that WANTS null (a new group's first session has nothing to snapshot).

### Groups (multi-group, in flight — `docs/plans/multi-group.md`)

The full rules are in `.claude/rules/multi-group.md`, which loads when Claude touches `app/api/`, `lib/`, `proxy.ts` or a group test. These hold for every server edit:

- **ONE ACCOUNT, MANY GROUPS**: `Member` is the person; a `Membership` carries the per-group role, roster name and per-club trust (`canGift`, `role`, `active`). Flag `NEXT_PUBLIC_FLAG_MULTI_GROUP`, ON in production since 2026-10-22; `'false'` is the whole rollback.
- **`groupScope(groupId)` is the only way a route reads or writes a GROUP_SCOPED container**, with the group from `resolveGroupId(req)`. `__tests__/group-scope-coverage.test.ts` fails the build on a raw `getContainer` outside its allowlist.
- **`groupId` is an additive optional FIELD, never a partition key, and BPM's ids are never rewritten**; only a new group gets a `${groupId}:` prefix via `groupDocId()`.
- **Use `replace` for a read-modify-write, never `upsert`.** It is etag-conditional: `undefined` means gone OR changed under you, so re-read and decide.
- **Bind `@sessionId`, never `@sid`**, and add `partitionKey` only when the WHERE is a plain top-level equality on the container's own key.
- **A name means something only inside a group** (`resolveActiveMemberId(groupId, name)`), and a club AGGREGATE over a PERSON container narrows to `rosterMemberIds(groupId)` first.
- **How a club runs is a setting, never a special case**: read `clubRunOf(settings)` (`lib/clubRun.ts`).

### HTTP guards at the proxy
`proxy.ts` runs `apiGuards(req)` on every `/api/*` request before any handler (2026-09-28): a body over `MAX_BODY_BYTES` (256 KB, by `content-length`) answers 413 `payload_too_large` and a chunked body with no length answers 411 `length_required` (it could not be measured), and a non-safe method whose `sec-fetch-site` is `cross-site` or whose `Origin` host differs from the `Host` header answers 403 `cross_site_request`. The one exemption is `CROSS_SITE_WRITE_ALLOWED` (`/api/auth/apple/callback`, a form POST Apple sends). Cookies are already `SameSite=Lax`; this is the second wall. `__tests__/proxy-api-guards.test.ts` holds both rules and the exemption. **The page's Content-Security-Policy is set HERE, not in `next.config.js`** (2026-11-05): `lib/csp.ts` builds it and `proxy.ts` mints a fresh nonce per page request, hands it to Next on the request (`x-nonce` and the policy header — Next stamps it on its own scripts) and sends it on the response; `app/layout.tsx` puts it on the launch screen's pre-paint script. A header in `next.config.js` is fixed at build time and a nonce cannot be. `'unsafe-inline'` stays beside the nonce for browsers that predate nonces (the rest ignore it). **The matcher lists `'/'` on its own**: under `basePath` the other pattern compiles to `^/bpm/…`, so `/bpm`, the one page, never ran the proxy until then. A prerendered page would carry no nonce and have its scripts blocked; reading `headers()` in the root layout keeps every page dynamic, and only `/_global-error` is prerendered (`__tests__/csp-nonce.test.ts`). The CSP carries `frame-ancestors 'none'`, `base-uri 'self'`, `object-src 'none'` and `form-action 'self'`; HSTS `preload` is NOT set, because listing the domain is a one-way submission and Grant's call.

### Auth
**Who can do what** — player vs stringer vs admin (and multi-group organiser) — is `docs/roles.md`. Admin and stringer are independent switches (`role` vs `Membership.canString`, `Member.canString` flag-off), not a ladder; organiser is the rank above admin, and the only one that hands ranks out. **The Profile card shows the caller's rank in the claimed club** as one small chip beside the name (Organiser / Admin; none for a Player), from `GET /api/members/me`'s additive `rank` (the membership role, privileged-only like `role`, which still collapses an organiser to `admin` for older readers); while it is unknown the shell's admin verdict holds the chip. Job badges (Stringer, Gifter) are deliberately not shown there (Grant, 2026-11-04, #781).
- Admin: HTTP-only cookie via PIN, validated with `timingSafeEqual`. **Mutating** admin routes call `await isAdminAuthedWithMember(req)` (re-reads the Member, enforces `active===true` and the role on every request, so demotion takes effect immediately); **read-only** routes use the cheap sync `isAdminAuthed(req)` (cookie signature + expiry only — no Cosmos read on hot paths). See `lib/auth.ts`. The inline rule-7 sessionId-override checks (skills, games, and players' GET) also stay sync. (WS#3 audit, 2026-06-03.) **`POST /api/players` is the exception since 2026-09-28**: it computes ONE `admin` verdict through `isAdminAuthedWithMember` after the IP limiter (short-circuited by the sync check, so a non-admin costs no read), because sixteen decisions in that handler — creating and reactivating a Member, skipping the invite, claim and PIN gates — ran on the signature-only check and a demoted admin kept them for the cookie's TTL. **Every PIN check is also gated by a per-ACCOUNT lock** (`lib/pinLockout.ts`, 2026-09-28): the IP limiters are per caller, and a four-digit PIN is ten thousand guesses, so five fresh guesses per rotated address was two thousand addresses to cover the space. `Member.pinLock` (additive) counts consecutive failures; past `FREE_ATTEMPTS` (5) the account refuses PIN checks for a minute, doubling to an hour, cleared by a correct PIN, forgotten after a day. Locked answers the SAME generic 401 as a wrong PIN and still pays the scrypt (a "try again in 4 minutes" would say the account exists), and a guess made while locked neither counts nor extends it. All six sites — `admin`, `players/recover`, `players` POST and PATCH, `members/me`, `auth/claim-name` — go through `isPinLocked` / `notePinFailure` / `notePinSuccess`; the helpers update the in-memory doc too, because every site spreads it into a later write.
- **Both session cookies carry a `groupId` claim** (multi-group Phase 2, 2026-09-10). It is verified ONCE, at mint: `completeSignIn(res, member, groupId)` (async now) and `POST /api/admin` read the membership in that group and stamp an `admin_session` only for owner/admin there; the six direct `setMemberCookie` sites pass `resolveGroupId(req)`. The sync checks keep their signature-and-expiry contract because of that. **Flag OFF, the claim is ignored everywhere** — `resolveGroupId` answers BPM, `isAdminAuthedWithMember` reads `Member.role`, `completeSignIn` reads `member.role` — so a forged claim cannot move a request into another group on a deployment that has not turned groups on (`__tests__/group-auth.test.ts` holds both branches). Flag ON: `resolveGroupId` reads the member cookie's claim, then the admin cookie's (the admin login mints only that one), and `isAdminAuthedWithMember` / `requireGroupMember` read the membership in the CLAIMED group. A cookie minted before the claim existed has none and reads as BPM. `ADMIN_NAMES` bootstrap is honoured only for BPM, and with the flag on it promotes the BPM membership too, or the env var would name nobody.
- Player self-cancel: `deleteToken` (random 16 bytes hex) returned once at sign-up, stored in `localStorage`, validated server-side — OR the row's own member's `member_session` (re-read via `requireGroupMember`, matched on the row's `memberId`, the verified name only for a legacy row without one).

### Soft Delete
Players are never hard-deleted by default (`removed: true` + `removedAt`). `?all=true` (admin only) includes removed. Admins restore via `PATCH { removed: false }` — capacity-checked.

### Account Deletion

`DELETE /api/members/me` — App Store Guideline 5.1.1(v) requires it, and PIPEDA
does independently. Distinct from the admin `DELETE /api/members`, which is
admin-gated and only sets `active: false`.

**The rule: remove the person, keep everyone else's records correct.** A naive
purge deletes every row the member wrote, which is wrong here because the
records are SHARED — a `players` row is one line of a cost split, and a
`gameResults` row holds four names. So member-scoped data is DELETED and shared
history is ANONYMIZED to `TOMBSTONE_NAME` ('Former member'): arithmetic
preserved, person not identifiable. The ACTIVE session is the exception — that
row is soft-removed rather than anonymized, because a ghost holding a seat keeps
a real person on the waitlist.

`lib/memberPurge.ts` owns it, table-driven across three lists (`OWNED`,
`CLASSIFIED_ELSEWHERE`, `NOT_MEMBER_SCOPED`) with partition keys recorded as
DATA — the mock ignores the PK argument, so a wrong value passes CI and no-ops
in production. `__tests__/member-purge-coverage.test.ts` fails the build when a
container appears in none of the three lists, and **it resolves single-level
`const` aliases**: `authHandoff`/`authMigration` write `const CONTAINER = '…'`,
were invisible to a literal-only scan, and `authhandoff` (which parks a
`memberId`) therefore survived a deletion request in the first cut.

**Sign in with Apple is revoked at Apple first** (2026-09-15, Apple's rule for
apps offering it): `purgeMember` reads the member's `apple:<sub>` identity
BEFORE its loop deletes `identities`, and `revokeAppleIdentity`
(`lib/appleRevoke.ts`) sends the stored refresh token to Apple, then forgets it
whether or not Apple accepted — a failure lands in `failed` as `apple:revoke`
and never blocks the deletion. Disconnecting Apple does the same. The token
lives in its own `apple-refresh:<sub>` doc with NO `memberId` (for a new
account the identity row does not exist yet at the callback), and
`__tests__/apple-token-canary.test.ts` pins it to its files. The client-secret
JWT is hand-signed there because arctic keeps its own private —
`dsaEncoding: 'ieee-p1363'` is load-bearing and asserted.

**A name is matched only in the club where it was theirs** (audit, 2026-11-05,
`__tests__/group-account-delete.test.ts`). `purgeNamesFor` reads the person's
roster name in each club BEFORE the purge deletes the memberships, and every
by-name match — legacy `players` rows, `gameResults`, `skills`, unowned aliases
— keeps a row only when its club's name for them is the row's name; a row
carrying another member's id is never theirs. Before, a deletion with groups on
anonymized (and, for `skills`, deleted) another club's Lin. The seat is freed
in EVERY club's active session, not only the one the request came from; the
pay-to of a club they organised is cleared (`clearGroupPayTo`); their name
leaves jobs they strung for others, payment suggestions in the review queue
and uncollected join requests; reports are signed with `memberId` so a
deletion finds them by id; and the delete sheet clears the badge, shortcuts
and widget pass (`clearDeviceTraces`), as sign-out does.

Two consequences worth knowing: the anonymized `players` row has its
`deleteToken`, `pinHash` and `memberId` stripped (an anonymized row keeping a
live credential is the strip-canary rule at rest), and purging `events` LOWERS
the Value-Hub Slice-0 metric — the caveat is repeated at the point the number is
read in `app/api/admin/slice0/route.ts`.

### Usage metrics (first-party tracking, the Metrics page, the report keys)
`docs/plans/usage-metrics.md`, its flag `NEXT_PUBLIC_FLAG_USAGE_METRICS` was ON from 2026-10-07 and retired 2026-10-21, ON branch kept, so stopping the beacons is now a code change, not a setting. **Three usage kinds only**, in the existing append-only `events` container: `sign_in` (written by `completeSignIn`, whose `via` argument is REQUIRED so no sign-in path can forget it; group create/join/switch pass `null`), and the `app_open` / `tab_view` beacons from `lib/useUsageBeacons.ts` (mounted once in `HomeShell`, signed-in only, admin tab excluded, `tab` and `platform` from bounded lists). Sign-ups, cancels, kudos, stringing, push and reports are counted from their OWN containers, never re-logged as events. **The operator is STAFF** (roles v2 PR 4, 2026-11-03): the ids in `OPERATOR_MEMBER_IDS` skip those three kinds (`skipsUsageRecord` in `lib/operator.ts`, read by `POST /api/events` and `recordSignIn`) so one person checking a payment ten times a day cannot carry a club of thirty's daily-active; a `client_error` from that phone is still written, and the list IS the staff list — no field, no setter (`__tests__/usage-staff.test.ts`). **A fourth kind is an ERROR, not usage** (`client_error`, 2026-10-25, `docs/plans/client-error-beacon.md`): `reportClientError()` in `lib/engagement.ts`, fired from `app/error.tsx` and `app/global-error.tsx`, at most 3 per page load and never for a stale-chunk error (which reloads itself), carrying only `where` (`ERROR_WHERES`) and the tab — no message, stack or URL. It is read as `clientErrors` by `GET /api/admin/slice0` and `clubMetrics()` (last 7 days, roster-narrowed), so the key-protected report carries it into the daily health check; it is how a screen that breaks in a player's browser gets noticed without the player saying so.
- **`lib/metrics.ts` `clubMetrics()` is the one reader**; the admin `GET /api/admin/metrics` and the key-protected `GET /api/reports/metrics` both call it, so the page and the weekly report cannot disagree. `lib/metricsMath.ts` is pure. Every aggregate is narrowed to the roster, and a metric without enough data is `null` ("—"), never 0 — the lying-empty-state rule on a screen an admin decides from.
- **Totals only, never a list of names.** `GET /api/reports/feedback` is operator-club only and strips `ip` and `name` and cuts `url` to its path (an invite token rides in the query).
- **`x-reports-key`** is a read-only per-club secret minted on the Metrics page (`lib/reportsAccess.ts`, hashed in `clubSettings`, compared through `lib/clubKey.ts` — the same helper the payments key uses). The scheduled report helpers read it from the `BPM_REPORTS_KEY` environment variable; it is never pasted into a chat.
- **Retention is a Cosmos container TTL on `events`** (396 days, set in the portal), not purge code. The privacy policy promises 13 months; account deletion already deletes a member's events.
- **Never point a browser at production to test this** — it writes real `app_open` / `tab_view` rows. Use the mock store (`SEED_DEV_SCENARIO=metrics-history`).

### Payments inbox and the ledger

The full rules (e-transfer auto-detection, store credit, gift cards, the ledger mirror and reconcile) are in `.claude/rules/money.md`, which loads with the money files and `components/admin/`. These hold everywhere:

- **Never guess with money.** Auto-match only an authenticated Interac email with exactly one candidate and an exact amount; anything else is a review row. Only a SETTLED line is ever paid without a person looking.
- **`Player.paid` stays the truth**, and the `ledger` container is append-only: never upsert, edit or delete; a reversal is `void:<id>`, and ids are derived, never minted.
- **`lib/owedBalance.ts` is the one reading of what someone owes** — Home, the inbox, reminders and the reconcile all go through it.
- **No amount in a push body** (the lock-screen rule).

### Waitlist
Full session + `POST { waitlist: true }` → `waitlisted: true`. An admin promotes by hand via `PATCH { waitlisted: false }` — capacity-checked. **A freed spot is filled automatically since 2026-10-28** (`lib/waitlistPromote.ts`, `docs/plans/waitlist-auto-promote.md`): a cancel of a confirmed spot, an admin removal (`DELETE`, purge-one, `PATCH removed: true`) or a RAISED `maxPlayers` promotes waitlisters in sign-up order (`compareBySignup`) into every free spot and pushes each one — never a `heldForUnpaid` row, never once the session has started, never on a settled session, and never on an admin's move BACK to the waitlist (the first in line is often that same person). Adding a COURT moves nobody: `courts` and `maxPlayers` are separate fields. **How close the waitlist is to another court** shows on the sign-up card and the admin's Next session card (`courtLine` in `lib/clubRun.ts`, `docs/plans/waitlist-court-line.md`): players per court is the club's `playersPerCourt`, else `maxPlayers ÷ courts` when it divides evenly (BPM: 6), else nothing; held-for-unpaid rows don't count. Every promotion stamps `Player.promotedAt`; a cancel by a row promoted inside the club's late-cancel window is not tagged late, and a rejoin or an admin restore clears the stamp. **A club may keep its spots for members first** (`ClubRun.membersFirst`, `lib/membersFirst.ts`, `docs/plans/members-first-window.md`): advance copies the rule onto the session, and until it ends a sign-up from anyone not marked member (`Membership.regular`), and every guest, starts waitlisted with `waitingForMembers: true`, which promotion skips while the window runs. Nothing runs on a timer, so the first visit after the end (the session read, the roster read, a sign-up) stamps `membersFirstReleasedAt` under the session's etag and promotes in sign-up order; the organiser can do it early from the session card.

### Plus-one
A club may let members bring guests (`ClubRun.guests`, 0–2 a session, a rule of How your club runs; a club that never set it reads the old `groups.settings.guestsAllowed` switch as 1, and every save writes that switch beside it; `docs/plans/plus-one.md`, `docs/plans/six-feathers-guests.md`, `lib/plusOne.ts`). The guest is a `players` row of their own with `guestOf: <host memberId>` and NO `memberId`, so the cap, the split and the waitlist count them unchanged; the row's `name` is the club's own form, `Jenny (Josh)` (rows from before say `Jenny (Josh's guest)`; nothing finds a guest by name), and a guest name already on the club's roster is refused (`guest_on_roster`). An organiser may add one for a member on the week's list (`hostMemberId`, the session card's "Add a guest"). **A guest row is its HOST's money**: `matchesIdentity` matches it to the host and never by name, `loadOwedInputs` reads it by `@guestOf`, and the ledger charges it to the host. It leaves with the host, is cancelled only through the host's cookie (`DELETE { guest: true }`), and is anonymized when the host's account is deleted.

### Invite List
`session.approvedNames` is a dead field: nothing writes it, and `POST /api/players` stopped reading it when members-only made an account the gate (rule 13).

### Sign-Up Gating
`session.signupOpen` (boolean) — `false` blocks non-admin sign-ups. New sessions via advance always start `signupOpen: false`. `session.deadline` enforced server-side.

### Stats Tab
Bottom-nav "Stats" (formerly "Skills"; `nav.skills` i18n key kept for backcompat). One layout for everyone — there is no admin variant. `SkillsTab` resolves an active name, renders `StatsSignedOut` when there isn't one, and otherwise hands four slots to `StatsV2Shell`, in the order **You · Equipment · Play · Learn** (Equipment second since 2026-10-19, Grant's call on the Stats canvas): **You** (AI greeting, `SkillTrendCard` + `DimensionBars`, `WhereYouSitCard`, kudos received), **Play** (`YourRecordCard`, `WhoYouPlayWithCard`, give-kudos), **Learn** (`LearnRegister` — weekly focus + two drills), **Gear** (`GearRegister` — the "Set-up" card with Racket and Strings lines (its flag `NEXT_PUBLIC_FLAG_GEAR_SETUP` retired 2026-10-14 with the older pick rail plus "Your kit" off-branch), whose "Your fit" and "About this racket" open full pages with a Claude-worded verdict (flags `NEXT_PUBLIC_FLAG_GEAR_PAGES` and `NEXT_PUBLIC_FLAG_FIT_VERDICT` retired 2026-10-19, ON branches kept; "Your fit" carries the one "Clear my fit answers" the privacy policy promises); `NEXT_PUBLIC_FLAG_VALUE_HUB_SLICE`, which once gated the whole register and six API routes, retired 2026-09-28 with its twelve off-branches; see `components/stats/CLAUDE.md` for the single-owner `useGear` rule the register is built around). `OverviewStrip` sits above the register switch and stays put across all four.

- **Nothing counts sessions you missed.** Stage 8 (2026-08-20) deleted the v1 arrangement outright: `StatsPlaceholder`, `StreakSummaryCard`, `AttendanceCardLive`, `AttendanceSessionStrip`, `GameStatTiles`, `LevelCard`, `DrillsCard`, `GameLoggerCard`/`Sheet`, the admin `SkillsRadar` and `RadarSkeleton` — plus the `recharts` dependency they were the only consumer of. This is a product decision, not deferred work. **`GET /api/stats/attendance` still exists and is legitimate**, but nothing on Stats renders it, and `/api/stats/insight` is no longer given attendance counts or streaks at all (see its `Snapshot` comment) so the AI copy cannot reintroduce the guilt through the greeting. **A background insight request costs nothing for someone who does not read it** (2026-11-05): Home's pre-warm and the Stats tab preloading off screen send `warm=1`, and the route writes a new read only for someone with a `stats_open` in the last 30 days, answering 204 otherwise so `useInsight` asks again once Stats is on screen; an EMPTY read is cached (`InsightDoc.empty`) instead of re-asking the model on every open.
- **Active-name chain** — real identity (`badminton_identity`) → `badminton_stats_preview_name` → signed-out state. **`lib/useActiveName.ts` is the single owner**; every consumer calls `useActiveName()` and `__tests__/active-name-canary.test.ts` fails the build if the chain is re-derived anywhere else (it had been copy-pasted into five modules, four of which had stopped subscribing to identity changes). **The preview-name step is DORMANT: nothing in the app writes that key** — the picker that did left in Stage 8, so today the chain is effectively identity → signed-out. The mechanism and its tests are kept for the day admin-browses-someone-else's-stats returns; don't document it as a live path, and don't assume a preview name can occur. If it ever returns, the key stays separate from `badminton_identity` and is NEVER written into it — that would mint a fake `deleteToken` and break self-cancel.
- **"Your skills" is you against yourself; "Where you sit" is you against the club** (Stats canvas, 2026-10-20). No club figure appears in `SkillTrendCard` or `DimensionBars`: the median and the club's middle half per side (`dimensionSpread`, additive in `lib/clubBands.ts`) are drawn only in `WhereYouSitCard`'s By side panel, and only once the comparison is revealed — a dot against the club IS a comparison. The phase names are plain club words (Beginner → Competitive); the stored `Phase` keys did not change. A card switches the Stats register through `useOpenStatsRegister()` (`components/stats/statsTakeover.ts`), as Work on next does to reach Learn.
- **Club comparison is consent-gated.** `useStatsPrivacy` + `ClubConsentSheet` ask once on first run, and closing the sheet (✕, Escape, swipe, back) saves "Keep it private", so it never returns and the choice lives in Profile → Stats & privacy (Grant, 2026-11-02: it blocked the tab bar); `isComparisonRevealed()` requires BOTH a stored `clubComparison` preference AND a non-null `promptedAt` — the stored preference alone is not consent. Both comparison-dependent cards are keyed on the answer so saying yes remounts them and they re-read the bands endpoint without a reload.

### Avatars

A member's picture is a RACKET, never an upload: `Member.avatar = { kind: 'racket', racketId }` (`lib/memberAvatar.ts`), drawn as the head of that racket's pre-rendered catalog image (`public/rackets/<id>.webp`, `racketSrc`). Absent = the initial. Chosen in Profile's `AvatarSheet` (my racket / shuffle / initial) and written by `PATCH /api/members/me { avatar }` with the member's own cookie or an admin.
- **`components/primitives/MemberAvatar.tsx` is the one avatar**, everywhere a name appears; `lib/useMemberAvatars.ts` is the one read (`GET /api/members`, module-cached, looked up only where an avatar renders). Don't hand-roll an initial circle or fetch avatars per card.
- **"My racket" is copied at save, not followed**, so a roster costs one `members` read and no gear read per name — and a racket becomes a public picture only when its owner picks it, because club gear is otherwise cohort-gated (`CLUB_GEAR_MIN_COHORT`).
- A racket avatar sits on a ground picked against its OWN frame paint (`racketAvatarGround`: light behind a dark frame, dark behind a light one) — the per-name colours swallowed both. Initials keep the per-name colour.
- **A roster-sized avatar (≤ `AVATAR_CROP_MAX_PX`, 48) loads the HEAD CROP**, `public/rackets/avatar/<id>.webp` (`racketAvatarSrc`): 128 px, flattened onto that racket's ground, ~3 KB where the list picture is ~18 KB (2026-11-05). Profile's 112 px circle keeps the full picture. Served through `assetUrl()` like the other racket pictures, so they move to Blob Storage with the rest (`scripts/assets/upload.sh` sends all of `rackets/`). `node scripts/make-racket-avatars.mjs` cuts them; the rule for the ground is `racketGround` in `lib/racketLook.ts` (the script imports it), and `__tests__/racket-avatar-images.test.ts` fails on a racket with no avatar or an avatar on the wrong ground.

### Kudos

Positive-only peer recognition (unconditional; `NEXT_PUBLIC_FLAG_KUDOS` retired 2026-09-10, #352). Two
entry points, one sheet: `GiveKudosCard` on Stats → **Play**, and a per-name
button on each row of Home's sign-up roster (the opened `WhoElseIsIn` list). Both open `GiveKudosSheet`; passing `recipient`
fixes the person and hides the picker.

- **Eligibility is anyone you shared a roster with in the last
  `CO_PLAY_LOOKBACK_SESSIONS` (8) sessions**, not the active one. `lib/
  kudosEligibility.ts` is the SINGLE owner, shared by the POST that enforces it
  and `GET /api/kudos/eligible` that lists it — when those were separate, the
  card built its list one way and the server refused it another. Rebuilt from
  real feedback: the old rule was "both on the ACTIVE roster", and the owner
  advances the session minutes after play, so the people you had just played
  with stopped being eligible almost immediately. Reported as "kudos goes away
  with the session too fast"; it was actually instantly.
- **`recentSessionIds` puts the ACTIVE id FIRST.** That is the only way the
  legacy `'current-session'` id is reachable — it does not match
  `session-YYYY-MM-DD`, so a prefix filter alone silently excludes the session
  most people just played. Its `sessions` query is bounded with `ORDER BY ...
  LIMIT` in SQL, not only by the JS slice: that container is partitioned by
  `/sessionId`, so an unbounded `SELECT` is a cross-partition scan on every card
  mount and every send. **The per-session roster reads it leads to run
  CONCURRENTLY** (2026-10-21), one `@sessionId` query per session merged in
  session order — never one `ARRAY_CONTAINS` query, which the mock would answer
  with every row — and the POST path proves by every roster first, reaching
  for the game logs (again all at once) only when no roster did.
- **`GiveKudosCard` must never return `null`.** It renders loading / expired /
  error / honest-empty / ready, always. Returning null when there was nobody to
  thank is what made the feature unfindable — a player asked "how do I give
  kudos to other people?" and the owner's own answer was wrong, because nobody
  could see the rule. **A 401 is NOT "signed out"** (that returns before the
  fetch): it can only mean a `member_session` expired past its 30-day TTL while
  `badminton_identity` persisted, so it renders a re-auth line, never the empty
  state.
- **`raterName` is a DOCUMENTED EXCEPTION to the strip-canary rule, and only
  alongside a note.** `raterMemberId` remains strip-only. A bare tag stays
  anonymous; a NOTE is signed, because "someone noticed" is worth much less
  than "Lin noticed" and praise nobody can ask about is not much of a gift.
  `visibleNotes()` is the only path that carries it and drops every kudos
  without a note, so an unsigned tag can never become attributable by sitting
  next to one that is. The `KudosNote` type has no `raterMemberId` field at
  all — it is structurally impossible to leak one through it.
- **"Your kudos" is a page in Play** (`KudosAllPage`, opened from "All your
  kudos" on `GiveKudosCard`, shown in place of the register's cards like Your
  fit). It reads the same `GET /api/kudos`, whose additive `months` field
  carries a bare tag only as a count in its month — never a date, an order or
  a name (`kudosByMonth` in `lib/kudos.ts`).
- **Dedupe is per ISO WEEK** (`isoWeekKey`), not per session. Per-session
  stopped meaning anything once eligibility left the session behind.

### Equipment Tab

See `components/stats/CLAUDE.md` — loads automatically when working in that directory.

### Push Notifications

The full rules are in `.claude/rules/push.md`, which loads with the push files, `public/sw.js` and the session route. These hold everywhere:

- **The service worker is push-only**: `public/sw.js` has no `fetch` handler, which keeps the legible-fail offline posture (`__tests__/service-worker.test.ts`).
- **`lib/push.ts` is the only sender and never throws**; 410/404 deletes a subscription, every other status keeps it.
- **Every send is best-effort after its primary write**, and a broadcast goes to the club's roster (`rosterMemberIds(groupId)`), never `sendPushToAll`.
- **`NEXT_PUBLIC_VAPID_PUBLIC_KEY` is build-time** (it must be in `deploy-next.yml`), and rotating the VAPID pair breaks every subscription.

### Native Shell (App Store / Google Play)

A **Capacitor 8 WebView that loads the LIVE URL**, so a web deploy is already a native update. The full rules (OAuth handoff, push, migration link, badge, widgets, calendar) are in `.claude/rules/native.md`, which loads with `ios/`, `android/`, `native/` and the native bridge files. These hold everywhere:

- **`lib/native.ts` `isNative()` is the seam**, and every `@capacitor/*` package is a dynamic `import()` inside an `isNative()` branch (`__tests__/native-imports.test.ts`).
- **OAuth runs in the SYSTEM browser sheet** — a separate cookie jar, bridged by `lib/authHandoff.ts`.

- **`.well-known` at the domain root** (universal links, App Links): `proxy.ts`
  answers from a `WELL_KNOWN` table with env bodies (`APPLE_APP_SITE_ASSOCIATION`,
  `ANDROID_ASSET_LINKS`) after the `next.config.js` rewrite gets the root path
  inside `/bpm` — both mechanisms, neither alone. JSON bodies are parsed first;
  invalid → 404, not a 200 that verifies nothing. The assetlinks SHA is the
  **Play App Signing** key, not the upload keystore — wrong is silent.
- **Legal pages** `app/legal/{privacy,terms,support,delete-account}` are async
  server components (no client state, no fetch, indexable) — the URLs both
  consoles require and a PIPEDA obligation on their own. Copy is arrays under
  the `legal` namespace read with `t.raw` (which `check-i18n-keys.mjs` cannot
  see; `__tests__/legal-pages.test.ts` pins the shape). **`deepMerge` replaces
  arrays** — it used to spread them into index-keyed objects and the Chinese
  page would have thrown. The delete-account CTA is `?tab=profile&intent=delete`;
  `HomeShell` keeps the intent until an identity exists and then opens the
  existing `DeleteAccountSheet`, so there is still one deletion path.
- **`?tab=` deep links survive React StrictMode now** — the URL-param effect
  strips what it reads, so dev's second run found nothing and fell through to
  `sessionStorage`. A ref guard; production never double-ran.
- **Safe-area top**: `viewportFit: 'cover'` (without it WKWebView reports 0),
  `.page-shell-top` on the shell's `<main>`, and `env(safe-area-inset-top)`
  folded into `.bpm-topbar`, `.bpm-page-header` and the fixed toggles.
- **`ios/` and `android/` are committed**; the hand edits on Capacitor's
  templates are pinned by `__tests__/native-shell-projects.test.ts`, because
  `cap add` would regenerate without them and nothing else would notice.
  **Firebase is optional at build time** (guarded `FirebaseApp.configure()`,
  Gradle applies the services plugin only if the JSON exists), so a shell AAB
  can start the Play closed-testing clock before the Firebase project exists.
  Never committed: `GoogleService-Info.plist`, `google-services.json`, keystores,
  `.p8`, profiles.

### Design System

The full rules (fonts, icons, backgrounds, radii, type and spacing scales, motion, buttons, primitives, the inner-content reference, the ESLint token guardrail) are in `.claude/rules/design-system.md`, which loads when Claude touches `components/`, an `app/` page or `globals.css`. These hold everywhere:

- **`app/globals.css` is the single source of truth for tokens.** Never import `docs/design-system/colors_and_type.css`, and never add a `next/font/google` import (`__tests__/design-canary.test.ts`).
- **A call site never types a raw number** for a font size, radius, spacing or colour; use the `--fs-*`, `--radius-*`, `--space-*` and `--icon-*` tokens. ESLint and the spacing and design canaries enforce it.
- **The `html:root` prefix on the field rules is load-bearing specificity** — never unscope it to a bare class.
- **Containers are fill-only, with no outer stroke** — a card, tile, option row or callout is a tint, and a selected one is a solid tint, never a ring. The few rims kept on purpose (Home's label chips, `.admin-hero`'s edge, the outlined `cc-btn` family, the status pills) are listed in the rule. A loading card holds its place with a skeleton the size of the card, never `null` or "Loading…".
- **Prefer the primitives** in `components/primitives/` (`CardHeader`, `StatusBadge`, `ListRow`, `ErrorState` / `EmptyState`, `MoneyInput`) and `<BottomSheet>` over hand-rolled layout.

## Planning Artifacts

The chain is `docs/plans/<slug>.md` → `docs/superpowers/specs/*-design.md` → `docs/superpowers/plans/*.md` → code → `CHANGELOG.md`. GitHub issues + milestones track status; they are not where the "why" lives.

- **`docs/plans/<slug>.md` is written FIRST, not as a write-up afterwards.** Copy `docs/plans/TEMPLATE.md`. The top half (Track / Problem / Kill criterion / Non-goals) is the gate for *starting*; `Decisions` and `Shape` are appended as the work proceeds, so one file spans intent → record. `Status:` walks `intent` → `in-flight` → `shipped <date>`. The six files predating this convention (push-notifications, value-hub-slice-0, visual-fields-direction, design-audit-remediation, offline-legible-fail, 2026-06-13-skill-followups) are accurate as records and were deliberately not retrofitted.
- **`Track:` is ROADMAP's Change Rule given a file.** That rule — every work item names the track or critical-path step it serves, or it's drift — had no artifact, so the gate was enforced by memory. Naming no track means opening a `later` issue, not starting.
- **The Problem section wants the player's or admin's own words.** "Kudos goes away with the session too fast" and "how do I give kudos to other people?" are why the kudos rewrite was correct; both survived only as CLAUDE.md prose written *downstream* of the decision they caused. A design doc justifies a solution — without a recorded problem there is nothing to check a shipped feature against.
- **Never restate architecture, env vars, deployment topology or conventions in a plan.** They live here and a copy rots: `ROADMAP.md` carried the dual-deployment table, promotion tags and `deploy-stable.yml` for weeks after all three were deleted on 2026-08-25 (corrected since). Link instead. Note this bullet ITSELF then went stale in the same way — it kept saying ROADMAP "still carries" them long after ROADMAP was fixed, which is the failure mode `__tests__/docs-canary.test.ts` exists to bound: it checks that a path a doc names still resolves, and cannot check a claim one doc makes about another.
- **`specs/*-design.md` should carry an `Intent: docs/plans/<slug>.md` header line**, so the chain is checkable by reading one line. No hook enforces this — every script in `scripts/` was written *after* this repo got burned by that bug class, and there's no burn here yet.

## Coding Conventions

- **CSS**: Use named classes from `globals.css` for shared patterns. No hard divider lines between list items. New shared patterns go in `globals.css`.
- **Segment controls**: Use `.segment-control` / `.segment-tab-active` / `.segment-tab-inactive` classes. The wrapper needs `flex` and each tab `flex-1 flex items-center justify-center` — `.segment-control` sets no `display`, so without `flex` the active pill overlaps its neighbor.
- **IDs**: Always `randomBytes` from `crypto` — never `Math.random()`.
- **Datetimes**: ISO 8601 with timezone offset via `withLocalTz(date, time)`. Never store plain `YYYY-MM-DDThh:mm:00`.
- **Session IDs**: `sessionIdFromDate(iso)` → `'session-YYYY-MM-DD'`. Legacy `'current-session'` exists in prod.
- **Cosmos DB**: Use `getContainer(name)`. **There are 24 containers**, grouped by partition key. The authoritative set is `lib/memberPurge.ts` (`OWNED_CONTAINERS` + `NOT_MEMBER_SCOPED` + `CLASSIFIED_ELSEWHERE`), which `__tests__/member-purge-coverage.test.ts` forces to stay complete, and `__tests__/docs-canary.test.ts` now compares THIS list against it. Add a container there in the same change you add it here.
  - **PK `/sessionId`** — `sessions`, `players`, `announcements`, `skills`, `gameResults`. **Always filter by `sessionId`** on these.
  - **PK `/memberId`** — `events`, `assessments`, `insights`, `playerGear`, `pushSubscriptions`, `drillCompletions`, `stringingJobs`, `ledger`.
  - **PK `/id`** — `members`, `birds`, `identities`, `authhandoff`, `releases`, `clubSettings`, `groups`, `payments`. Global; no sessionId filter.
  - **PK `/groupId`** — `memberships` (Phase 2 of multi-group; `lib/groups.ts` is the only writer). A person's role and roster name in ONE group, plus that group's name-reservation docs (`kind: 'name'`) in the same partition. Both are `provisioned: false` and lazily ensured on first touch — and an account deletion is a touch (`purgeMember` checks for owned groups), so they may exist as empty containers before the backfill runs.
  - **The two that are neither** — `kudos` is PK **`/recipientMemberId`** (a kudos is stored under the person who RECEIVED it, which is what makes "kudos for me" a single-partition read), and `equipmentCatalog` is PK **`/category`**. These are the two most likely to be got wrong by pattern-matching, and the mock store ignores the PK argument, so a wrong one passes CI and no-ops in production.
  - **Five PKs above are INFERRED, not declared**: `sessions`, `players`, `announcements`, `members`, `birds` predate `ensureContainer` and were created by hand in the Azure portal, so nothing in this repo declares their key. The values here match every `.item(id, pk)` call site, which is consistent with them but is not proof — ground truth is the portal. The other 19 are read from an `ensureContainer(name, '/pk')` call and are certain.
- **The container fold** (`docs/plans/container-fold.md`, 2026-10-14, copy run 2026-10-15): an e-transfer alias is a `kind: 'alias'` row in `clubSettings` (`lib/aliases.ts`), a problem report a `kind: 'feedback'` row in `releases` (`lib/feedback.ts`), and the PWA-to-native migration stash lives in `authhandoff`. The `aliases`, `feedback` and `authmigration` containers are gone from the code and deleted in the portal. The shared database was at Cosmos's 25-container cap and the alias container ran on its own dedicated throughput; the fold freed two shared slots. **It saved no money**: the account is on Cosmos's free tier (first 1000 RU/s free, `docs/azure.md` §9), so 800 RU/s cost $0 and so does 400 — read the pricing tier before multiplying RU/s by list price. **A new doc KIND goes into the container with the right partition key AND scope** — a GLOBAL kind never into a GROUP container (the reports could not go into `clubSettings`) — and a shared cabinet's reader checks `kind` on every point read, so one route cannot edit another kind's doc by id. The move itself was two PRs and one copy run: PR 1 wrote new rows to the new home and read it UNION the old container, with a key-gated admin copy route; PR 2 deleted the fallbacks and the route once the status read zero. Reuse that shape for the next fold.
- **`events` is append-only**: one doc per engagement interaction (`EngagementEvent`, `kind` allowlisted in `app/api/events/route.ts`). **Never convert it to an upsert** — the Value-Hub Slice-0 kill-criterion asks whether a member interacted "more than once", which needs the history. The `insights` container is the cautionary example: it upserts, so it can only ever answer "last seen". Writes are identity-bound via `verifyMemberAuth` with no admin-on-behalf branch, so an admin browsing another member's stats can't inflate that member's engagement. Client beacon is `recordEngagement()` in `lib/engagement.ts` — fire-and-forget by design, the one sanctioned exception to the legible-fail rule (nothing the user sees depends on it). Read the criterion via `GET /api/admin/slice0`.
- **Cosmos `item()` calls**: `container.item(docId, partitionKeyValue)` — the second arg is the partition key VALUE, not the doc ID. The mock store ignores partition keys, so wrong values only break in production. Always use the correct partition key (e.g., `sessionId` for skills/players containers).
- **New containers** must use `ensureContainer(name, partitionKeyPath)` from `lib/cosmos.ts` on first handler call — real Cosmos doesn't auto-create containers the way the mock does. **It is memoized per process since 2026-09-28** (one `createIfNotExists` round trip per container, a rejected attempt forgotten so the next call retries), so calling it at the top of a handler is free after the first request; the hand-rolled lazy `ready` promises older routes carried were removed on 2026-10-24 (`lib/catalogSeed.ts` keeps one because it memoizes the SEED, not the container, and `lib/events.ts` keeps one behind its test reset). **But the account sits at Cosmos's 25-container cap** (`docs/azure.md` §3; the 28th was refused in production on 2026-10-10, #587): a new doc KIND goes into an existing container, as the string purchases went into `clubSettings` (`docs/plans/string-inventory.md`). `ensureContainer` logs `[ensure-container]` on a refusal.
- **Bird usages**: `session.birdUsages` is an array of `BirdUsage` objects. Legacy single-object `session.birdUsage` is read-tolerated via `normalizeBirdUsages()` in `lib/birdUsages.ts` but never written. Next admin save promotes legacy docs to array shape.
- **Shuttle cost model is "pooled" (Model B, 2026-07-10)**: a session logs ONE "tubes used" number at a price-per-tube — no per-batch selection. The write shape is a single entry `{ pooled: true, tubes, pricePerTube? }` that `resolveBirdUsages` (`lib/birdWrite.ts`) snapshots to a `BirdUsage` tagged with the sentinel `purchaseId: POOLED_PURCHASE_ID` (`'pool'`, from `lib/birdUsages.ts`) via `snapshotPooledUsage(tubes, price)`. **Price resolution**: a manual `pricePerTube` (validated [0, 10000]) wins; else the AUTO price = `currentPricePerTube(purchases)` (the latest purchase's `costPerTube` by date, 0 if none). Cost still flows through the frozen `totalBirdCost`, so receipts / settle / history / `sessionCostTotals` are unchanged and purchaseId-agnostic. **Why the `'pool'` sentinel (not a real id)**: `remainingByPurchase` iterates real purchases, so it never attributes a pooled tube to a batch (per-batch remaining stays put), but `totalUsed` / `currentStock` sum every usage's `tubes` so overall stock stays correct; the DELETE referential guard and `AssignUsageSheet` (both match a real purchase id) simply ignore pooled entries. Consumers of the pooled control: `SetupPage` (finalize-cost card), `AdvanceSessionForm` (create-next-session). Both load legacy multi-batch sessions losslessly at a BLENDED price (`loadedCost / loadedTubes`) and flatten to a single pooled entry on save. The per-purchase (non-pooled) path in `resolveBirdUsages` is retained for the retro-assign `AssignUsageSheet` flow.
- **Birds container holds two doc kinds**: purchases (no `type` / `'purchase'`) and reconciliation adjustments (`type: 'adjustment'`, see `BirdAdjustment`). `GET /api/birds` splits them by `type`, returns `purchases` (purchases only), `adjustments`, `totalAdjustments`, `remainingByPurchase` (per-purchase `tubes − usedAcrossAllSessions`), and `currentStock = totalPurchased + totalAdjustments − totalUsed`. Any new sum over the birds container MUST filter `type !== 'adjustment'` or adjustment docs (which have no `tubes`) corrupt the math. `POST /api/birds/reconcile` takes `{ countedTotal }`, computes the delta against authoritative current stock, and writes one adjustment doc (undo = `DELETE /api/birds` by id). **`remainingByPurchase` is now misleading under the pooled model** (a pooled tube drops total stock but isn't subtracted from any batch, so batches look fuller than they are) — total numbers (`currentStock`, burn, runway) stay correct, but `BirdsPage` deliberately no longer surfaces per-batch "X left" or per-brand "weeks left" (stage 3b slim-down, #234). Brand cards show total "N bought"; the stock caption shows "$X/tube now" (`currentPricePerTube`). Don't re-add per-batch remaining UI without reconciling it against pooled usage first.
- **React `{0 && ...}` renders `0`**: Never use a numeric value as the left side of `&&` in JSX. Use `(value ?? 0) > 0` or `!!value` to get a boolean. This applies to `perPersonCost`, `prevCostPerPerson`, player counts, etc.
- **Cost inputs use `null` for empty**: `costPerCourt` form state is `number | null`. Empty input = `null`, displayed as placeholder "None". Send `0` to the API when null (API validates `typeof === 'number'`). The `$` prefix appears dynamically when value > 0.
- **Errors**: API returns `NextResponse.json({ error }, { status })`. Client shows it through `.field-error` (`role="alert"`, see the Design System section); the raw `text-red-400 text-xs` form this sentence used to prescribe has no sites left.
- **Theme**: `data-theme` on `<html>`, CSS custom properties in `globals.css`. Prefer existing Tailwind classes with light-mode overrides.
- **localStorage**: `badminton_identity` (JSON: `{ name, token, sessionId }` — use `lib/identity.ts` helpers), `badminton_theme`

## Security Rules

1. **`deleteToken` never in responses.** Strip after any GET/PATCH: `const { deleteToken: _dt, ...safe } = record`.
2. **`timingSafeEqual` for all secret comparisons.** Never `===` for PINs or cookies.
3. **Auth before DB.** Admin check at top of every admin route, before body parsing. **Mutating** handlers use `await isAdminAuthedWithMember(req)` (role re-check); read-only handlers may use sync `isAdminAuthed(req)`.
4. **Rate limit before auth.** Rate limiting first in handler so it can't be bypassed.
5. **`POST /api/claude` is admin-only.** Unauthenticated access would expose API key budget. Every `@anthropic-ai/sdk` importer is pinned to the Callers list in `docs/azure.md` by `__tests__/anthropic-callers-canary.test.ts`.
6. **`getClientIp(req)` for IP.** Reads the FIRST `X-Forwarded-For` entry, which App Service overwrites with the socket address, and **strips the `:port` App Service appends** — the source port changes per TCP connection, so keying on the raw entry gave every new connection a fresh bucket and made the long-window gates (`auth-signin` 5/hr, `admin` 5/15min, `auth-signup` 5/hr, `reset-access` 10/hr) resettable by reconnecting. `stripPort` is deliberately not a `split(':')`: a bare IPv6 address is all colons and no port, and splitting would key every IPv6 client on `2001`. Never `req.ip` (returns Azure proxy IP), and never the LAST entry (nothing appends after Azure, so keying on it makes the limit global). **It does NOT read `X-Client-IP` and must not again** — this rule asserted it did until 2026-09-12, on a comment claiming Azure set that header and stripped any caller-supplied value. Azure sets no such header, so it strips nothing: the caller's value arrived intact and was trusted ahead of the real one, and one changed byte bought a fresh allowance on every per-IP limit in the app. The only writer of `X-Client-IP` in this repo is the TEST SUITE, for per-test bucket isolation — production was trusting a test fixture. Fixed in #389; the suite keeps its isolation through `TRUSTED_IP_HEADER` (set in `vitest.config.ts`), which names the single header to trust and is also how a deployment behind another proxy points at `cf-connecting-ip`.
7. **`sessionId` override is admin-only.** Gate `?sessionId=` and body `sessionId` with auth check.
8. **Capacity-check restores and promotions.** `removed: false` or `waitlisted: false` must check active count first → 409 if full — when the row comes out HOLDING A SPOT. A restore that lands on the waitlist (the row was waiting when it left, or the body sends `waitlisted: true`) takes no spot and is not refused (2026-11-05, `docs/plans/money-off-session-list.md`).
9. **`purgeAll: true` is irreversible.** Hard-deletes all records including soft-deleted.
10. **Aliases require admin auth.** E-transfer names are sensitive payment data.
11. **PIN comparison hashes first.** `admin/route.ts` hashes both PIN and admin PIN to SHA-256 before `timingSafeEqual` to avoid leaking PIN length via timing.
12. **Member-scoped writes bind to the member cookie.** A name-keyed write that mutates one member's data (e.g. `equipment/gear` PUT) must require a `member_session` cookie matching the target member (`verifyMemberAuth` → `memberId`) OR admin — never name-only, since names are enumerable. The cookie is minted at sign-up (no PIN needed), preserving "anon-signup trust" while closing impersonation. (WS#3, 2026-06-03.)
13. **Club-data reads require a signed-in member** (`docs/plans/members-only.md`; its flag `NEXT_PUBLIC_FLAG_MEMBERS_ONLY` retired 2026-10-17, ON branch kept). Every `GET` that returns club data calls `await requireMember(req)` from `lib/auth.ts` after its rate limit and before its first read, and returns `gate.response` when `!gate.ok`. It passes an ACTIVE member (re-read via `requireGroupMember`, so a removed person's 30-day cookie stops working at once) or an admin (`POST /api/admin` mints only an `admin_session`). It used to be a pass-through with the flag off. **`__tests__/members-only-coverage.test.ts` classifies EVERY `GET` route** as gated, authed-elsewhere (naming the helper) or public (with the reason), and fails the build on one in none — so a new public read is a written decision, not a default. Hiding a screen is not the boundary: on 2026-09-13 a stranger could read the roster with who owed money, while the signed-out UI showed none of it. **The one sanctioned public club surface is `app/opengraph-image.tsx`** (the link preview keeps session details, Grant's call). **A page is a surface too**: `app/page.tsx` renders for every visitor and a prop handed to a client component is serialized into the HTML, so it server-rendered the announcement to anyone with `curl` after the route was gated. It reads nothing for a refused visitor; the canary pins that guard. **Reading is only half of it**: a new account needs an invite (`signupGroupFor` in `lib/inviteSignup.ts` refuses both terminals — email sign-up and the Google/Apple `complete-signup` — with one `invite_not_found`, and with groups off it also refuses another club's invite), and `POST /api/players` needs an account: a non-admin must be a signed-in active member, the name comes from that account and the body's `name` is ignored, and the rate limit is per MEMBER after a looser per-IP limit that still runs first (rule 4). Without the invite rule "signed-out sees nothing" protected nothing — an email address was enough to become a signed-in member of the only club. `groups/invite` and `groups/preview` (not `join`) are always open, so an admin can hand an invite out with one club (the `invitesOn()` switch went with the flag). `__tests__/members-only-accounts.test.ts` holds both halves. **ON in production since 2026-10-03 and PERMANENT (Grant, 2026-10-09); the flag retired on 2026-10-17 with its OFF branches (`docs/flag-retirements.md`).** (`GET /api/admin/sign-in-readiness`, the list that gated the flip, keeps an async admin check because it names unclaimed accounts; the procedure is in `docs/plans/members-only.md`.) **A member let in by an admin has a session and no credential**, so Home asks `/api/auth/methods` and shows "Keep your account" (Apple, Google, or an email and password — no PIN since 2026-11-07; `components/auth/KeepAccountPage.tsx`, opened as a page in place of Home) — **and that route answers for EITHER cookie** (`callerMemberId` in `lib/auth.ts`, 2026-10-10): `POST /api/admin` mints only an `admin_session`, the page gate lets it in, and reading the member cookie alone answered that phone the anonymous shape, so the card told an admin with a PIN to set one; straight after an approval the signed-out screen's ask PAGE shows the same "Keep your account" step before it signs the phone in (2026-11-08, Grant: "a real person approval steps … should be using a page not a sheet"). `GET /api/players` also strips `recoveryEvents` for non-admins — it is the failed-sign-in audit trail.

## Gotchas

Gotchas for one part of the app are in that part's rule (they load when Claude touches its files): `.claude/rules/app-shell.md` (tabs, launch screen, keep-alive, pull-to-refresh), `.claude/rules/home.md` (Home layout), `.claude/rules/auth.md` (sign-in, identity, the admin cookie), `.claude/rules/i18n.md` (translations), `.claude/rules/stringing.md`, and the Gotchas at the end of `.claude/rules/design-system.md`, `.claude/rules/money.md` and `.claude/rules/push.md`. The ones below apply to any edit.

- **Race condition on signup**: the capacity check and the insert are not one atomic step, so every write that takes a spot re-checks AFTER it lands (`reconcileCapacity` in `app/api/players/route.ts`, by `compareBySignup`) and undoes itself if it was the one over the line — a new row is deleted, a REJOIN is put back exactly as it was (2026-11-05; before, a rejoin skipped the check and could overfill by one, `__tests__/signup-capacity-race.test.ts`).
- **In-memory rate limiter**: Resets on restart. Single-instance only — every in-process store is registered with its scale-out verdict in `__tests__/single-instance-registry.test.ts`, and an unregistered module-level `Map`/`Set` in `lib/` or `app/` fails the build. The ones that go STALE on a second instance are the session-pointer memo, the level calibration cache, the catalog memo, `lib/stringShelfRead.ts`'s 60 s stock-band / club-count cache (a purchase logged on one instance reads old on another for up to a minute) and `lib/latestRatings.ts`'s fold of everyone's latest check-in behind the club bands (ten minutes since 2026-11-05, as is the level fold: every writer clears both, so the lifetime only bounds what no writer reports).
- **Cold starts**: none in production (B1, Always On — `docs/azure.md`). The idle `staging-badminton-app` shares that plan since 2026-10-14; its Free plan was deleted.
- **`NEXT_PUBLIC_BASE_PATH` must match `basePath`**: Both must be `/bpm` or API fetches 404. **`next.config.js` does NOT export it** — it sets `basePath: '/bpm'` server-side only, so the client bundle gets the value purely from the env (`.env.local` / shell). `.env.local.example` now includes `NEXT_PUBLIC_BASE_PATH=/bpm` (so `cp .env.local.example .env.local` works out of the box), but any launch with neither a `.env.local` nor the explicit var is broken: the client reads `BASE = process.env.NEXT_PUBLIC_BASE_PATH || ''` → fetches `/api/*` with no prefix → every request 404s → `reportFetchFailure` cascades into a **false "You're offline / Couldn't load" state across the whole app** (server is fine). Tell: dev log shows `GET /api/players 404` (no `/bpm`). An offline launch without a `.env.local` must pass `NEXT_PUBLIC_BASE_PATH=/bpm` explicitly — see `.claude/skills/run-badminton-app/`.
- **`endDatetime` is optional**: May be absent in legacy records. Guard with `session?.endDatetime ? ... : false`.
- **`signupOpen` defaults to open**: Absent = open. New sessions via advance start closed.
- **Announcements are session-scoped**: Advancing hides old announcements.
- **`pinHash` is a strip-canary**: like `deleteToken`, it must be removed from every GET/PATCH/POST player AND member response. The strip pattern in `app/api/players/route.ts` and `app/api/members/route.ts` destructures both fields. New endpoints that return player or member records must mirror this — search for `pinHash: _ph` to find existing strip sites. Audit caught a regression on `/api/members` POST/PATCH/DELETE/admin-GET in 2026-05-06; all four are now stripped.
- **Lying empty state is forbidden**: `catch { setX([]) }` on a fetch failure renders the same UI as legitimate "no data". This is exactly how the v1.3 Cosmos misconfig disaster (`feedback_cosmos_silent_failure_diagnosis.md`) silently masked broken backends. Every card component must distinguish loaded-empty from load-failed — track a `loadError` state + render an explicit error pill ("Couldn't load — refresh to retry") instead of confidently zero stats. Apply this across the Command Center cards (`AdminConsoleHero`, `AdminDashTiles`, `PaymentsCard`, `AnomalyFeed`). **The rule holds on the SERVER too**: a GET whose read throws answers `{ error: 'read_failed' }` with 503, never a default or empty body with a 200 — the client's `loadError` can only fire on a non-ok status, and `GET /api/session`, `/api/members` and `/api/sessions` each answered a Cosmos outage with a 200 until 2026-09-28, and `/api/members/me` until 2026-10-21 — a 200 of `hasPin: false` that Profile, the first-PIN gate and the consent sheet read as a fact about the member (`__tests__/read-failed-503.test.ts`).
- **"Dormant" is `lib/dormant.ts`** (`isDormant`, `isNewMember`), shared by Profile's admin row, the Roster tile and the Roster page. Nobody is dormant in their first `DORMANT_DAYS` (60) in a group (Grant, 2026-10-09), counted from the membership's `joinedAt`, which `GET /api/members` sends to admins only; it falls back to `Member.createdAt`. The two hand copies it replaced counted a brand-new organiser as "1 need you".
- **Session times display in Vancouver time, whatever the group's zone** (`DatePicker`, the `fmt` helpers). `withLocalTz` stamps the BROWSER's offset when a session is saved, and the display is pinned to `America/Vancouver`, so an organiser outside Pacific time would see their 7 PM as 4 PM. Harmless while every group is in BC; it wants a per-group zone before one is not. Found on the create-a-group walk (2026-10-09), where a UTC test browser showed 7 PM as noon.
- **A rule added to a shared function is worthless if a caller reimplemented it.** When told "we already check that", check WHERE: `app/api/session/advance/route.ts` once kept its own copy of the settings-drift comparisons, so a check added to `lib/anomalies.ts` never ran at advance time — the same family as the ten copy-pasted resolvers `lib/memberResolve.ts` exists to prevent.
- **A recorded value nobody compares is not a check.** `detectSettingsDrift` flags `deadline_changed` past a 6-hour tolerance — not zero, because a DST crossing moves the offset an hour through nobody's decision, and a warning that fires twice a year for nothing is one people learn to dismiss unread. **Presence against absence always flags, with no tolerance** (2026-10-21; the first cut compared only when both weeks had a deadline, so a REMOVED one — sign-ups that used to close now staying open — was never mentioned): the snapshot writes `deadlineOffsetHours: null` for "recorded as none" (a legacy `0` reads as none too), and a snapshot that never recorded the offset (`undefined`) never flags.
- **Atomic appends > read-modify-write via PUT**: a client-side read-then-PUT on a shared doc can wipe the doc if the read step fails (the subsequent PUT writes a tiny object over a big one). For per-field appends like dismissing an anomaly, prefer a dedicated POST that does the merge server-side. See `POST /api/session/dismiss-anomaly` for the pattern.
- **A cache that reads before it checks saves nothing.** Check the TTL before any read, and let the writers invalidate (`POST /api/games`, `POST /api/assessments` → `invalidateGroupCalibration` in `lib/levelStore.ts`; `POST /api/assessments` and `purgeMember` → `invalidateLatestRatings` in `lib/latestRatings.ts`). The ratings fold memoizes against real Cosmos only, like the session pointer. `sharedFetch` (`lib/sharedRead.ts`) dedupes one request per path while in flight, and since 2026-11-05 also hands a LANDED ok answer to a later caller for 8 s **only while the page has written nothing since** — `watchWrites()` (installed by `HomeShell` at module load) counts every non-GET request except the usage beacons (`/api/events`), so a refetch after a sign-up, a payment or a PIN change still goes to the server (`docs/plans/startup-speed.md`; opening the app went from 35 requests to 27); `/api/players/unpaid` reads player-first (`lib/owedRows.ts`). **Never `LOWER(c.field)` in a cross-partition WHERE**: Cosmos cannot use the index for it and LOADS EVERY DOCUMENT (a full scan); `STRINGEQUALS(c.field, @x, true)` is an index scan that loads only the matches (learn.microsoft.com/azure/cosmos-db/index-overview#index-usage). The owed-rows legacy-name read did a full scan of `players` on every Home open until 2026-11-05. Inside one partition (`c.sessionId = @sessionId AND LOWER(...)`) it is a small read and stays. A read of the GLOBAL catalog goes through `catalogByCategory` (`lib/catalogQuery.ts`), the one place its partition-key hint is written.
- **Mixed-window rate calculations are silent bugs**: if you compute `X / Y`, make sure X and Y span the same time window. Burn-rate was previously `totalUsedAcrossAllSessions / recentSessionCount` which inflated by ~12× for groups with 2 years of history. The API now exposes `burnPerSession` so all callers agree.
- **Component tests need `afterEach(cleanup)`**: Per-file `// @vitest-environment jsdom` docblock enables component tests, but Vitest globals aren't configured — so `cleanup()` from `@testing-library/react` must be called manually between cases when multiple tests render overlapping text. See `__tests__/components/CardHeader.test.tsx` for the pattern.
- **Catalog seeding REFRESHES, it does not only fill.** `ensureCatalogSeeded` rewrites a row when it is missing OR its seed-owned fields differ — only rows marked `seeded: true`, comparing with SORTED keys (Cosmos keeps no key order). In dev the JSON file IS the catalog, so fill-only seeding passes every local test and skips rows in production (`docs/gotchas-history.md`).
- **Backticks inside a double-quoted `git commit -m` are command substitution** — a phrase was silently deleted from a commit message that way. Use `git commit -F -` with a **quoted** heredoc (`<<'MSG'`); the quotes stop all expansion. Same family as the heredoc `!` hazard.
- **A per-task review scoped to its own diff cannot see cross-file breakage** — hence the full gate between tasks (Quick Start); the lint baseline is 0 errors, so a regression there is unambiguous.
- **`next.config.js` sets `agentRules: false`.** Next 16.3 appends a
  `<!-- BEGIN:nextjs-agent-rules -->` block to `CLAUDE.md` on every `next dev`
  / `next build`, and re-adds it if removed, so the file reads as modified
  forever. This file is hand-authored documentation, not a generated artifact.
  Flip to `true` (or drop the line) to take the block instead.
- **`smoke-prod.mjs` proves Cosmos from `GET /api/releases`, not `/api/session`.** It is deliberately signed out, and members-only turns the session read into a 401 — reading `_rid` there would have failed every deploy the day the flag flipped. `releases` is app data, stays public, returns raw documents and 503s rather than lying empty. The session check now accepts exactly two shapes: a 200 carrying a session, or the members-only 401; any other status fails. The page check likewise accepts either HomeShell's nav or SignedOutShell's `data-signed-out-welcome` buttons — with the flag on, the signed-out welcome is the only page it can see.
- **`.azure/` is gitignored**: Never commit.
- **Mock store**: Test without DB by omitting `COSMOS_CONNECTION_STRING`. Verify mock query filters match real Cosmos queries.
- **The mock store filters by PARAMETER NAME, not SQL — and an unrecognised name means NO filter.** `lib/cosmos.ts`'s `query()` does not parse SQL. It applies one filter per name it recognises (`@sessionId`, `@memberId`, `@name`, `@id`, `@stringerId`, `@recipientMemberId`, `@raterMemberId`, …) and ignores the WHERE clause entirely, so a query using any other parameter name silently returns **every row in the container**. Note the direction: the documented partition-key hazard above makes the mock *laxer* than production; this makes it **more destructive**. Rules: name every parameter for its field; for anything DESTRUCTIVE re-check the predicate in JS before acting on a row; and never write one query with `OR` across two parameters, because the mock ANDs them (one filter each) while Cosmos ORs them — split it into two queries and merge by id. **The mock honours `!=`/`<>` on `@id` by reading the query text** (`c.id != @id` excludes the row; a plain `=` selects it — `__tests__/mock-store-neq.test.ts`), because the rename-collision 409 in `PATCH /api/members` was unreachable while the mock read every `@id` as equality; a new inequality on any OTHER parameter needs the same treatment or it silently inverts in tests.
- **Mock-store dev seeds**: `SEED_DEV_ADMIN=Name:NNNN` seeds an admin member; `SEED_DEV_SCENARIO=fresh-thursday` seeds a clean signup-open session + 6 famous-player invite-list members (Lin has PIN 2468). `SEED_DEV_SCENARIO=six-feathers` adds a SECOND club beside it — a full 4-court Saturday list of 32 with drop-ins waiting (organiser Chong Wei / 1357, member Taufik / 2468; `docs/plans/six-feathers-onboarding.md`). All of them refuse to fire when real Cosmos is configured. Use for end-to-end signup → settle → cover testing without touching prod data. Implemented in `lib/cosmos.ts` `seedDevAdminIfRequested` / `seedDevScenarioIfRequested`.
- **Every server-mutating call carries its own credential** (admin cookie, member cookie, or a `body.pin` verified against `member.pinHash`); a client stitching two calls into one action proves nothing to the second (`__tests__/players-signup-with-pin.test.ts`).
- **Automation hooks** (`.claude/settings.json` + `scripts/`): SEVEN, each tied to a bug class this repo hit (`docs/gotchas-history.md`).
  - `check-flag-sync.mjs` (PostToolUse) — a flag in `lib/flags.ts` missing from `deploy-next.yml` is silently off forever (`NEXT_PUBLIC_*` is baked at build time); also reports overdue `plannedRemoval` dates.
  - `check-i18n-keys.mjs` (PostToolUse **and a CI step**) — resolves every `t('...')` against its `useTranslations()` namespace in both locales, because **next-intl does NOT throw on a missing key**: it renders the key path on screen. **The genuine i18n CRASH is `t.raw()` + `.map()`** — go through `rawList()` in `lib/rawList.ts`.
  - `check-lint-errors.mjs` (PostToolUse) — ERRORS only, on the edited file; catches a deleted component stranding the imports it was the last consumer of.
  - `check-schema-additive.mjs` (PostToolUse) — warns when a field leaves `lib/types.ts`; a rollback runs older code against the same live DB.
  - `block-tab-screenshot.mjs` (PreToolUse on Bash) — refuses a headless screenshot of a `?tab=` URL or one using `--virtual-time-budget`; both produce a plausible image of the WRONG screen.
  - `block-secret-commit.mjs` (PreToolUse on Bash) — refuses a `git commit` whose STAGED diff carries a credential shape or stages an env file / `*.bak` / `*.orig`. Deliberately narrow: a gate that flares on `package-lock.json` gets muted.
  - `.claude/hooks/session-start.sh` (SessionStart) runs `check-flag-sync.mjs` and `check-plan-reviews.mjs` once — overdue flags and plan docs past their `**Review on:** YYYY-MM-DD` header, before the first edit; silent when clean, never blocking.
  - **The nine `scripts/` checks are tested** in `__tests__/hooks/scripts.test.ts` against throwaway fixture trees — a hook that stops firing looks exactly like a clean edit. (Both counts here are pinned by the docs canary.)
- **Looking at the app is a verification step, not a nicety.** `.mcp.json` registers `playwright-isolated` (the plugin's Playwright server holds ONE persistent profile lock, which blocked every screenshot for a whole session). Use the **`verify-ui` skill**. jsdom applies no stylesheet, so every spacing assertion in the suite measures `0px` — layout canaries must be SOURCE scans (`__tests__/card-spacing-canary.test.ts`), and a green suite is weak evidence for visual or seam work.
- **`.env*` files are hook-blocked from `Edit`/`Write`**: a PreToolUse hook returns "Do not edit .env files — edit them manually outside Claude Code." Workarounds: (a) print the diff for the user to paste into their editor; (b) use Bash + `sed -i.bak` which the hook doesn't intercept. The hook is intentional — `.env*` shouldn't be auto-edited.
- **Test fixture names**: use names clearly non-overlapping with the user's real domain. `SEED_DEV_SCENARIO=fresh-thursday` uses famous badminton player first names (Lin, Viktor, Carolina, Akane, Kento, Sindhu) — instantly recognizable as fixtures by any badminton player. Earlier generic choices (Bruce, Sophia, Josh) collided with real friend-group member names and caused "is this the seed or real data?" confusion mid-test.
- **`pkill -f "next dev"` exit codes**: a background-task tracker often reports exit 143 (SIGTERM) or 144 — these are *clean kill signals*, not failures. If the curl that follows succeeds, the server was already up and was killed deliberately; ignore the "failed" status from the tracker.
- **`public/` art is cached for a day** (`next.config.js`: `rackets/`, `brand/`, `icons/` get `max-age=86400, stale-while-revalidate=604800`; Next's own default is `max-age=0`). The names are not hashed, so a file REPLACED under the same name can take a day — up to a week behind the stale window — to reach a phone. Give a redrawn file a new name if it must show at once. `sw.js`, the manifest and `payments/` are deliberately left out.
- **Announcements are stored as raw markdown text**: the API accepts any string (up to 800 chars) and `HomeTab` / `AdminDashboard` list rendering both route through `renderMarkdown()` from `lib/miniMarkdown.tsx`. Legacy plain-text announcements render identically (no markdown tokens in them). Server does not parse, normalize, or sanitize the string — the parser is JSX-only with no raw-HTML injection API, so XSS cannot originate from this path even with hostile input.
- **`PATCH /api/session/bird-usage` vs `PUT /api/session`**: `/api/session` PUT replaces the entire active-session doc and only targets the active session. `/api/session/bird-usage` PATCH is additive: it upserts a single purchase's entry in a specific session's `birdUsages` array, by `sessionId`, so admins can retro-assign tubes to archived sessions from the bird inventory page. Posting `tubes: 0` removes the entry (undo). Both paths validate tubes ∈ [0, 100] in 0.25 increments and look up the purchase for authoritative cost snapshotting.
- **Offline posture is "legible-fail"** (`lib/useOnline.ts`). New network-mutating UI MUST gate on `useOnline()` (disable + the app-wide banner explains why) — never execute-then-break. The admin subtree is wrapped in `<AdminErrorBoundary>` (render-throw + ChunkLoadError net; auto-reloads on reconnect; "Reload now" disabled while offline). Full-reload-while-offline is unsupported by design: the only service worker we ship is push-only and has **no `fetch` handler**, so nothing is ever served from cache. See `docs/plans/offline-legible-fail.md` and the Push Notifications section below.
- **Unknown ≠ known-false** (the auth twin of the lying-empty-state rule): a failed/pending probe must not render as a confirmed negative. Tri-state it — e.g. HomeShell's `adminKnown` gates the admin-tab bounce so a reload on `?tab=admin` doesn't kick you off before auth resolves.

## Feature Flags

**There is ONE deployment.** `main` deploys to production three times a day (`deploy-next.yml`'s schedule, off-peak in Vancouver) when something the app is built from changed, or at once from "Run workflow" (since 2026-11-05; it was every push until then) via `deploy-next.yml` → the `vnext-badminton-app` app service → https://bpm.grantzou.com/bpm. The second deployment (`bpm-stable` / the `badminton-app` app service) and its B1 plan were **deleted 2026-08-25**, and `deploy-stable.yml` went with them. (`staging-badminton-app` still exists and is deliberately kept — it holds no deployment and nothing deploys to it. Since 2026-10-14 it sits on the PRODUCTION plan `granxyzou-vnext-bpm`, not a plan of its own: its Free plan `ASP-grantzou-b0c9` was carrying a second Defender for App Service charge, more than the app's own compute, so Grant moved the app and deleted the plan. An idle app on the same plan costs nothing.) Flags therefore no longer stage work *between deployments* — they gate unfinished work inside the single one, and their `plannedRemoval` dates are the only thing keeping them from becoming permanent.

- **Flag convention**: `NEXT_PUBLIC_FLAG_<STAGE>_<FEATURE>` (e.g., `NEXT_PUBLIC_FLAG_DESIGN_PREVIEW`). Must be registered in `lib/flags.ts` `FLAGS` registry — the typed `FlagName` union prevents typo'd lookups.
- **Reading flags**: always `isFlagOn('NEXT_PUBLIC_FLAG_X')` from `lib/flags.ts`. Never `process.env.NEXT_PUBLIC_FLAG_X` directly — Next.js only inlines literal accesses, and the helper's switch statement guarantees each flag is inlined.
- **Canonical value**: only the literal string `'true'` means on. `'1'`, `'yes'`, `'TRUE'` all read as off. Prevents accidental enablement from typo'd Azure App Settings.
- **Server vs client**: for flags that gate API response shape or DB writes, read the flag on the server only. Client flags can't protect the database — a user with devtools can flip bundle flags but cannot flip server env vars.
- **Env detection**: `getEnv()` returns `'stable' | 'next' | 'dev'` from `NEXT_PUBLIC_ENV`. `<PreviewBanner />` uses `isPreviewEnv()` to render the "preview build" warning. Production deliberately sets `NEXT_PUBLIC_ENV: stable` so the banner stays OFF — it is an env identifier, not a feature flag, and setting it to `next` made production advertise itself as a preview.
- **Retirement rule**: every flag in `lib/flags.ts` has a `plannedRemoval` **ISO date** (`YYYY-MM-DD`) — ship date + 2 weeks. Anything a date cannot carry goes in the optional `note` field. `__tests__/flags.test.ts` enforces the shape: a date, or an entry on its documented `DATELESS` exemption list, and it must parse to a real day (`2026-06-31` matches the regex and is not one).
  - **The date replaced a prose condition** that silently became impossible on 2026-08-25 (`docs/flag-retirements.md`).
  - `scripts/check-flag-sync.mjs` REPORTS overdue flags when the registry is edited, and never blocks — being late is a backlog, and a hook that failed on eleven of them would be muted in a week.
  - **Retiring a flag means deleting the `off` branch, not just the switch** — it has shipped untested for months. The CSS half is the risky half: a selector list is a shared rule, so deleting "every rule mentioning the legacy class" can orphan the selectors grouped with it. Both burns: `docs/flag-retirements.md`.
- **Test requirement**: meaningful code paths gated by a flag should have tests covering both the `on` and `off` branches. Trivial UI-only flags (copy swaps, style tweaks) can skip. See `__tests__/flags.test.ts` for the pattern (mutate `process.env` in `beforeEach`).

## Deployment

One deployment, trunk-based: `main` deploys to production three times a day when something the app is built from changed (a scheduled run that finds only `docs/` or Markdown other than `CHANGELOG.md` changed is skipped), and "Run workflow" on `deploy-next.yml` ships `main` at once. **Grouped since 2026-11-05** (Grant: "the app is getting really slow"): every deploy restarts the server, emptying its in-memory caches, and renames the code files it changed, which every phone downloads again on its next open — once per merge was five times on a busy day. So a merge is NOT live until the next scheduled run; press Run workflow for a fix that cannot wait. Full deploy / rollback runbook: run the `deploy-promotion` skill.

**Don't trust the names** — they are inverted. The app service called `vnext-badminton-app` **is** production; the one called `badminton-app` was the dead one and is now deleted. `deploy-next.yml` sets `NEXT_PUBLIC_ENV: stable` deliberately (a comment says so) — building production as `next` made it render the PreviewBanner. Verify which app is live by DNS (`bpm.grantzou.com` → `vnext-badminton-app`), never by name.

**Schema rule**: still additive-and-optional only. The reason changed — a rollback redeploys older code against the same live database, so a removed or renamed field breaks the build you roll back *to*.

**`main` is PR-only, with `verify` (pr-ci.yml) required and NO bypass — the owner included** (ruleset `BPM protect`, fixed 2026-09-02). Every change, docs included, goes branch → PR → green check → merge. Zero approvals required: the check is the gate, not a reviewer. The ruleset had existed since April with `conditions.ref_name.include: []`, which targets **no branch** — it read as protected and enforced nothing. When checking a gate, check what it *targets*, not whether it exists.

**The PR review bot** (`claude-code-review.yml`) applies `REVIEW.md` and posts **inline comments** on the diff. Three rules; the history is `docs/review-bot.md`.
- **The only proof a review happened is inline comments by `claude[bot]` inside the run window.** Check colour, duration, cost, turns and denial count all looked normal across sixteen runs that reviewed into `/dev/null`, and #357 merged hours after the bot had refuted its reasoning inline. Read the comment before merging.
- **Don't touch `--comment` or `--allowedTools` without a canary.** All three quiet failures were allowlist gaps; widening it for `Skill`/`Agent` or on cost grounds changed nothing and was reverted. Prove a change by planting ONE defect in a genuine, wanted PR — a self-announced canary PR is skipped by the plugin's eligibility step.
- **It silently skips a PR that modifies its own workflow file** (still green, ~12s), and bot-authored PRs are skipped on purpose (`if: github.event.pull_request.user.type != 'Bot'`); `verify` is the gate there.

## Testing

Tests use the in-memory mock store — no DB needed. Helpers in `__tests__/helpers.ts`. Each test gets a unique IP via `X-Client-IP` to avoid rate limiter collisions — which works ONLY because `vitest.config.ts` sets `TRUSTED_IP_HEADER: 'x-client-ip'`. Production ignores that header (security rule 6); don't remove the env line, and don't conclude from these helpers that the app reads it.
```bash
npm test              # run all tests (vitest)
npm run test:watch    # watch mode
```

**602 test files / ~6,119 tests** (2026-11-05). `__tests__/docs-canary.test.ts` fails the
build when the file count stated here drifts more than 10% from the tree — the
previous figure, 279 / 2712, sat a third short for weeks and read as current.
Covering API routes (admin auth,
player CRUD + self-pay, account-only signup + hijack guards, members, sessions,
session costs, birds + pooled bird usage, skills, releases, announcements,
stats, recovery PIN, push subscribe/unsubscribe, **self-service account deletion
+ its container-coverage canary**, **native-migration mint/claim + routes**,
**both OAuth handoff routes**), feature flags and their date shape, i18n parity
(and `deepMerge`'s array rule), component rendering, the push send library
(410-deletes vs 5xx-keeps, and the FCM twin), the service-worker
no-fetch-handler policy, the `.well-known` table, the legal pages' shape, the
native-import canary, the shell's hand edits, and the reorder arithmetic.

**Read the COUNT, not the colour.** A DROP in file count means files failed to
LOAD, which reports as an absence rather than a failure — see the Node floor in
`.npmrc`. And on a loaded machine (load average >100) vitest workers time out,
different files fail on each run, and the count sags: that is the box, not the
code. A normal full run is ~14s; if it takes minutes, stop and re-run rather
than debugging a moving target.

**A component test that renders a date from a UTC-midnight fixture passes
`timeZone="UTC"` to `NextIntlClientProvider`.** Without it the date formats in
the machine's own zone, so west of Greenwich it lands on the previous day:
`__tests__/components/LevelTrendChart.test.tsx` failed on a Pacific laptop and
never in CI, which runs in UTC (fixed in #707).
