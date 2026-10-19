# Mobile fluidity — iOS and Android

**Track:** Native shell / store launch (the app people install is this app in a WebView).
**Status:** in-flight
**Review on:** 2026-11-15 — has a native build gone out since build 4 (2026-09-17), and which of the rebuild list rode with it?

## Problem

Grant, 2026-09-15: *"review app end to end and optimize for mobile. Both iOS and android, I want interaction and system fluidity."*

No player has reported a specific slowdown. This is a quality bar, not a bug
report — which is also why the findings below are ranked by what a person can
FEEL, not by what profiles worst.

Three read-only audits (client performance, interaction/motion, native shell)
produced the list. Everything named here was verified against the source; the
few items that were inference are marked.

## What shipped

| PR | What |
|---|---|
| #457 | Sign-Ups, Stats and Profile load on demand — opening Home used to parse all four tabs, and the two lazy ones are the expensive half (ProfileTab, and SkillsTab pulling the whole gear tree). Racket images carry their size, so lists stop reflowing. |
| #458 | 16px fields on touch (under 16px iOS zooms on focus and never zooms back — every form did it), a press state on the four tappable families that had none, 44px targets on touch, sheet overscroll contained. |
| #459 | The condensing header no longer animates `backdrop-filter`, `padding` or `font-size` — three per-frame costs paid *while scrolling*. |
| #461 | The Material Symbols subset is self-hosted (`lib/iconNames.ts` → `scripts/fetch-icon-font.mjs` → 11.7 KB in `app/fonts/`), so nothing third-party blocks first paint. Verified on production: the face is served from our origin and the page references neither Google host. |
| #462 | The club bands, kudos and games are read once per screen instead of twice (`lib/sharedRead.ts`). |
| #465 | Sheets drag down to dismiss, with a grabber. The grabber and the header are the grab surfaces; the body is not, because it is the scroller. |
| #468 | A sheet lifts above the on-screen keyboard (`components/BottomSheet/useKeyboardInset.ts`, `visualViewport`), and Android resizes the layout itself (`interactiveWidget: 'resizes-content'`). Search fields show a Search key. |
| #471 | Pull-to-refresh: a damped curve arming at ~100px of finger (was ~283px), the page no longer rubber-bands underneath (`overscroll-behavior-y: none`), listeners stay passive, no render per frame, a swell + Android tick on arming, and a sheet check asked of `lib/sheetStack` instead of sniffed from body styles. |
| this PR | A tapped notification switches tab IN PLACE (`lib/inAppNavigate.ts`) instead of `window.location.assign`, which replayed the whole launch inside an open native app; the web service worker now tells the window it focuses where to go, where before a tap went nowhere. |
| #650 | The translations leave the page. The layout handed the whole message tree to the provider, so ~37 KB gzipped rode in every no-store HTML; `components/intl/IntlProvider.tsx` imports it instead (English bundled, Chinese a dynamic import only a Chinese page fetches). Production signed-out page: 43 KB → 5.5 KB gzipped, read 2026-10-19. Racket images, brand art and icons in `public/` get a day's cache instead of a 304 every launch. `/api/players/unpaid` resolves the caller by their cookie's id and runs its reads together; Home's insight warm-up is the request Stats reuses. |
| #651 | Fewer member scans. A member asking about THEMSELVES is resolved by one point read on their cookie's id (`lib/memberResolve.ts`, groups off) — Stats ran the case-insensitive members scan six times on one open. The club bands fold everyone's latest check-in once a minute (`lib/latestRatings.ts`, cleared by a new check-in and by account deletion) instead of reading every assessment on every open. `GET /api/games?all=true` asks Cosmos for the player's games, not the club's. A non-admin's `GET /api/members` projects three fields. Profile asks `members/me` once. |

Each carries a canary, because none of this is visible to a rendering test:
jsdom computes every length as `0px`, and a static import or a re-added
transition passes every existing test.

## Decisions taken

- **`app/page.tsx`'s two awaits stay sequential.** The audit's top perf item was
  parallelizing them. `__tests__/members-only-coverage.test.ts` pins that
  order deliberately: a refused visitor must read nothing, so the sign-in check
  has to finish before the first read starts. Members-only is permanent since
  2026-10-17, so that check is now a real member read and the order costs one
  round trip; it is the price of the rule, not waste.
- **`.bottom-sheet`'s `88vh` is a fallback**, not the live value (`--sheet-max-h`
  is `88dvh`). No change needed.
- **Button blur stays.** `--btn-primary-bg` is translucent in dark mode, so
  `backdrop-filter` there is visible glass rather than a no-op. Dropping it
  would cut blur layers on screen; it is a design call, not a defect.
