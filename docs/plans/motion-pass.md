# Motion pass

**Track:** design-system standardization program (PRODUCT.md → Design Principle #5, "the details are the product"); requested directly by the owner on 2026-09-16
**Status:** in-flight
**Review on:** 2026-10-15 — did the deferred items (sheet height, keyboard lift, conditionally-mounted sheets) get their own PRs, or has this list gone stale?

## Problem

Grant, 2026-09-16: "apply motion to the entire app that is missing motion. Deep audit then design system and add new if needed."

No player has reported it. Four audits (Home/shell, Stats, Admin, Profile + sheets + primitives) read every component against `app/globals.css` and found the same shape everywhere: **state changes that snap.** Errors and late-loaded figures pop in and shove the layout; disclosures open in one frame; chevrons swap glyphs instead of turning; tapping "I'm in" drops all of Home back to a skeleton; a whole family of controls (`.cc-mini-card`, Settings rows, `.link-quiet`, Gear chips) turns the WebKit tap flash off and puts nothing back, so a tap gets no answer at all.

The audits also found the opposite: the most frequent transition in the app (every tab tap replays an 8px rise) moves more than its frequency allows, and `.rail-tab`'s colour transition was silently overridden by a later rule, so the nav label snapped while the pill slid.

## Kill criterion

This failed if, after it ships, a screenshot pass at a phone viewport shows any recipe fighting an existing animation (double entrances, a rise under a height change), or if reduced-motion users lose a state change they could see before. Both are checked by looking, not by tests — jsdom cannot see either.

## Non-goals

- No page-load choreography, no staggered card entrances, no scroll-triggered reveals.
- No FLIP list reordering. A row that moves between sections gets a fade, not a flight.
- No new overshoot. `baddicon-pop` stays the one sanctioned `--ease-spring` site (PRODUCT.md #2), even though an audit flagged it.
- Not animating sheet height, and not the keyboard lift, in this pass (see Deferred).

## Decisions

- **Five recipes, not a motion library.** Appear (`.motion-fade`, opacity only), Open (`.motion-collapse`, grid rows), Turn (`.motion-chevron`), Press (a per-class ladder), Fill (`.motion-fill`). Everything the audits found maps to one of them. A JS motion library was rejected: every finding is a CSS transition away, and the app's thermal budget on mobile already had to be fought for (see the reduced-motion block).
- **Appear has no rise.** `.animate-fadeIn`'s 8px rise stays for page-level entrances, but content arriving inside a surface the user is already reading fades in place. A rise under a height change reads as two things moving.
- **A duration ladder named by role** (`press` 100 / `fast` 150 / `sheet` 180 / `normal` 250 / `slow` 400). `--duration-sheet` had been documented on `/design/tokens` for months without existing.
- **Reduced motion keeps the fade.** The global rule zeroes every *animation*; `.motion-fade` is given back under `!important`, because an error arriving is comprehension, not movement — the same argument the transition allowlist already makes.
- **The tab switch goes opacity-only.** It is the most-seen transition in the app; "frequency decides".
- **Refetch in place, but a failed refetch still says so.** Where a mutation used to flip `loading` and remount the whole tab, the content stays and a failure still surfaces through the card's existing error state — "never let a failure look like a fact" is not traded for smoothness.

## Deferred (own PRs, need a device)

| Item | Why deferred |
|---|---|
| Sheet content height animates on step change (ResizeObserver in `BottomSheetBody`) | ~31 consumers, a `transitionend`-filtered close contract, drag-dismiss and keyboard inset all meet in that element; animates a layout property. Steps crossfade today; the sheet's top edge still jumps. |
| Keyboard lift via `translate` instead of snapping `bottom` | iOS `visualViewport` timing varies by version; only provable on a phone. |
| Roster refetch in place | `RosterPage.load` has no `loadError` — a failed read already renders empty lists — so keeping stale content would compound a lying-empty state. Fix the error state first. |
| Toast exit animation (`AnomalyFeed`) | Needs a leaving state held across an unmount. |
| Gear sub-page pop (`GearRegister` page stack) | Back unmounts the page in one frame and re-enters a previous page from the right; needs the same popped flag `AdminDashboard` now has, plus scroll restore. |
| Sheets mounted conditionally, which snap shut instead of sliding | `GearRegister` (share, look, frame view, line, add), `CheckInSheet` (`if (!open) return null`), `SkillTrendCard`'s anchor sheet, `PaymentsCard`'s `CoverSheet` / `ResetAccessSheet`. Each needs to stay mounted with a nullable subject; the line→add swap also needs the second sheet held until the first has closed. |
| Stats register switch still lands on skeletons | The switch now crossfades, but each register's cards re-fetch on every switch (`sharedRead` reuses a read for 2 seconds), so the fade often lands into skeletons. The fix is per-card last-data-while-refetching, not motion. |
| Racket 3D canvas crossfade | The fallback image unmounts the instant the canvas is ready; fading the canvas in without holding the image would flash blank. |

## Shape

| Piece | File |
|---|---|
| Duration ladder + recipes | `app/globals.css` (Motion tokens; "Motion system: the recipes"; the press ladder beside "Touch feel") |
| Open recipe | `components/primitives/Collapse.tsx` |
| Token docs | `app/design/tokens/page.tsx` |
| Contract | `__tests__/design-canary.test.ts` → "design-system canary: motion" |

## What landed

- **System:** duration ladder, five recipes, `<Collapse>`, `.motion-busy` (a page refreshing in place dims while it loads).
- **Bug:** `.rail-tab`'s colour transition was overridden by a later rule — the nav label snapped while its pill slid.
- **Press:** `.cc-mini-card`, Settings rows, `ActionRow`, `.link-quiet`, Gear chips and actions, `.stat-card`, pills, `.onboarding-door`, `.cc-dcard`, sheet close buttons, stringing flow steps, game-logger names.
- **Appear:** every inline alert; late-arriving cards (balance, skill discovery, stringer bench); sheet outcomes (success/expired/blocked) across the account and stringing sheets; confirms (delete, regenerate, remove); racket avatars once decoded.
- **Crossfade:** tab switch; Stats registers; check-in and game-logger steps; PushSheet states; PIN ↔ email sign-in; Create/Join club steps; pick-sheet alternatives; fit verdict; Profile's loading/signed-out/signed-in branches (keyed, so the fade replays).
- **Open/Turn:** balance card, stringing racket row and pricing, job status flow and proposed change, removed players, announcement composer, All skills, full specs, frame rows, filter chips, Home's PIN fields.
- **Values:** skill bars and median, tension marker and rated span, tension numbers, waitlist position, signed-up count, % paid, sign-ups toggle label; paid pill no longer flickers through "…".
- **In place:** Home, Sign-Ups, Next session, Payments, Birds and Ledger refetch without a skeleton; admin sub-pages enter once and fade back on Back.

## Audit findings not taken

The four audits (Home/shell, Stats, Admin, Profile + sheets + primitives) ranked about 140 findings. Beyond the Deferred table, these were read and deliberately left, so the next pass does not rediscover them as new:

- **`baddicon-pop` on every PIN digit** — an audit flagged its overshoot on the weekly path. PRODUCT.md #2 names it the one sanctioned `--ease-spring` site; changing that is a product decision, not a motion fix.
- **Staggered row entrance on Sign-Ups** — kept, capped at 150ms total and opacity only, rather than removed: it is a real list, and "genuinely new rows animate" is the one case a stagger is earned.
- **Theme toggle crossfade (View Transitions)** — rare, and a whole-page transition is choreography.
- **Name autocomplete and DatePicker popover exits, DatePicker month-grid crossfade** — low frequency (the autocomplete is flag-off only).
- **Game logger: a visible selection beat before the partner step advances** — needs a timer between tap and step change; tests drive the step synchronously.
- **Row-level flashes after admin list moves** (promote, restore, archive, pin, pricing reorder) — FLIP was a non-goal; the refetch-in-place work removed the worst of it (the whole-card blink).
- **`AccessRequestsCard` collapsing its last row before the card goes**, **`KudosReceivedCard` fading in** (its `Frame` is defined inside render, so any class animation would replay on every render; hoist `Frame` first), **`StringTensionCard` / `SummaryGreeting` reserving height while loading**, **Racket avatar sheet chips with no selected style** (a missing state, not missing motion).
- **Copy / share "Copied" swaps in admin receipts and setup** — the invite share got the crossfade; the rest were judged fine as text swaps.
- **Stepper values ticking in the stringing request sheet** — rapid taps would restart the tick on every press.
