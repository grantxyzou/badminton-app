# Mobile fluidity — iOS and Android

**Track:** Native shell / store launch (the app people install is this app in a WebView).
**Status:** in-flight
**Review on:** 2026-10-15 — did the native-rebuild list below go out with a build, or is it still waiting on one?

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

Each carries a canary, because none of this is visible to a rendering test:
jsdom computes every length as `0px`, and a static import or a re-added
transition passes every existing test.

## Decisions taken

- **`app/page.tsx`'s two awaits stay sequential.** The audit's top perf item was
  parallelizing them. `__tests__/members-only-coverage.test.ts:204` pins that
  order deliberately (a refused visitor must read nothing), and with
  members-only off `requireMember` does no Cosmos read — so there is no round
  trip to save.
- **`.bottom-sheet`'s `88vh` is a fallback**, not the live value (`--sheet-max-h`
  is `88dvh`). No change needed.
- **Button blur stays.** `--btn-primary-bg` is translucent in dark mode, so
  `backdrop-filter` there is visible glass rather than a no-op. Dropping it
  would cut blur layers on screen; it is a design call, not a defect.

## Still open, web side (ships with a normal deploy)

1. **Duplicate reads ACROSS TABS** — the same-screen ones are done (#462).
   A Home → Sign-Ups → Stats → Profile pass still fetches `/api/session` 4×,
   `/api/members/me` 3× and `/api/releases` 2×, and every tab switch unmounts
   the old tab, so nothing is kept. These are seconds apart, so only a real TTL
   cache helps — and that trades a round trip for showing a stale roster after
   somebody signs up. **A decision, not a task**: `lib/sharedRead.ts` is
   deliberately a dedupe with no TTL for exactly that reason.
2. **~96 KB of i18n JSON is serialized into every response** and re-parsed on the
   client (`app/layout.tsx:195`), including on `/legal/*`. Scope the namespaces,
   and cache the per-locale `deepMerge` (`i18n/request.ts:129`) — `force-dynamic`
   means it re-walks the tree on every request.
3. **Deep links replay the cold start.** `components/NativeBridge.tsx:132,140,207`
   use `window.location.assign`, so tapping a push notification tears down the
   document and re-runs the whole launch, splash included, *inside* the app.
4. **Pull-to-refresh needs ~283px of finger travel** (`THRESHOLD` 115 ÷
   `RESISTANCE` 0.45 + a 28px dead zone) against ~60–90px for iOS Mail, and its
   `touchmove` is passive, so the page rubber-bands at 1:1 under an indicator
   moving at 0.45:1.
5. **Nothing lifts a focused input above the keyboard** (no `visualViewport`
   listener anywhere), and a sheet's pinned footer holds the primary action.
   `enterKeyHint` is unused app-wide; `inputMode` covers ~23% of inputs.
6. **Drag-to-dismiss on sheets.** `BottomSheet` has no pointer handlers and
   backdrop-tap is deliberately off, so ✕ is the only touch dismissal. Every
   system sheet since iOS 13 drags.
7. **No React.memo anywhere** (165 component files) while `HomeShell` holds ~20
   pieces of state, each re-rendering a 1000-line tab with fresh inline
   closures. Add a bundle analyzer first — nothing measures the client bundle
   today.

## Native rebuild list (Xcode / Android Studio, then a store build)

Ranked. These do NOT ship with a web deploy.

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

**Drag-to-dismiss (6)** — the most conspicuous non-native thing left, and the
one a person notices every time they close a sheet. Then **the keyboard (5)**,
which today can hide the primary button of the sheet you are typing into. Both
are their own PR; neither needs a native rebuild.

## Non-goals

- **Images.** 158 racket WebPs average 15 KB, the largest is 15,418 bytes,
  nothing in `public/` exceeds 150 KB, and they are served `immutable` for a
  year. `next/image` is skipped with a written reason at each of the six sites.
  There is no weight problem here.
- **Offline caching.** The push worker has no `fetch` handler and must not gain
  one (`docs/plans/offline-legible-fail.md`).
