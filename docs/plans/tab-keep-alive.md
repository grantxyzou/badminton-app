# Kept tabs, and a launch that opens them

**Track:** Mobile fluidity (`docs/plans/mobile-fluidity.md`) — the app people install is this app in a WebView, and a tab bar that reloads on every tap is the loudest "this is a website" tell after transitions.
**Status:** in-flight
**Review on:** 2026-11-04 — has anyone seen something out of date on a tab they came back to (a roster missing a sign-up, a balance already paid)? Has anyone said opening the app feels slower since 2026-10-21?

## Problem

Grant, 2026-10-21: *"Why does the app still feels slow it still has a lot of
loading stats everytime i tap on a new page."* And then: *"at app start up can
we let the full animation play end to end at least once and use that time to
preload so the app when first land seems complete and fast?"*

Measured before the change, on a local production build with a phone profile
(150 ms latency, 4x CPU), Home → Stats → Profile and round again: every tap
destroyed the tab being left and rebuilt the next one from nothing. Going back
to Home asked the server ten questions it had answered seconds earlier; Stats
eight, Profile five; each tap showed skeletons for 0.2–0.9 s, more in
production, where each request also crosses to Canada Central and re-checks
membership before reading.

## Kill criterion

- A member sees stale data on a kept tab and is misled by it (a sign-up they
  made does not show, a balance they paid still shows owed) → the return
  re-check is wrong or too slow; fix it, and if it cannot be made right, stop
  keeping that tab.
- Opening the app is reported as slower → the launch wait is not paying for
  itself; cut `APP_SETTLE_WAIT_MS` or stop holding the splash for Home.

## Non-goals

- A client data cache (stale-while-revalidate per resource, invalidated on a
  write). It is the larger, better step and the next one if first visits still
  feel slow; this keeps SCREENS, not data.
- Opening the Admin tab early. It is kept once VISITED (2026-10-25, Grant: "Admin
  is still choppy and slow") but never mounted before an admin opens it; only
  its code is fetched in the background, for admins only.
- Remembering tabs across a cold start. A quit still lands on Home, fresh.

## Decisions

- **Hidden, not unmounted** (`HomeShell`, `kept`). The pattern native tab bars
  use: a visited tab stays mounted under `hidden`, so going back shows what you
  left at once. A tab is kept only once the starting tab is RESOLVED, so the
  SSR'd Home is never fetched behind a restored Stats (the reason `deferFetch`
  exists).
- **Back after a while, it re-checks quietly** (`useTabReturn`,
  `lib/tabActivity.ts`): a tab away for `RETURN_REFRESH_MS` (10 s) or more
  re-reads in the background while its content stays on screen — Home's week,
  the balance card, the player's rackets and the bench. Quicker bounces ask
  nothing. Stats and Profile carry data only the member changes, so they are
  not re-read; pull-to-refresh is there for the rest.
- **Pull-to-refresh refreshes the tab on screen, not every kept tab**
  (`tabNonce`); a tapped notification refreshes the tab it opens. A group switch
  or join still remounts everything (`refreshNonce`).
- **Mounted is not on screen, so three things read `useTabActive()`**: a
  `BottomSheet` stays shut while its tab is away (it portals to `<body>`, out of
  the hidden panel); the one-shot arrival markers (the stringing intent, the
  Profile sub-screen) are consumed on ARRIVAL, not on mount; and `stats_open`
  fires on each visit, so a preloaded Stats nobody opened records nothing.
- **The other tabs open behind the launch screen**, once the first screen has
  settled (`appSettled` in `lib/appSettled.ts`, at most `PRELOAD_WAIT_MAX_MS`),
  so their reads never compete with Home's. Skipped when the browser asks to
  save data. About two dozen more requests per cold start, and none per tap
  after it.
- **The launch screen holds for a whole Home** (`docs/plans/launch-screen.md`,
  2026-10-21): the final shot plays for a signed-in member again, and it lifts
  once Home has no skeleton showing, at most `APP_SETTLE_WAIT_MS` after the
  shot lands. That reverses the 2026-10-03 cut, which made it leave at
  hydration; that wait bought nothing, this one loads Home and the other tabs.
- **"Finished loading" is read off the DOM**: no visible `.shimmer-line` in the
  tab on screen. Every loading frame in the app draws one, so no card has to
  report in; a card that never settles holds nothing past the caps.
- **Each tab keeps its own scroll position**, as a phone's tab bar does.
- **Admin is kept once visited, and its console stays under its pages**
  (2026-10-25). Measured before: opening Admin rebuilt it every time (15 reads,
  ~1 s of skeletons on a throttled phone profile), and every Back from an admin
  page rebuilt the console (14 reads, ~0.7 s of skeletons). After: a second
  open reads nothing, Back shows the console at once and re-reads it quietly
  (what the page changed must show), and the Admin code downloads in the
  background for admins, so the first open went from 4 code files and 587 ms
  of blocked main thread to 1 file and 154 ms. The Roster's add button, a
  portal, is hidden with its tab.

## Shape

| Piece | File |
|---|---|
| "Is my tab on screen?" and the return re-check | `lib/tabActivity.ts` |
| "Has the screen finished loading?" | `lib/appSettled.ts` |
| Kept tabs, preload, per-tab refresh, scroll memory | `components/HomeShell.tsx` |
| The launch wait | `components/launch/LaunchScreen.tsx`, `APP_SETTLE_WAIT_MS` in `lib/launchMotion.ts` |
| A sheet shut on an away tab | `components/BottomSheet/BottomSheet.tsx` |
| Return re-checks | `HomeTab`, `UnpaidSessionsCard`, `StringingCard`, `StringerJobsCard` |
| Arrival, not mount | `StringingTab`, `StringingCard`, `ProfileTab`, `SkillsTab` (`stats_open`) |
| Tests | `__tests__/components/HomeShell.keepAlive.test.tsx`, `__tests__/tab-activity.test.tsx`, `__tests__/components/LaunchScreen.test.tsx` |

**Measured after** (same build, same phone profile, same tour): every tab switch
showed no skeleton (under 20 ms) and read nothing — the only request was the
usage beacon. The cold launch: page at 0.5 s, Home complete at 2.05 s, the
other tabs open at 2.1 s, splash gone at 2.3 s.
