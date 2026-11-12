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

### The week moves to the right page (same day, after #782)

Grant: "The width on the left is too narrow? And content on left right now
should be on the right. fact check me" — then "I would want it on the right
cuz thats the elevation opening up more like a page".

- **Fact-checked first, measured on the merged code.** The two panes were
  always EQUAL (356/356 on a Duo open sideways, 402/402 on a Fold's inner
  screen, 470/470 on a tablet); "the left is too narrow" was really "both
  are 356 on the Duo sideways", narrower than the Duo's own closed screen,
  because the side tab bar's 80px is mirrored as padding on the left to keep
  the gap on the hinge. The date tile wraps there. Left as is: reclaiming
  the mirrored space would widen only whichever pane is away from the tab
  bar, which is now the secondary one, and an off-centre gap would leave the
  fold.
- **Primary on the right, by Grant's reading of a foldable as a book**: the
  right page is the one that opens. Apple's Mail example puts the primary
  list on the LEFT; that is a convention, not a rule, and a club organiser's
  reading of his own phone wins. So the week takes the right pane and the
  nudges and your account the left; the loading frame draws on the right.
- **Sheets and toasts move to the LEFT half** as a consequence: they are
  raised from the week, and opening in the right half would have covered it.
  The secondary page is where a sheet belongs — the message beside the list,
  with the pages swapped. The sheet starts at the shell's own side padding
  and its half-width cap already ends it at the gap.

### Design-system pass and motion (same day, after merge)

Grant: "can you review with design system and also appli motion to it".