- **One provider, English bundled, Chinese imported on demand** (#650). Two
  providers chosen in the layout was tried first and measured worse: the layout
  then referenced both modules, and every page downloaded both languages.
- **`public/` art is cached for a day, not `immutable`** (#650). The file names
  are not hashed, so a redrawn racket keeps its URL; a year-long cache would pin
  the old picture. A day plus a week of stale-while-revalidate is the most a
  replaced file can lag.
- **A caller hint may only NARROW** (#651). It is taken when the point read finds
  an ACTIVE member whose stored name is the one asked about; anything else falls
  back to the scan exactly as before. Groups on, the name-reservation read is
  already a point read, so the hint is not used there.
- **The ratings fold is memoized against real Cosmos only** (#651), like the
  session pointer: the mock store is wiped between tests, and a memo there would
  hand one test the last one's club.
- **The narrowed games query keeps a fallback** (#651). Its `EXISTS` subquery is
  new to this codebase and nothing in CI runs it against Cosmos, so a refused
  query logs `[games-all]` and reads every game as before. **Look for that line
  in the production logs after #651 deploys**; if it appears, the narrowing is
  doing nothing and the query wants rewriting.

## Still open, web side (ships with a normal deploy)

1. **Duplicate reads ACROSS TABS** — the same-screen ones are done (#462, and
   Profile's two `members/me` calls in #651). A pass through the four tabs still
   reads `/api/session` and `/api/members/me` more than once, because every tab
   switch unmounts the old tab, so nothing is kept. These are seconds apart, so only a real TTL
   cache helps — and that trades a round trip for showing a stale roster after
   somebody signs up. **A decision, not a task**: `lib/sharedRead.ts` is
   deliberately a dedupe with no TTL for exactly that reason. Read again for
   #651 (2026-10-19) and declined again on the same ground.
2. **Stats asks `members/me` twice, one after the other.** The consent check
   reads it, and saying yes remounts the comparison cards, which read it again.
   Deliberate for now: the remount is how a "yes" reaches those cards without a
   reload (see the Stats Tab section of `CLAUDE.md`).
3. **The migrate link still loads as a page.** `bpm://migrate` and the
   universal link go to `/migrate`, a separate route that claims an identity, so
   a page load is correct there. Rare, and deliberately left.
5. **Keyboard hints across the forms.** Sheets now lift above the keyboard and
   search fields say Search, but `enterKeyHint` is still absent from the
   sign-in and admin forms, and `inputMode` covers ~23% of inputs.
6. **No React.memo anywhere** (165 component files) while `HomeShell` holds ~20
   pieces of state, each re-rendering a 1000-line tab with fresh inline
   closures. Add a bundle analyzer first — nothing measures the client bundle
   today.

## Native rebuild list (Xcode / Android Studio, then a store build)

Ranked. These do NOT ship with a web deploy.

**Read 2026-10-15:** still waiting on a build. The latest store build is 4
(2026-09-17). Of the list, only item 3 (haptics, `@capacitor/haptics` in
`package.json`) and the web half of item 4 (`interactiveWidget` in
`app/layout.tsx`) are in the tree; items 1, 2, 5, 6, 7 and 8 and the native
half of 4 are not yet written, let alone built. The list is current, not stale.

1. **`backgroundColor: '#100F0F'`** in `capacitor.config.ts` (top level + `ios` +
   `android`), and `LaunchScreen.storyboard:18` off `systemBackgroundColor`.
   Today the WebView falls through to `UIColor.systemBackground` — **white** in
   light mode — for the whole network wait between the native splash dying and
   the first HTML arriving. One line, biggest visible win.
2. **`@capacitor/splash-screen` with `launchAutoHide: false`**, hidden from
   `HydrationMark` once the page paints (guarded by `hasNativePlugin`). The
   launch is four visual stages today, two of them blank or wrong-coloured.
3. **`@capacitor/haptics`** — there is no tactile feedback anywhere in the app,
   and no `navigator.vibrate` either. On iOS this is the loudest "this is a
   website" tell after transitions.
4. **`@capacitor/keyboard`** with `resize: 'native'`, plus
   `interactiveWidget: 'resizes-content'` in the viewport export (that half
   ships by web deploy). Nothing in the repo controls or compensates for the
   keyboard today.
5. **`android:enableOnBackInvokedCallback="true"`** — at `targetSdk 36` the app
   is opted out of predictive back, so back is an unanimated jump. And back from
   Home with empty history currently calls `exitApp()` with no confirmation
   (`components/NativeBridge.tsx:177`).
6. **iOS has no back gesture at all.** Navigation is React state, so the fix is a
   JS edge-swipe running the same ladder as the Android back handler, not
   `allowsBackForwardNavigationGestures`.
7. **`@capacitor/network`** — `native/www/error.html` covers only the *initial*
   load; a mid-session drop has nothing behind it.
8. **State at background time.** A WKWebView jetsam kill is not an "excursion"
   (`lib/excursion.ts`), so an evicted user gets a full cold start and lands on
   Home having lost their place.

## Ranked, if you want the next one picked for you

Everything left on the web side is **measurement before change**: add a bundle
analyzer, then decide where memoisation pays. The biggest remaining wins for
feel are now on the **native rebuild list** below — the launch background
colour first.

## Non-goals

- **Images.** 158 racket WebPs average 15 KB, the largest is 15,418 bytes,
  nothing in `public/` exceeds 150 KB. `next/image` is skipped with a written
  reason at each of the six sites. There is no weight problem here. (This line
  used to say they were served `immutable` for a year. They were served
  `max-age=0`, so every launch revalidated every one; #650 gave them a day.)
- **Offline caching.** The push worker has no `fetch` handler and must not gain
  one (`docs/plans/offline-legible-fail.md`).
