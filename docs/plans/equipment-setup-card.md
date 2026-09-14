# Equipment redesign — the Set-up card

**Track:** ROADMAP North Star pillar 4 (recommendations strong enough to suggest) — the club tally and the fit engine are only as good as the equipment members log, and today almost nobody logs any.
**Status:** shipped 2026-09-14 (#419 dark, then the flag turned on)
**Review on:** 2026-10-12 — has the flag been turned on, and did the share of members with a racket AND a string logged go up?

## Problem

Nobody has said it out loud; the design pass found it by rebuilding the register
from the code (claude.ai/design "Equipment redesign", Turn 1, artboard 1a):
"Five empty fields, then a rail that repeats the same four nouns, then two more
cards about strings." Two of the four category rows (shoes, shuttles) could never
be filled, tension was a number field floating above the list, and "logging it is
what makes the club tally useful" was an explanation rather than a reason.

## Kill criterion

If, four weeks after the flag is on, the number of members with both a racket and
a string logged has not risen above what `GET /api/stats/club/gear` shows the week
it flips, the card's premise — that two lines to fill and a club fact per line
make logging worth doing — is wrong, and the extra surfaces should not survive the
flag's retirement.

## Non-goals

- Shoes and shuttles. They appear when the catalog has rows, not before.
- Retire (a soft remove that keeps history). Left out by Grant on 2026-09-14.
- "Club rackets" as an answer on the racket line. Left out on the same day.
- Per-model racket imagery. One stand-in render for every row, by design.

## Decisions

- **Turn 2 (`2a`) is the build**, Turn 1's per-component dispositions (retire the
  rail, list gates rendering, tension at add time, spares nest) are how.
- **The suggestion asks before it saves** ("Is this the one you play?"). Grant,
  2026-09-14: a one-tap accept is the easiest way to fill the tally with rackets
  nobody owns — the design's own open question.
- **Tension is captured when a STRING is saved**, not a racket: it is stored on
  string items, and a racket-add stepper would write to a string not yet named.
- **"For this frame" requires the server to have paired against THIS racket**
  (`pairedWith`, source `owned`, same label). Picks are not refetched on every bag
  change, so without it a pairing for the previous racket was quoted under the new
  one. `useGearPicks.refresh` re-asks both picks when the racket in play changes.
- **The level-based tension card stands down only for a number the card SHOWS**
  (`tensionOnScreen`). Keyed on "the pairing has a number" it vanished for a member
  with no racket, whose pairing is against a frame the card never names.
- **The stand-in racket is an SVG drawn from the design project's `Racket.html`
  geometry.** DesignSync's `get_file` caps at 256 KiB and returned `racket-full.png`
  truncated (head only).
- **Shared gear is gear only, by type**: `SetupShare` has no field for a level, a
  game or a kudos, so the sheet's promise is kept by what can be passed to it.

## Shape

See `components/stats/CLAUDE.md` → "Set-up register". PRs: card and states →
add and line sheets → payoffs (where you'd go next, share, the tally's "yours").
Flipping the flag and deleting the flag-off register are separate, later steps.