- **Two misses against the system, both fixed.** The +1 targets carried a
  `--glass-border` rim — the fill-only rule (Grant, the same morning: "no
  outer stroke") — now `transparent`, size kept. And the board sat on bare
  `--page-bg`: it lives on Stats, so it wears the Stats field the way a sheet
  wears its tab's (design rule 1), opaque on `--field-base`. Everything else
  already read from tokens: the duration ladder, `--radius-xl`, the spacing
  rungs, `cc-btn` for the actions, `.material-icons`-free.
- **Motion follows the system's recipes, not new ones.** Apple's rule for the
  fold is "favor small adjustments over rearrangement"; where a rearrangement
  is unavoidable, it is a crossfade — the same one a tab switch gets.
  - **The fold/unfold reflow crossfades** (`lib/paneMode.ts`): one owner
    watches the CSS pane query and alternates `data-pane-flip` `a`/`b` on
    `<html>`; two identical keyframes under two names are what makes a CSS
    animation replay. Opacity only, `--duration-normal`, kept under reduced
    motion like `.motion-fade`. Nothing on mount — the launch screen owns the
    first paint.
  - **The scoreboard's split follows the hinge**: a transition on the grid
    tracks (three px values either side, so the grid interpolates), so the
    board and buttons slide with the fold as the phone opens instead of
    jumping. Off under reduced motion.
  - **Opening is the Appear recipe** (`.motion-fade` on the overlay); no exit,
    like `Collapse`. **Each new digit and each new status line fades in**,
    keyed on its value. **The game ending is the board's one consequential
    moment** and takes `.status-celebrate` (the check-in-saved, session-
    created entrance); the interval stays a colour change, because it comes
    every game.
  - **A light haptic on every +1** in the store app (`tapSuccess`,
    `primeHaptics` on open): on a bench the eyes are on the court. Silent on
    the web by that helper's own rule.
- Checked in Chromium at 430→884→430: `data-pane-flip` null → `a` (with
  `paneFlipA` running) → `b`; the board reports `motion-fade`, a transition
  on `grid-template-rows, grid-template-columns`, the Stats field, a
  transparent +1 rim, and `status-celebrate` → `signupBannerIn` at 21–0.

### Stats gets the two pages (2026-11-12)

The propose mode of the `foldable-review` skill found Stats still sitting ON
the fold: its 480 px column stayed centred on every foldable, so the title, the
three tiles, the switch and every card crossed the hinge. Four candidates were
drawn (overview left and register right; the same with the tiles stacked; the
cards two-up; cards about you right and about the club left), first as
injected CSS at the real sizes, then on a Claude Design canvas. Grant moved the
switch to the head of the right page on the canvas ("this is the tabs
location") and chose candidate 1: "go with 1".

- **Left page: the overview** — title, subhead, the Level / Games / Kudos
  tiles. **Right page: the switch, then the register** — the switch on the
  page it changes, on the subhead's row (which clears the three round buttons
  over the right pane's top on a portrait screen), the register from the
  tiles' row down. Home's shape, inside the same media block: `.stats-shell`,
  `.stats-shell-switch`, `.stats-shell-register`, carried by both
  `StatsV2Shell` and its loading frame (`StatsFallback`) so the chunk arriving
  moves nothing. A page a register opens (Your fit, a racket) hides the
  overview and stays on the right.
- **The greeting moved to the left page, under the tiles** (Grant, the same
  day after #885 merged: "move the greeting to the left", as on his canvas).
  Placing one card of a register in the other column with CSS would tie the
  two columns' rows together, so it is a component change: the greeting left
  the You register and became the shell's `youLead`, a shell child carrying
  `.stats-shell-lead` (a `className` on its `RevealSlot`), rendered between
  the switch and the register only on You and only with no page open. On one
  screen that is exactly where the register's first card stood (Tailwind 3's
  `space-y` skips a `hidden` child, so an empty greeting leaves no gap); on two
  pages `.stats-shell > *` puts it in column 1, row 4. The loading frame draws
  its skeleton in the same place. Phone, Duo closed, Duo upright, desktop: 0
  pixels changed against the base.
- **The header's sticky bar is half-width** on two pages, as every card is.
- **Measured** (mock store, Lin, Chromium): Duo sideways 356 / 356, Z Fold
  open 402 / 402, tablet 470 / 470; nothing crosses the centre at any of them.
  Phone, Duo closed, Duo upright and desktop: 0 pixels changed against the
  base (the phone's first diff of 48 px was the trend line's anti-aliasing,
  identical between two runs of the same code).

### Stringing: the list stays left, what you tap opens on the right (2026-11-12)

The propose mode drew three candidates for Stringing, whose 480 px column sat
on the fold on every register: Stats' shape (everything on the right page),
list-and-detail, and two registers at once. Grant: "Option 2 but can we have
something opened by default on the right?" — Apple's list-detail, with the
detail never empty.

- **Left page: the title, the switch and the register** (the bench, the shelf,
  the request card) — the phone's column, unchanged in order. **Right page:
  what a tap opens**, in place of the page or sheet it opens on a phone: a
  job's page (no back bar — the bench is beside it), a string's page (the
  sheet's content as a card, its "Restring with this string" at its foot).
  The right page starts on the switch's row, which clears the three round
  buttons on a portrait screen.
- **Open by default**: the bench opens the job at the top of its list (the
  list's own order: what needs you next), marked with a solid green tint and
  `aria-current`; the shelf opens the string its map already picks; Submit
  request opens the player's rackets in progress, or — with none in — the
  strings on offer, whose "Restring with this string" opens the request with
  that string picked. A stringer who is not an admin gets their queue left and
  their shelf (names and reel colours) right.
- **How it is built**: what renders where is a component change, so the tab
  renders an empty right page (`.stringing-aside`) only in two-page mode —
  `usePaneMode()` in `lib/paneMode.ts`, the same `PANE_QUERY` string, never the
  window's width — and hands it down through `StringingAsideProvider`; a
  register portals into it with `<StringingAside>`
  (`components/stringing/StringingAside.tsx`). On one screen there is no slot,
  every caller takes its phone path, and nothing renders differently. The CSS
  widens the tab and draws two pages only while the right page shows
  something (`.stringing-aside > * > :not([hidden])`), so an empty bench and
  the bench's own sub-pages (new job, the archive, set-up — and an archived
  job, which opens as its page) keep today's one column. Nesting `:has()` is
  invalid CSS and the first cut did it: the two pages came out 216 px wide.
- **The right page is outside the loading cascade** (`RevealOutside` in
  `Reveal.tsx`): context follows a portal, so a shelf card on the right would
  otherwise have answered for the request card's slot on the left. It holds
  its own place with a skeleton while it loads.
- **Measured** (mock store, Grant and Lin, Chromium): Z Fold open 402 / 402,
  Duo sideways 356 / 355 with the side tab bar; nothing crosses the centre on
  any register. Phone: 0 pixels changed on the shelf, the request card (with
  and without a racket in) and a job's page; the bench's 16 px were the
  switch's sliding pill caught mid-slide, which two shots of the same code
  also differ by.

### Every tab on two pages, and motion for them (2026-11-12, `/goal`)

Grant: "finish the app with apple guideline. using our design system. then add
motion for the fold views." An audit at the Z Fold and Duo sizes found Profile,
the Admin console it opens, and the bench's own pages (Add job, the archive,
set-up, an archived job) still one column across the fold. Each now follows
Apple's list-detail, the shape Stringing took the same day:

- **Profile**: the title and the list on the left; the screen a row opens on the
  right — Edit profile before any tap, as a phone's Settings opens on your
  account. The card or row whose page is open wears the accent's tint
  (`aria-current="page"`). A row that opens a SHEET still opens it in the left
  half. `ProfileTab`'s sub-screens became one function of the view
  (`subScreen`), so one screen keeps its early returns and two pages render the
  same screen in `.profile-detail`. Signed in only.
- **Admin**: the console on the left, the page a row opens on the right — Roster
  before any tap. On two pages a console row REPLACES the right page; a page
  opening another (How your club runs → Late cancellations) still stacks, and
  keeps its Back.
- **The bench's own pages** (Add job, Archived, set-up, an archived job, and the
  player's "A change to confirm") open on the right page beside the list
  instead of taking the tab over. Tapping a job closes whatever was open.
- **A right page has no Back** (`PaneDetail` in
  `components/primitives/PaneDetail.tsx`; `TopBar` reads it): the list it came
  from is beside it, so a Back, an edge swipe or Escape closing it would close
  the page for no reason. A page opened from the right page is `nested` and
  keeps its Back.
- **A right page comes into view when it changes** (`usePaneDetailReveal`): the
  body is the one scroller, so a row tapped far down a long list opened a page
  whose top was already above the screen (measured: the job page sat at
  y = −403 after "Add job"). It scrolls up only when the page is out of sight,
  smoothly unless reduced motion.
- **Motion** (`.pane-page-open`, a sixth recipe beside the five in the motion
  pass): a page on the right arrives FROM THE FOLD, the book's spine — a
  `--space-5` glide under a fade at `--duration-normal`, the reflow's own
  duration; reduced motion keeps the fade only. Going Back in Admin fades, as
  on one screen. An open row's tint transitions in (`--duration-fast`). The
  fold/unfold crossfade (`data-pane-flip`) is unchanged. Sampled in Chromium:
  −6 px / 0.62 at 40 ms, −1 px / 0.93 at 120 ms, none / 1 at 400 ms; reduced:
  no transform at any sample.
- **Signed out, a book's spread** (same evening, after the rest of the audit:
  Welcome's lockup and its two doors sat across the fold): the launch lockup
  on the LEFT page — the cover — and Sign up / Log in on the RIGHT, opposite
  it, where the hand holding the right half reaches. The splash's lockup sits
  on the same left page, so a cold start still hands over to Welcome with
  nothing moving. Log in, Sign up and the ask keep the lockup on the left as a
  cover (`.signed-out-cover`, rendered only on two pages) and put their form on
  the right. The lockup's fit for one page is `--launch-kh`, a second value
  from the same pre-paint script (`app/layout.tsx`), because a unitless scale
  from viewport units needs typed `calc()` division, which Safari lacks.
- **Notifications** (the bell's page): its title and this phone's settings on
  the left page, Recent on the right; with no setting to show it keeps one
  column.
- **Keep your account** (the page Home's "Choose how to sign in" banner opens
  for a member an admin let in): on one screen it still stands in for Home; on
  two pages it opens in the week's place on the RIGHT page, beside the banner
  that opened it, with no Back ("Not now" closes it). It was the last screen
  the audit had not reached (it needs an account with no way back in); forced
  in the browser by answering `/api/auth/methods` with none, it ran 16–868
  across the fold before this.
- **Checked and left alone**: Home, Stats' four registers and the pages they
  open (on the right since #885), and every sheet (the left half since step 1).
- **Measured**: Profile, Admin and every bench page at Z Fold open 402 / 402 and
  Duo sideways 356 / 355; nothing crosses the centre. Welcome: lockup 20–422,
  doors 474–876 on the Z Fold; 87–389 and 574–876 on the Duo. Phone: 0 pixels
  changed on Profile, a Profile page, the Admin console, Welcome (upright and
  sideways), Log in, Notifications and Keep your account against main; a bench page differs by 17
  anti-aliased edge pixels of the tab bar's pill.

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
| Every right page (no Back beside a list, scroll into view) | `components/primitives/PaneDetail.tsx`, read by `components/primitives/TopBar.tsx` |
| Profile and Admin two pages | `ProfileTab.tsx` (`subScreen`, `.profile-shell`), `admin/AdminDashboard.tsx` (`pageFor`, `.admin-shell`), `__tests__/components/ProfileTab.twoPages.test.tsx` |
| Signed out as a spread | `.signed-out-cover`, `.launch-canvas` / `.launch-actions` in the pane block, `--launch-kh` in `app/layout.tsx`, `components/onboarding/SignedOutShell.tsx` |
| Notifications two pages | `components/NotificationsPage.tsx` (`.notices-shell`) |
| Right page motion | `.pane-page-open` / `panePageOpen` in `globals.css` |
| Stringing's right page | `components/stringing/StringingAside.tsx` (slot, provider, portal), `usePaneMode` in `lib/paneMode.ts`, `.stringing-shell` / `.stringing-aside` in the pane block, `__tests__/components/stringing-two-pages.test.tsx` |
| The fold/unfold crossfade | `lib/paneMode.ts`, `components/PaneFlip.tsx` (mounted in `HomeShell`), `paneFlipA/B` in `globals.css`, `__tests__/pane-mode.test.tsx` |

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
