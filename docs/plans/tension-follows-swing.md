# Tension follows swing speed

**Track:** ROADMAP North Star pillar 4 — "recommendations strong enough to suggest equipment purchases"; the racket-fit engine's track (`docs/plans/racket-fit-engine.md`), which this extends to the string tension it names.
**Status:** shipped 2026-10-09
**Review on:** 2026-11-09 — has Grant, as the club's stringer, confirmed the three draft sample players (`g01`–`g03` in `__tests__/fixtures/fit-golden.json`, `pending: true`) and the swing-based tension numbers they produce? If he rejects the numbers, revert `pairTension` / `recommendTension` to level-and-consistency placement and keep the swing out of tension.

## Problem

Grant, 2026-10-09, uploading a 19-slide deck titled "Badminton Performance Science":
*"Can you use this document to improve our recommendation?"* Asked which of four
changes to make, he answered *"Evaluate all the options."*

The deck's one claim that is both well-supported and not yet in the app is the
"power paradox" (slide 11): at a low-to-medium swing speed a LOWER tension
generates more shuttle power — the bed does the work — and a high tension feels
dead and only overtakes at an elite swing speed into a small sweet spot. The app
already relies on the same physics (a sore arm lowers tension; the fit engine
caps shaft stiffness by swing), yet the tension number ignored the one answer
that speaks to it: the fit page asks every member their swing speed
(`PlayerGear.fitSwing`) and nothing on the tension path read it. A level-3.5
player with a relaxed swing was told 25 lb and got less power for it.

## Kill criterion

By 2026-11-09, Grant has confirmed or corrected the three draft sample players
and says the swing-based numbers are what he would string for them. If he says
they are wrong in direction (not merely by a pound), revert the placement to
level-and-consistency only and leave the swing answer where it was — on the
shaft.

## Non-goals

- Changing which STRING is picked by the swing (gauge, type). The deck
  contradicts itself here — it prescribes a thick 0.70 mm string to the
  developing player for durability while a slow swing wants repulsion — and the
  pairing already weighs gauge through its power index. Revisit once the
  sample players can show which way is right.
- Swing-weight / moment-of-inertia scoring. The catalog has no swing-weight or
  balance-point data; the deck's MOI figures have nothing to land on.
- Anything from the deck's frame-resonance ("56–60 Hz"), knot or stringing-
  pattern slides. Unverifiable, or a stringer's craft rather than a
  recommendation.
- Bumping `FIT_ENGINE_VERSION`. The racket engine's arithmetic is untouched;
  a bump would tell the golden set its ratings are stale when they are not.
  (Held for this change; the same day's follow-up, `fit-3`, DID change the
  racket arithmetic and bumped it — see the Decisions below.)

## Decisions

- **The source is AI-generated and was used only where it agrees with the
  research the app already cites.** Every slide carries a "Gemini Notebook"
  mark. Its tension claim matches the elbow-load literature the fit engine's
  comfort delta rests on and the trampoline model of string beds; its tension
  bands (18–23 / 26–34) are in line with what string makers publish. Its
  resonance, MOI-per-m/s and knot claims could not be checked and were not
  used. The three player types on its last slide became DRAFT sample players
  for the stringer to confirm — never ground truth on their own.
- **The swing picks the band; the level places the number inside it.**
  `SWING_TENSION_BAND` in `lib/tension.ts`: slow 20–23, medium 23–26, fast
  25–28, overlapping by a pound because "medium" and "fast" are a member's own
  reading, not a measurement. Level 2.0 sits at the band's floor and 4.5 at
  its ceiling, so a medium swing at the fixture levels lands exactly where the
  old `round(21 + level)` did — the change is for slow and fast swings, not a
  re-tuning of everyone. Beat "add a flat ±2 lb per swing", which would have
  moved a 4.5-level fast swinger to 28 at a level the old rule capped lower.
- **Below level 2.5 nothing takes the number past 24** (`NOVICE_CAP_LB`): a
  fast but new swing is still finding the sweet spot a tight bed shrinks.
- **Singles adds one pound inside the band, never past it** (the old rule
  added two, with no band to stay inside).
- **Unanswered swing = exactly the old number.** Both `pairTension` and
  `recommendTension` take the swing as an optional last argument and are
  byte-for-byte the previous rule without it; the tests pin that. Nobody who
  has not answered sees a change.
- **One answer, every surface.** The recommend route, the fit verdict and the
  fallback tension card all read `PlayerGear.fitSwing` from the same gear doc,
  and the verdict hands the SAME swing to `pairTension` and `recommendTension`
  — the 2026-08-21 lesson, that the string must be scored and named at one
  tension, extended to the swing.
- **The page explains a change only when one happened.** `FitFacts.swingMovedRange`
  (`'lower' | 'higher' | null`) mirrors `sorenessMovedRange`: a line under the
  swing question says why the range came back lower or higher, and the Claude
  prompt (`FIT_COPY_VERSION` 3) gets the same fact as a note it may phrase.
  Medium at the old number says nothing. The string card's reason list gets
  one line, last, never the headline — the headline stays about the string.
- **The draft sample players are `pending`, reported and never asserted.** The
  golden harness prints the engine's current top three beside each draft's
  acceptable set and whether they agree; only a case a person has confirmed
  counts toward the fit plan's five. The developing player is where the engine
  and the deck disagree today (the engine's `more_power` delta leans
  head-heavy; the deck says even balance for a slow swing) — that is the first
  question for the stringer, not something to settle in code.
- **Settled the same day: the stringer agreed with the deck, and the engine
  changed** (`fit-3`, recorded in `docs/plans/racket-fit-engine.md`). Grant
  asked what the buying guides say about power for a beginner; they all say
  even balance and a flexible-to-medium shaft, and he rated g01 that way. A
  slow swing's `more_power` no longer steps the balance toward head-heavy.
  g01 is rated; g02 and g03 are still drafts for him to confirm.

## Shape

| Piece | Where |
|---|---|
| Bands, novice cap, `swingTensionTarget`, `recommendTension(level, format, swing?)` | `lib/tension.ts` |
| `pairTension(…, swing?)`, `pairString(…, swing?)` and its one reason line | `lib/stringPair.ts` |
| The route hands the swing to the pairing | `app/api/recommend/route.ts` (string branch) |
| `FitFacts.swingMovedRange`, same swing to both tension paths | `lib/fitVerdict.ts` |
| Prompt note, `FIT_COPY_VERSION = 3` | `lib/fitVerdictCopy.ts` |
| The line under the swing question; the fallback card's reason | `components/stats/FitProfilePage.tsx`, `components/stats/StringTensionCard.tsx` |
| Copy | `messages/{en,zh-CN}.json` → `stats.gear.fitPage.swingConsequence*`, `…tension{Slow,Medium,Fast}Swing` |
| Draft sample players | `__tests__/fixtures/fit-golden.json` (`pending: true`), reported by `__tests__/fit-golden.test.ts` |
| Tests | `__tests__/gear-stage6.test.ts`, `string-pair.test.ts`, `fit-verdict.test.ts`, `recommend-string.test.ts` |
