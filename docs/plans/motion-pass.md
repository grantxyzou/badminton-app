# Motion pass

**Track:** design-system standardization program (PRODUCT.md → Design Principle #5, "the details are the product"); requested directly by the owner on 2026-09-16
**Status:** in-flight
**Review on:** 2026-10-15 — did the deferred items (sheet height, keyboard lift, admin refetch-in-place) get their own PRs, or has this list gone stale?

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
| Sheet content height animates on step change (ResizeObserver in `BottomSheetBody`) | ~31 consumers, a `transitionend`-filtered close contract, drag-dismiss and keyboard inset all meet in that element; animates a layout property. |
| Keyboard lift via `translate` instead of snapping `bottom` | iOS `visualViewport` timing varies by version; only provable on a phone. |
| Admin Command Center refetch-in-place (finalize, cover, Roster/Birds save, Ledger focus refetch) | Each is a data-flow change across `CommandCenter`'s `composedRefresh` fan-out; needs its own error-state review. |
| Toast exit animation (`AnomalyFeed`) | Needs a leaving state held across an unmount. |
| Sub-page pop direction (`slideInLeft` on back) | Needs a direction ref in `AdminDashboard` and `GearRegister`'s page stack. |
| Sheets mounted conditionally (`{x && <Sheet open/>}`) snapping shut | Per-call-site refactors to keep them mounted; list in the audit table below. |

## Shape

| Piece | File |
|---|---|
| Duration ladder + recipes | `app/globals.css` (Motion tokens; "Motion system: the recipes") |
| Token docs | `app/design/tokens/page.tsx` |
| Contract | `__tests__/design-canary.test.ts` |
