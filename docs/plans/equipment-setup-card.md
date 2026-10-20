# Equipment redesign — the Set-up card

**Track:** ROADMAP North Star pillar 4 (recommendations strong enough to suggest) — the club tally and the fit engine are only as good as the equipment members log, and today almost nobody logs any.
**Status:** shipped 2026-09-14 (#419 dark, then the flag turned on); flag retired 2026-10-14, off-branch deleted (Grant's call, not the criterion's)
**Review on:** 2026-11-12 — four weeks on the baseline below: has `racketSavers` in `GET /api/admin/slice0` risen above 10, and has the racket-AND-string count gained a reader?

**Read 2026-10-15** (Grant, in the browser): the flag has been on since 2026-09-14 (#419). The kill criterion cannot be read as written — `GET /api/stats/club/gear` is the cohort-gated tally (`minCohort: 3`) and answered `entries: []`, because no racket or string model is shared by three members yet; it never carried a per-member "has both" count, and nothing else does. The nearest reader is slice0's `racketSavers`: **10 of 36** roster members have a racket saved. That is the baseline from today, racket-only. The flip-week number was never recorded. Two consequences: the criterion is reworded above onto the number that exists, and the retirement of `NEXT_PUBLIC_FLAG_GEAR_SETUP` (removal date 2026-10-12, past) is a decision for Grant rather than a reading — the card stays unless he says otherwise. Decided the same day: retire the flag, keep the card, delete the off branch.

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
- **The Stats-canvas pass (Grant, 2026-10-19, design comments on the Equipment
  boards).** The racket line is labelled "Main racket" and loses its In-play pill;
  "Add a spare racket" left the racket's line sheet for a line on the card under
  the main racket (shown once there is a racket to be a spare to); the empty
  tension slot reads "+ String tension"; the string's club fact reads "N others in
  this group use this string" (the racket keeps "N others play it"). On the line
  sheet: "Change racket", "3D rendering" with a Preview badge, "Delete this
  racket" / "Delete this string" (confirm says Delete), and a typed racket's feel
  questions fold behind "Share more about this racket" — the member knows the
  racket best, so it is theirs to add, not a form. "Where you'd go next" became
  "Racket to try next": the price left the reason line for its own row linking to
  the maker's site (`lib/brandSites.ts`: brand home pages only, since the catalog
  has no per-model address; Li-Ning has no checked address yet, so it shows the
  price without a link), and the "not a verdict, borrow one" note under the card
  is gone. The check-in-only reason reads "This suggestion is based on your skill
  check-in. Answer the fit questions for a sharper pick."
- **The second canvas pass (Grant, 2026-10-19, later the same day).** Registers
  run You · Equipment · Play · Learn. Set-up card: an empty spare is an OFFER,
  not a line — "+ Add a spare racket" sits in the card's footer beside "Your fit",
  both at the same quiet weight; a spare that exists still gets its SPARE line.
  "Racket to try next": the frame is 54×156, the text starts at its tip, the
  price row sits under the description in the text column, and the NAME is the
  door (chevron on it) because the price row links out and a link cannot live
  inside a button. Pick sheet: the preference sentence is the header's subtext
  under WE RECOMMEND; the body opens BRAND → name → "~$276 · typical price"
  (a bold price beside the name outweighed it); "Or consider" rows keep money on
  the right — the `diff.cheaper`/`diff.pricier` fragment leaves the "differs by"
  line and the row shows `±$` against the racket ON SHOW under its price; the
  thumbs lost their outlined 44px tiles (36px wide, 18px glyph, still 44 tall)
  and moved under the action with "Where to buy · {brand} site"
  (`lib/brandSites.ts`, the same table as the card); the "not a verdict, borrow
  one" footnote is gone and only `provenance` remains, when true. String tension
  card: the three level lines rewritten in the app's voice
  (`docs/voice-and-tone.md`) and the card made a flex column — its two
  paragraphs carried an inline `margin: 0` that beat `space-y-3` and sat them on
  the scale labels. Fit page: swing speed is asked as the LENGTH OF YOUR CLEAR
  ("How hard do you hit? Picture a clear from the back of the court." —
  Gentle / Medium / Hard, lands mid-court / reaches the back / goes deep) with a
  side-view court per tile (You · Net · Back, a shuttle where it lands) in place
  of the contact-height arcs and their caption; the stored values are still
  `slow` / `medium` / `fast`, so `pairTension`, `recommendTension` and the fit
  engine read exactly what they did. G5 carries a STANDARD tag floating on the
  tile's top edge (inside the tile it pushed G5's circle out of line) and the
  circles' caption is gone; the overgrip switch says what it means ("I wrap two
  overgrips on it" — the answer is stored, nothing reads it yet); the counter
  reads "n of 5 answered" with five dots.
- **2026-10-20 — the overgrip question left Your fit** (Grant, on the canvas:
  "b", of "make the racket pick read it, or drop it until something does"). It
  was stored and read by no engine, so asking it was a question with no answer
  behind it, and the grip question already asks the size your hand wants. The
  field stays on `PlayerGear` (additive schema; a rollback still reads it) and
  "Clear my fit answers" still blanks a stored one.
- **2026-10-20 — "Mostly you play" is five court tiles** (Grant: "does it have
  to be a pill? … Double, Singles, Mixed (front/back court), and all around").
  Each tile is the court from above with the member as the green dot. Mixed
  splits into `mixed_front` / `mixed_back` (additive `FitPlayStyle` values; the
  route accepts the old `mixed`, the page never writes it and counts it as
  unasked, so a member who answered "Mixed" is asked which side). Every mixed
  answer and All-around map to `both` exactly as `mixed` / `any` did — the
  side of the court is stored and not yet read by the racket engine, which is
  the obvious next use (front court wants head-light, back court head-heavy).
- **2026-10-20 — "Your kudos" page in Play** (Stats canvas board "Play › Your
  kudos (all of them)"). `GET /api/kudos` gained additive `months` and `people`
  (`kudosByMonth`, `distinctGivers` in `lib/kudos.ts`). A bare tag reaches the
  page only as a COUNT in its month — no date and no order inside the month,
  because either would narrow an anonymous tag to the handful of people played
  with that night; the canvas drew a dated row per tag, and this is the one
  place the build departs from it. The badge versions on the canvas were left
  out on purpose (Grant: "leave out the badge").

## Shape

See `components/stats/CLAUDE.md` → "Set-up register". PRs: card and states →
add and line sheets → payoffs (where you'd go next, share, the tally's "yours").
Flipping the flag and deleting the flag-off register are separate, later steps.
