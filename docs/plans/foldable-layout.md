# Foldable layout: two panes on an unfolded screen

**Track:** the native shell (`docs/plans/native-shell.md`), an addition after launch; requested directly by the owner on 2026-11-04 after Apple shipped iPhone Duo (2026-10-23).
**Status:** shipped 2026-11-04 (steps 1–3 of 4; step 3's native half ships with the next store build)
**Review on:** 2026-12-16 — has anyone opened BPM on an iPhone Duo or a Galaxy Z Fold and said anything about it, good or bad? Has the store app been looked at in the Xcode 27.1 iPhone Duo simulator yet?

## Problem

Grant, 2026-11-04: "can this app scale for iPhone Duo and Z8 fold?", then
"suggest what can we do to apply foldable unique usecase, motion, and
pattern", then "quickly build it, without changing the layout we have today
when its on one screen".

Before this, an unfolded foldable showed the phone's single 512px column in
the middle of the screen. Half-open like a book, that column sat ON the fold:
the "Sign up for this week" button crossed the crease, the one spot Apple's
guidance says to keep taps out of. Sheets opened across it too, and nothing in
the app read the left or right safe-area inset, where iPhone Duo puts its
camera and system controls.

## Kill criterion

Any change on a single phone-sized screen. That was checked once by hand:
before/after screenshots on the mock store at 430×932 (iPhone), 412×915
(Galaxy Z Fold cover), 382×618 (Duo outer), 669×902 (Duo inner, upright) and
1280×800 (desktop, mouse) differed by zero pixels past anti-aliasing noise.
`__tests__/foldable-layout-canary.test.ts` holds the source half of it.

Then, the same day: "do step 2, the side tab bar also NEVER have a banner
that spans across two screen".

## Non-goals

- A side tab bar on iPhone Duo's OUTER screen (see Decisions, step 2).
- Knowing the fold's exact position from the native shell. Step 3.
- Two panes on any tab other than Home. Their single column is unchanged.
- The two-screen courtside scoreboard. Step 4, native, only if step 3's is used.

## Decisions

- **The gap goes in the exact centre, so the fold never needs detecting.**
  Every foldable folds down the middle. Two equal panes with a gap between them
  put the crease in the gap whether or not the browser can say where the fold
  is — Safari 27.1 cannot without a feature flag, and the store app's WKWebView
  is unverified. It is also Apple's "even number of columns" rule. Where the
  Viewport Segments API does report the fold (Chrome; Safari behind its flag),
  the gap grows to at least the fold's real width plus 24px a side.
- **Who gets two panes: a touch screen at least 720 wide and 480 tall**, or any
  browser reporting two side-by-side segments. 720 is two ~330px columns (the
  design spec's floor is a 320px phone) plus the gap; 480 tall keeps out every
  phone held sideways; `pointer: coarse` keeps desktops on the column they had.
  Duo's outer screen (382, or 594 sideways) and its inner screen held upright
  (669, where the fold runs ACROSS, so a scrolling column is right) stay one
  column. Apple's guidance is to key on size, not on the device, and so is this.
- **Home's two existing groups ARE the two panes.** This week on the left, your
  account on the right — the 2026-08-27 hierarchy pass had already split Home
  that way, so no card moved order. The install/push nudges span both, as a
  header.
- **Only Home widens.** The page column widens only while Home's panel is on
  screen (`:has()`); the kept tabs behind it keep 512px. The tab bar spans the
  panes on every tab, so it does not change width as you switch; with four tabs
  its middle is still the fold.
- **A sheet opens in the right half**, beside what it came from — Apple's Mail
  pattern (list and message side by side) for free, and never across the fold.
  The size stays ONE token (`--sheet-max-w`, redefined inside the query), so the
  sheet-size canary's rule holds.
- **Side safe areas use the LARGER inset on both sides**, so the column's centre
  stays the screen's centre when one edge carries system controls. Portrait
  phones report 0, so this is the same 16px.
- **No JavaScript.** Pure CSS: nothing to hydrate, nothing to mismatch, and
  folding is just a resize the layout follows (Apple: "allow the existing
  layout to expand").

### Step 2 (same day)

- **Nothing crosses the fold, banners included** (Grant: "NEVER"). Step 1 ran
  the install and push nudges across both panes as a header. Now the left pane
  holds the week alone and the right pane holds the nudges, then your account.
  The grid has three rows on the right (two nudges at most, then the account)
  with the last row `1fr`, so the week's extra height lands there and never
  opens a gap between the nudges and the account. The top toast and the toast
  stack, both centred before, open in the right half like a sheet. Only the
  page background and a BOTTOM tab bar run across, and that bar's middle is the
  gap between tabs 2 and 3. The canary fails on any `grid-column: 1 / -1` in
  the pane block.
- **The side tab bar is Apple's "vertical controls"**: on a screen wider than
  it is tall, the tab bar runs down the right edge; upright, it stays at the
  bottom (Duo inner held upright, a Galaxy Z Fold's near-square inner screen in
  its usual grip). Same four tabs, same order top to bottom, the same pill,
  which now glides down instead of across. The tabs sit at the BOTTOM of the
  strip — where the bottom bar's were (Apple: keep controls' relative positions
  across poses) and where a thumb holding the right half rests. The theme and
  language buttons move into the top of the strip — and the Notifications
  bell, which #769 added beside them while this was in review, stacks third.
- **The strip widens the page padding on BOTH sides**, not just the right, so
  the panes' gap stays in the exact centre: the fold-without-detection rule
  from step 1 survives the asymmetry Apple warns about. The left side's extra
  80px is the price. Every other tab's column keeps its 480px of content.
- **Not on iPhone Duo's outer screen.** Apple puts the bars on the side there
  too, but a web page cannot tell that screen (382 × ~600 in Safari) from an
  iPhone SE or any phone in Safari with its toolbars showing, which are about
  as wide for their height. A rule that caught the Duo's outer screen would
  have moved the tab bar on ordinary phones, which the brief rules out. It
  needs a signal from the native shell (step 3).
- **Checked against the branch's true base** (`cdf2445`), not the local `main`,
  which was older: a first diff against it showed 60–90k changed pixels that
  were a different Home (a nudge added since), not this change. Against the
  base, zero, at 430, 412, 382, 669, 932×430 sideways and 1280.

### Step 3 (same day): where the fold is, and the courtside scoreboard

Grant: "do step 3".

- **One owner for "where is the fold?"**: `lib/fold.ts`. Three sources, one
  shape (`FoldInfo`: `posture` folded/flat/null, the fold's rect in CSS px,
  its axis), read in order: the store app's `BpmFold` plugin; the web's
  Device Posture API + Viewport Segments API (Chrome on the Z Fold today,
  Safari 27.1 behind a flag); nothing. **Unknown is not flat**: a source that
  cannot say leaves `posture` null, and `splitForFold` falls back to the
  centre of the viewport, where every fold is — the same bet steps 1 and 2
  make in CSS. `UNKNOWN_FOLD` is the only default.
- **The native plugin reads the OS's own fold, not a hinge angle.** Apple's
  API for the Duo is `UIView.reservedRegions(kind: .division)`: the hinge is a
  DIVISION reserved region on any view it crosses, active only while the
  device is partly open, with a frame in the view's own coordinates — which,
  read off the WebView, are the page's CSS pixels. That is exactly what the
  web posture API says (`folded` / `continuous`) and what Android's
  `FoldingFeature` says (`HALF_OPENED` / `FLAT`, with bounds), so the plugin
  answers in the web API's words and the page cannot tell the sources apart.
  The HIG mentions a hinge-angle API; its name is not in the pages fetched,
  and nothing here needs a number — the division's presence is the answer.
- **iOS has no event for a region changing** that reaches a WebView (UIKit
  re-runs `updateConstraints()` on views that read regions, which a WebView
  never calls for us). So while someone is subscribed — only the scoreboard,
  only while open — the page asks again once a second (`NATIVE_FOLD_POLL_MS`);
  one bridge call, no I/O. Android pushes `foldChanged` from WindowManager's
  listener and the poll is a harmless no-op.
- **`BpmFoldPlugin.swift` needs Xcode 27.1.** The region API exists only in
  the iOS 27 SDK; an older Xcode will not build the target with this file in
  it. That is also the toolchain the Duo needs for the app to use the whole
  display at all (Apple: "Build your app with the latest version of Xcode"),
  so the next store build takes both together. `native/README.md` says so.
  It is written against the SDK's signature as documented and has NOT been
  compiled here — there is no Xcode in this environment. First build on
  Grant's Mac is the test; `#available(iOS 27.0, *)` guards the runtime.
- **Android gains `androidx.window:window` 1.3.0** (plus `window-java`, the
  callback adapter over its Kotlin flow). The plugin converts the feature's
  window-pixel bounds to the WebView's CSS pixels — shifted by where the
  WebView sits in the window, divided by density — so a fold at 1104 px on a
  2.75-density Fold reads as 401 CSS px, the number the page lays out in.
- **The scoreboard is a fixed overlay split at the fold** (`CourtsideScoreboard`,
  opened by "Keep score" on Stats → Play's record card): the board on the half
  that faces the court — two digits sized by the screen (`--court-digit`,
  `clamp(64px, 24vmin, 220px)`, deliberately NOT a `--fs-*` rung: the type
  canary pins every one of those to a pixel, and this is read from across a
  court), the server's dot, one status line in the umpire's words from
  `lib/scoreRules.ts` — and the buttons on the half in the hand: +1 each side
  as a whole half of the panel, Undo, New game, Save game, Close. Laptop
  pose: board above, buttons below. Book pose: board left, buttons right.
  Nothing is drawn on the fold itself (the grid's middle track IS the fold's
  rect). No fold known: the centre, which on a flat phone is simply "score
  above the buttons" — a usable scoreboard everywhere, not a foldable-only
  feature.
- **The game lives on the phone until Save.** Save hands the score to Add a
  game prefilled (`YourRecordCard` opens `SteppedGameLoggerSheet` with it, the
  same path the widget's score takes), where Swap sides exists because the
  board cannot know which side was yours. With no session to log into, Save
  is disabled and the board says why under the buttons, rather than hiding
  the button or the board.
- **A wake lock while the board is up** (`navigator.wakeLock`, feature-
  detected, re-requested when the tab comes back): a phone on a bench goes
  dark in a minute otherwise. Denied or unsupported, the board still works.
- **Checked on screen** (Playwright, mock store, signed in as Lin, Stats →
  Play → Keep score, 11–7): a 430×932 phone with no fold (centre split,
  board above buttons), a 951×620 Duo open like a book with the posture and
  segments APIs injected (board left, buttons right, the 31px fold empty),
  and an 884×1000 Fold propped like a laptop (board above, 24px fold empty).
  The values the component set are in the plan's PR.

## Shape

| Piece | Where |
|---|---|
| Tokens and reasoning | `app/globals.css`, "Foldables: two panes on a big touch screen" (beside `.bpm-home-stack`) |
| Pane rules, side tab bar | `app/globals.css`, the last two blocks in the file ("Foldables: the two panes", "Foldables, sideways") |
| The week's group, marked for the left pane | `components/HomeTab.tsx` (`bpm-home-week`) |
| Side insets on the corner toggles and tab bar | `app/globals.css` (`.theme-toggle`, `.lang-toggle`, `.rail-bar`) |
| Home loading frame as the left pane | `components/primitives/CardSkeleton.tsx` (`bpm-home-skeleton`) |
| Canary | `__tests__/foldable-layout-canary.test.ts` |
| Where the fold is (web owner, three sources) | `lib/fold.ts`, `__tests__/fold.test.ts` |
| The iOS plugin (division reserved region, iOS 27) | `ios/App/App/BpmFoldPlugin.swift`, registered in `MainViewController.swift`, in the target via `project.pbxproj` |
| The Android plugin (WindowManager FoldingFeature) | `android/.../BpmFoldPlugin.java`, registered in `MainActivity.java`, deps in `app/build.gradle` + `variables.gradle` |
| The courtside scoreboard | `components/stats/CourtsideScoreboard.tsx`, opened from `YourRecordCard`; styles `.courtside-*` and `--court-digit` in `globals.css`; strings `stats.courtside` |
| Shell canary (both plugins pinned) | `__tests__/native-shell-projects.test.ts` |

## Next steps (not started)

1. ~~Two panes, centre gap, right-half sheets, side safe areas.~~ Shipped.
2. ~~A side tab bar on wide landscape screens; nothing spans the fold.~~
   Shipped. The Duo's outer screen waits on step 3's native signal.
3. ~~The fold plugin (iOS division region, Android FoldingFeature) and the
   courtside scoreboard.~~ Shipped on the web; the plugins ship with the next
   store build. **Not yet done, and only Grant's Mac can**: build with Xcode
   27.1 (the Swift file will not compile on an older one) and open the app in
   the iPhone Duo simulator — fold it, open Keep score, and check the board
   splits on the hinge; then the same on a Z Fold or its emulator for the
   Android plugin. If `getFold()` answers `unknown` on the Duo, the WebView's
   division region is not reaching the plugin and the fallback (centre) is
   what people get, which is still right on a flat-open phone.
4. The two-screen scoreboard (outer screen faces the players), native (Apple's
   scene accessories), only if step 3's board gets used at a session.

The side tab bar on the Duo's OUTER screen (step 2's non-goal) can now be a
plugin answer too: `BpmFold` could report which display the app is on, and the
page would set `data-display` the way it sets `data-tab`. Not built until the
simulator read above says what the outer screen reports.
