# Light mode: Morning glass

**Track:** the visual-fields direction (`docs/plans/visual-fields-direction.md`), its light half; requested directly by the owner on 2026-11-25.
**Status:** in-flight
**Review on:** 2026-12-09 — after two Thursdays, has anyone who uses light mode said it reads worse than before, and has Grant kept it on his own phone?

## Problem

Light mode was dark mode turned inside out. It kept the dark theme's materials, so it was white cards at 90–96% with a hairline ring over a cream page with a faint glow in one corner. On a bright phone the cards and the page were nearly the same colour and the tab's hue barely showed.

Grant asked for a light mode designed on its own terms, with options and contrast that passes ("text ≥ 4.5:1"). Four were drawn on the canvas (Paper, Daylight, Clubhouse, Glass; later Courtside and Buildable). His picks, 2026-11-25:

- First "Web light mode use paper ink option (A)", then, once Paper was in the real app: "paper visual is not paper enough… I hate the grey."
- Then: **"do the Morning Glass in original option"**: option D, without option F's dark heroes.

Nobody outside the owner has reported a problem with light mode; this is the owner's call on how the app should look.

## Kill criterion

Revert to the previous light values (one revert of this PR) if, by the review date, a member reports that light mode is harder to read or to use than it was, or Grant stops using it himself.

## Non-goals

- **Dark mode.** Untouched: every change is under `[data-theme="light"]`.
- **Option F's bold heroes** (dark green Home top, the racket on Stringing). That is a later option built on this one; this ships D as drawn.
- **New components or layout.** Token values only, plus two rules (the light card without its radial smudge, the Stats dot colour).
- **The brand bundle** (`docs/design-system/`, `/design/tokens`' `--bpm-*` swatches), which documents the original brand palette and stays as reference.

## Decisions

- **Blooms, not a corner glow.** Each tab gets three soft radial blooms in its own family of colours (top right, mid left, bottom right) on a cool near-white page (`#F5F7F8`).
- **Frosted white cards.** White at 74%→62% with a 22px blur, a bright top edge and a soft lift, and no drawn ring (fill-only, DESIGN.md §9). The card's old radial highlight is dropped in light mode: it was black at 7% and read as a smudge.
- **Inks take the tab's hue, deeper.** Secondary and muted text is a deep shade of each tab's colour. Measured against the strongest bloom of each tab, both bare and under the most see-through part of a card, the lowest pair is 4.52:1.
- **Deeper accents.** Green `#066331` and amber `#8f4500`: green-700 and amber-700 fell under 4.5:1 over the brighter blooms. For the same reason the light overrides of the red, orange and blue text utilities step one shade deeper.
- **The segment control is frost**, with a near-white pill under the chosen tab.
- **Stats' dots were green in light mode by accident.** The light dot rule tied the fields rule on specificity and lost on order. A rule after it now gives light Stats its blue dots.
- **Paper was tried first and dropped.** Its flat grey cards read as muted in the real app (Grant). An intermediate "card stock" and "riso" pair was mocked and not taken.

## Shape

- `app/globals.css`: light token values, per-tab inks, fields, card material, rail blur, court lines and Stats dots, plus one `html:root[data-theme="light"] .glass-card` rule that drops the card's radial smudge.
- `__tests__/design-canary.test.ts`: the contrast ground is the new page.
- Checked in the browser: every tab, signed in as a member and as an admin, at 390px, with axe's colour-contrast rule.
