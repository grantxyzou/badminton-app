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

1. **Duplicate reads across tabs.** A Home → Sign-Ups → Stats → Profile pass
   fetches `/api/session` 4×, `/api/members/me` 3×, `/api/stats/club/bands` 2×
   *on one screen*, `/api/games?all=true` 2×, `/api/kudos` 2×, `/api/releases`
   2×. Every tab switch also unmounts the old tab, so nothing is kept. One small
   shared cache (the pattern already exists at `components/stats/useCatalog.ts:14`)
   is the biggest remaining perceived-speed win after first paint.
2. **The Material Symbols stylesheet is the only render-blocking third-party
   request on first paint** (`app/layout.tsx:171`), two hops (googleapis →
   gstatic), and it contradicts the policy written at `:18` — the three body
   fonts are already self-hosted for exactly this reason. The glyph list is
   fixed; subset it once and serve it locally.
3. **~96 KB of i18n JSON is serialized into every response** and re-parsed on the
   client (`app/layout.tsx:195`), including on `/legal/*`. Scope the namespaces,
   and cache the per-locale `deepMerge` (`i18n/request.ts:129`) — `force-dynamic`
   means it re-walks the tree on every request.
4. **Deep links replay the cold start.** `components/NativeBridge.tsx:132,140,207`
   use `window.location.assign`, so tapping a push notification tears down the
   document and re-runs the whole launch, splash included, *inside* the app.
5. **Pull-to-refresh needs ~283px of finger travel** (`THRESHOLD` 115 ÷
   `RESISTANCE` 0.45 + a 28px dead zone) against ~60–90px for iOS Mail, and its
   `touchmove` is passive, so the page rubber-bands at 1:1 under an indicator
   moving at 0.45:1.
6. **Nothing lifts a focused input above the keyboard** (no `visualViewport`
   listener anywhere), and a sheet's pinned footer holds the primary action.
   `enterKeyHint` is unused app-wide; `inputMode` covers ~23% of inputs.
7. **Drag-to-dismiss on sheets.** `BottomSheet` has no pointer handlers and
   backdrop-tap is deliberately off, so ✕ is the only touch dismissal. Every
   system sheet since iOS 13 drags.
8. **No React.memo anywhere** (165 component files) while `HomeShell` holds ~20
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

## Non-goals

- **Images.** 158 racket WebPs average 15 KB, the largest is 15,418 bytes,
  nothing in `public/` exceeds 150 KB, and they are served `immutable` for a
  year. `next/image` is skipped with a written reason at each of the six sites.
  There is no weight problem here.
- **Offline caching.** The push worker has no `fetch` handler and must not gain
  one (`docs/plans/offline-legible-fail.md`).
