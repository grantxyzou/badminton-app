# Foldable layout: two panes on an unfolded screen

**Track:** the native shell (`docs/plans/native-shell.md`), an addition after launch; requested directly by the owner on 2026-11-04 after Apple shipped iPhone Duo (2026-10-23).
**Status:** shipped 2026-11-04 (steps 1 and 2 of 4)
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
  language buttons move into the top of the strip.
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

## Shape

| Piece | Where |
|---|---|
| Tokens and reasoning | `app/globals.css`, "Foldables: two panes on a big touch screen" (beside `.bpm-home-stack`) |
| Pane rules, side tab bar | `app/globals.css`, the last two blocks in the file ("Foldables: the two panes", "Foldables, sideways") |
| The week's group, marked for the left pane | `components/HomeTab.tsx` (`bpm-home-week`) |
| Side insets on the corner toggles and tab bar | `app/globals.css` (`.theme-toggle`, `.lang-toggle`, `.rail-bar`) |
| Home loading frame as the left pane | `components/primitives/CardSkeleton.tsx` (`bpm-home-skeleton`) |
| Canary | `__tests__/foldable-layout-canary.test.ts` |

## Next steps (not started)

1. ~~Two panes, centre gap, right-half sheets, side safe areas.~~ Shipped.
2. ~~A side tab bar on wide landscape screens; nothing spans the fold.~~
   Shipped. The Duo's outer screen waits on step 3's native signal.
3. A small native plugin passing iOS's fold region and hinge angle to the page,
   then a courtside scoreboard for the phone propped half-open on the bench.
4. The two-screen scoreboard (outer screen faces the players), native.

Before step 3, open the store app in the Xcode 27.1 iPhone Duo simulator: what
WKWebView reports for the side insets (iOS's own side strip of status bar and
Dynamic Island sits on the right, the same edge as our tab bar), and whether
the segment API reaches it, decide what the native plugin has to supply.
