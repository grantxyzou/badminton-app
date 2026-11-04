# Racket fit engine

**Track:** ROADMAP North Star pillar 4 — "recommendations strong enough to suggest
equipment purchases"; Value-Hub Track 2 (Equipment). ROADMAP §4 still says tracks
1–4 stay blocked until the Slice-0 readout; the `VALUE_HUB_SLICE` note in
`lib/flags.ts` records that the fan-out was made by shipping, not by reading the
gate. This file says so rather than pretending the readout happened.
**Status:** in-flight — Phase 0 shipped 2026-09-08 (#335); Phase 1 shipped 2026-09-09 (#337, #344); Phase 2 (the engine, behind `NEXT_PUBLIC_FLAG_RACKET_FIT`, retired ON 2026-10-24) shipped 2026-09-09 (#345); Phase 3 (alternatives, feedback beacons, admin reads) shipped 2026-09-09 (#346, #350); engine re-weighted on the published evidence as `fit-2` 2026-09-10; `fit-3` 2026-10-09 (a slow swing's "more power" leaves the head alone, from the first stringer-rated case); Phase 4 waits on ≥5 golden ratings (3 rated 2026-10-09: g01–g03; the owner owes two of his own); `fit-4` 2026-10-20 (the side of a mixed court); **validation rethought 2026-11-04** — three legs that need no expert's evening (below, "How to validate alternatively"); `fit-5` 2026-11-04 (a Balance question for the member nothing anchors, and no tier steer without an anchor — Grant's two calls from the first backtest read, same day)
**Review on:** 2026-11-18 — re-run the backtest on `fit-5` (`GET /api/reports/fit-backtest`, the `BPM_REPORTS_KEY` variable): the nine cases carry no `fitBalance` yet, so balance can only move once someone answers the new question, but the tier count should move at once — did it? Has anyone with no racket logged answered Balance? And does the kill criterion move from "5 golden + 2 engaged" to "property suite green + backtest + bench agreement"?
**Read 2026-11-04 (first production backtest, `fit-4`):** 12 gear docs, 9 cases (2 rackets not in the catalog, 1 nothing to go on; 6 unanchored, 3 level-only). The club holds 5 even / 2 head-light / 2 head-heavy, 7 stiff / 2 flexible, 7 premium / 2 mid. As answered: flex within a step **9/9**, weight within 3 g **9/9**, balance **3/9**, tier **4/9**, all three **2/9 (22 %)**, exact model in the top three 0/9. The two misses are the two axes the from-scratch path has no input for: with no anchor, balance comes only from the goal or a mixed court side and defaults to even, so the four head-light and head-heavy owners are invisible to it; and the level-derived tier default aims entry/mid at a club that buys premium whatever its level. This is a statement about NEW members with no racket logged — the nine themselves get the anchored path, which follows their racket's balance by construction — and that is exactly who the questionnaire exists for. n = 9 and only 3 `happy` rows, so a direction, not a verdict. The summary should split the match counts by goal next (it reports `byGoal` but not matches per goal).
**Read 2026-10-19:** `engagedMembers` 2 (two adds, on `fit-2`; 184 served to 9 members across `fit-1`–`fit-3`), the fit page opened by 8 members and a verdict seen by 7 — but 3 of 5 golden cases. Half met; the half that is not is the owner's and stringer's to rate, not the members' verdict, so the date moved two weeks rather than the questionnaire going (Grant chose to keep it). `GEAR_PAGES` and `FIT_VERDICT` retired ON the same day.

## Problem

In the owner's words, 2026-09-07: *"I want to understand how the recommendation is
working today and what we can improve on. The goal is to create an algorithm and
really accurate badminton gear recommendations."*

The audit that followed found that the racket engine cannot be accurate in the way
that sentence means, and that nothing could tell us if it were:

- It infers gear fit from **fourteen self-rated skills**, which is a weak proxy for
  the thing a fitting actually asks — what you play now and what you want changed.
  The member's current racket is used only to exclude one row.
- **Unrated skills are silently filled with 3.** A two-skill check-in runs the
  engine on twelve invented values and emits a confident pick.
- **Nothing measures whether a pick was right.** The only beacon is a card tap
  (`rec_card_tap`). Add-to-kit, "tried it" and any rating are unrecorded, so
  "accurate" has no ground truth in the data.
- Structural defects in the scorers: balance is read by two of the seven scorers
  (31% of the weight on one attribute); the All-round category compares a
  7-skill mean against 2-skill means and structurally cannot win; only the
  ACTIVE racket is excluded, so another owned racket can be picked; no
  deterministic tie-break; a missing frame weight defaults to 85 g; every
  reason is a hardcoded English sentence, so a Chinese-locale member reads a
  translated shell around English copy.

Earlier signal, from the same surface: the `VALUE_HUB_SLICE` flag note reads the
Slice-0 numbers as "fails on REACH, not value" — 4 of 12 members ever tapped the
card, 3 of those 4 came back. And a member's report *"the racket database isn't
showing some rackets"* is why the picker opens on All brands today.

## Kill criterion

Read on the date above, via `GET /api/admin/slice0`'s `picks` block and
`__tests__/fixtures/fit-golden.json`:

- Fewer than **5** expert-rated golden cases (owner + club stringer), OR
- fewer than **2** members who saw a pick recorded any of `pick_added`,
  `pick_tried`, `pick_rated` (`picks.engagedMembers`; `pick_served` is written
  on every request that returns a pick and is the denominator, never the
  numerator)

→ remove the fit questionnaire (`GearFitSheet`, the `fit*` fields stay as
harmless optional data) and revert the engine to anchor-only: current racket +
level. Keep the defect fixes — tie-break, all-owned exclusion, i18n reason keys —
because they are correct regardless of uptake.

## Non-goals

- An LLM anywhere in the recommendation path. Decision B2 in
  `docs/plans/value-hub-slice-0.md` stands; the engine stays pure and
  deterministic. If that ever changes it goes through `lib/aiModels.ts` and
  `lib/aiPersona.ts` like every other caller.
- Rewriting the string engine (`lib/stringPair.ts`) or `pairTension`. Its
  shortcomings are data (13 consensus-rated strings, 11 frames with no published
  tension ceiling), not logic.
- Shoes and shuttles. The catalog has no rows; a sourcing problem.
- A ranked catalog browse. `GearSheet` already browses.
- Any attendance-fed input. Stage 8 removed attendance from Stats on purpose.
- Changing `lib/tension.ts`.
- Group scoping. Equipment belongs to the person, so `playerGear` stays
  `/memberId`; the club tally becomes per-group in the multi-group sweep, which
  is that plan's job.

<!-- Everything above is the gate for starting. Everything below is appended as
     the work proceeds. -->

## Decisions

- **Ground truth is staged, not picked.** Domain fitting rules drive the rewrite;
  an expert golden set (owner + club stringer rating picks for real, anonymised
  members) becomes a test the engine must keep passing; a player feedback loop is
  instrumented from day one so it accumulates while the first two ship. Beat
  "feedback loop only" (with ~12 members it would take months to steer anything)
  and "expert only" (never learns).
- **Four new inputs, all asked, none inferred**: current racket + what to change;
  arm-or-shoulder comfort; swing speed; grip size + string budget. Comfort is
  health-adjacent, so it is optional, deletable, stripped from the public gear
  GET, disclosed in the privacy policy and purged with the account.
- **A new fit model replaces the seven scorers** rather than extending them. The
  1.4 / 1.3 / 1.2 weights were never validated and the balance double-count was
  load-bearing; extending would have kept both. Skills are demoted to a tier
  signal and a fallback flex ceiling. The Python reference
  (`docs/superpowers/reference/recommend_racket.py`) stops being source of truth.
- **Top pick + two alternatives** with a one-line "differs by", not a single pick
  and not a list of five. A shortlist is what the golden set can rate, and what a
  member can borrow at the club.
- **Vocabulary aligns with Yonex**: "Equipment", not "Kit" or "Gear", across
  Stats, the stringing sheet and Profile. Keys and identifiers unchanged.
- **Fit questions live in their own sheet**, not in `GearPickSheet`'s
  set-once-a-year preference block. Five more controls would turn the explanation
  sheet into a form, and the comfort question needs its own disclosure sentence
  and a Clear affordance.
- **A pick needs a catalog racket in the bag, OR a check-in, OR goal + swing.**
  Goal alone is not enough: swing sets flex, the injury axis. With none of the
  three the card parks as `needsFit` and opens the sheet — tappable, unlike
  today's `needsCheckIn` dead end.
- **The weights follow the evidence, not the forum** (2026-09-10, after the
  owner's first golden rating). Peer-reviewed work says: racket deflection adds
  head speed only inside the ~60–100 ms of stroke acceleration, so shaft flex is
  a property of swing timing, not skill level (Kwan 2010, Phomsoupha 2024);
  swing speed tracks swing-WEIGHT and ignores mass at fixed swing-weight (Cross
  2006), and experienced players hit the shuttle as fast with heavier-swinging
  rackets (Towler 2023); lower string tension and lighter rackets reduce elbow
  and shoulder load (tennis literature), and no badminton study links shaft
  flex to arm pain. So `fit-2`: the level-derived flex ceiling is gone and an
  unanswered swing widens tolerance and asks; grams are a tie-break next to
  balance; comfort caps swing-weight and lowers tension, never flex. **The
  comfort question stays** — the owner's rule was "if there is no arm-pain
  evidence, take it out", and there is, for tension and weight. **Tier is
  price**: a Beginner may still buy Premium (owner), so it is a soft penalty
  doubled for reaching up, never a cap.
- **Alternative 1 is the runner-up** (2026-09-10, from the owner's eight
  ratings). fit-1 required BOTH alternatives to differ from the top on
  (balance, flex, tier); that skipped the owner's own second choice (g06,
  ArcSaber 7 Pro at rank 2, same triple as the top) for a Medium-flex row he
  did not want, and the review of #355 showed the same rule promoting
  same-spec pricier rows for Intermediates. Diversity is now worth one slot.
  Still open after that: slot 2 can still be reached on tier alone; revisit
  against the golden set once the stringer has rated.
- **Sequenced ahead of multi-group** (owner, 2026-09-07). Phases 0–3 are what
  unblock that plan's call-site sweep; Phase 4 lands after it.
- **The tension number now reads the swing answer** (2026-10-09,
  `docs/plans/tension-follows-swing.md`). This supersedes two non-goals above
  ("Changing `lib/tension.ts`", "Rewriting … `pairTension`"): both gained an
  optional swing argument and are unchanged without it. The same change added
  three DRAFT golden cases (`pending: true`, drawn from an AI-generated deck's
  player types) that the harness reports and never asserts; they do not count
  toward the five this plan's kill criterion reads until the owner or the
  stringer confirms them.
- **`fit-3`: a slow swing asking for more power is not sent a head-heavy
  frame** (2026-10-09). The first of those drafts, g01 (a slow-swing beginner
  wanting more power), was where the engine and the deck disagreed: the
  `more_power` delta stepped every member one balance step toward head-heavy,
  and the engine picked the Astrox 88 Play. The published buying guides all
  say even balance, flexible-to-medium shaft, light — a heavier head adds
  smash power only to a swing fast enough to accelerate it — and Grant, as
  the stringer, rated the case that way ("I agree with online"). So
  `goalDelta(goal, swing)` answers `more_power` + `slow` with no balance or
  gram step; flex is left to the slow ceiling. Beat stepping flex down to
  Flexible as well: the engine then led with three Flexible entry rows none
  of which were on the stringer's list, and the rated list is Medium rows —
  whether Flexible should be preferred is the next question for the golden
  set, not a claim to make ahead of it. g01 is the first RATED case; g02 and
  g03 stay drafts.
- **`fit-5`: what the first backtest asked for** (2026-11-04, Grant: "Yes
  to both"). Two changes, both for the member with NO racket to anchor on —
  the one the questionnaire exists for. (1) **A Balance question on the Fit
  page**, asked only while nothing in the bag can anchor (no catalog racket,
  no typed-in racket with both its balance and shaft stated — `feelAnchors`,
  the engine's own rule, so the page cannot drift from it), in the three words the feel
  chips already use — Head-heavy / Even / Head-light, with where the weight
  sits under each and nothing drawn (the goal tiles' rule: no picture of what
  a racket should be). Stored as `PlayerGear.fitBalance`, in the feel
  vocabulary so the engine reads it as it reads a catalog row; it sets the
  unanchored start ahead of the court side, the goal still moves it, and an
  often-sore arm caps it at even as it caps the side. With an anchor it is
  not read, and it is outside the "n of 5" — a question only some members
  see cannot be one of everyone's five. Grant's wording call: the plain chip
  words, never "feel". (2) **No tier steer without an anchor.** The level
  row's tier was a guess at what a member would buy, and the club buys
  premium at every level; the budget question is the one input that speaks
  to price and it already ramps, so the tier term costs nothing unanchored.
  With an anchor it is unchanged (a Beginner reaching up from their own
  racket's tier still pays double). Not changed: a typed-in racket's tier is
  still taken from the level (`levelTierLabel`) — that is the ANCHORED path
  and the backtest said nothing about it. The nine production cases carry no
  `fitBalance`, so the next backtest read can only move on tier until someone
  answers; the golden and manufacturer cases are unchanged on `fit-5`, and
  the property suite gained four checks (the answer sets the start, the
  anchor ignores it, the tier never moves an unanchored score, and the
  premium-only order is what `fit-4` gave).
- **`fit-4`: the side of a mixed court** (2026-10-20). The Fit page split
  Mixed into Mixed · front and Mixed · back on 2026-10-20, and both were read
  as `both` — the same racket as All-around. Grant: "mixed selection why is it
  ignored?" Now (`lib/courtSide.ts`): with no racket to anchor on, the side
  sets the starting balance — front head-light, back head-heavy — the way the
  level sets the rest; a slow swing or an often-sore arm keeps the back court
  at even, for the fit-3 reason and the comfort ceiling. With an anchor, the
  racket they play stays the start and a frame matching the side earns the
  format bonus. The string and tension engines read front as doubles and back
  as singles (`sideFormat`), which already say the right thing ("quick off the
  strings for flat exchanges" / "hold length from the rear court"); back court
  therefore reads a pound tighter. An explicit Doubles / Singles tap on the
  tension card wins over the side. No golden case plays mixed, so the rated
  picks are unchanged.
- **g02 and g03 rated, and the 88S rows relabelled Even** (2026-10-09). The
  two drafts were checked against published reviews before the stringer
  confirmed them ("02 and 03 looks good for now"). The check exposed a
  catalog problem rather than an engine one: the catalog labelled every
  Astrox 88S row head-heavy / Stiff / Premium / doubles, which is the 99
  Pro's triple with the doubles bonus on top, so the engine served the
  front-court 88S Pro to a rear-court smasher asking for more power and
  could not have done otherwise. Yonex's own chart does call the 88S
  head-heavy, just less so than the 88D; the vocabulary has no "slightly
  head-heavy". Two fixes were offered — relabel the 88S rows Even, or add a
  fourth balance rung — and the stringer chose the relabel ("option 1").
  All four 88S rows (Pro 2nd and 3rd gen, Tour, Game) are Even now, the
  reason is in each row's `notes`, and the 3rd-gen Pro's `playStyle` is
  Control, as its own note already said. A fourth rung stays the honest fix
  if a second family hits the same wall.

- **How to validate alternatively** (2026-11-04; Grant: "we are rethink about
  racket fit how to validate alternatively"). The two legs of the gate above
  wait on scarce people — the owner and the stringer rating profiles at a
  desk (stuck at 3 of 5 since 2026-10-09), and two engaged members in a club
  of thirty (passed at exactly two, which proves little). Three legs that
  need nobody's evening were added, and the fourth is proposed:
  1. **The owned-racket backtest** (`lib/fitBacktest.ts`,
     `GET /api/reports/fit-backtest` behind the read-only reports key). Every
     member who plays a catalog racket is a case nobody had to write: hide
     the racket, run the engine from scratch, compare the CLASS of the pick
     (balance, flex within a step, weight within 3 g, tier) with the class of
     what they hold. A racket someone bought and kept is weak truth — people
     play what they were sold — so it scores the class, never the model, and
     says nothing about whether the racket is RIGHT for them. **Its first
     lesson came from its own test**: with the anchor hidden and the goal
     forced to `happy`, the engine has nothing that steers balance and aims at
     the level default (even) for everyone, so a head-light or head-heavy
     owner can only match it by luck. "As answered" (the member's own goal) is
     therefore the headline and "as if happy" the floor; `byGoal` is reported
     so the `happy` rows — the clean ones — can be read on their own. Totals
     only. **Not yet read on production**: it needs a deploy and then one call
     with `BPM_REPORTS_KEY`; the Review-on line is that read.
  2. **Property tests** (`__tests__/fit-properties.test.ts`): the claims in
     `lib/racketFit.ts`'s own header, each turned into a check over every
     scorable anchor in the catalog — determinism and catalog-order
     independence, the owned racket never handed back, the goal deltas
     monotone on the axes they name, no goal but control touching flex,
     fit-3's slow-swing rule, comfort constraining swing-weight and tension
     and never flex, ceilings penalising and never hiding, budget as a
     preference, an unanswered swing widening the tolerance, fit-4's court
     side. Metamorphic: change one answer, the target moves the known way or
     not at all. They cannot say the rules are the RIGHT rules; that stays
     with the golden set and the bench. 24 checks, all green on `fit-4`.
  3. **The manufacturers' second opinion** (`rater: 'manufacturer'` cases
     m01–m04 in the golden fixture): each brand's series positioning — Astrox
     / Thruster / Axforce for power, Nanoflare / Auraspeed / Bladex for speed,
     Arcsaber / DriveX / Halbertec for control, the entry shelf for a first
     racket — as the acceptable set for the player type the brand describes,
     generated from the catalog by series so the claim is about the line and
     not a hand-typed list (the first cut typed eleven ids for the speed
     player and failed on three head-light Nanoflare and Bladex rows the
     engine rightly chose). Marketing, so counted apart from the expert cases
     and never toward the five; asserted, because disagreeing with every
     brand at once is worth a red test. All four agree with `fit-4`.
  4. **Proposed, not built: the bench.** The stringer handles real rackets
     from real players every week; a one-line "the engine would have picked
     X for this player — agree?" on `StringingJobDetail` is an expert rating
     in the one moment the expert already holds the evidence. Waits on the
     backtest's first read.

  Not done, on purpose: an A/B of engine versions. With ~30 members and two
  engagement taps a month it would take a year to say anything.

## Shape

| Piece | Where |
|---|---|
| Design | `docs/superpowers/specs/2026-09-07-racket-fit-design.md` |
| Fit fields on the gear doc | `lib/types.ts` → `PlayerGear.fit*`, `stringBudgetMaxCad` |
| PATCH validation, GET strip of the comfort field | `app/api/equipment/gear/route.ts` |
| Fit questionnaire | `components/stats/GearFitSheet.tsx` |
| Engine (pure) | `lib/racketFit.ts` — `GOAL_DELTA` is the tuning table |
| Transitional English reasons | `lib/fitReasonText.ts` (deleted in Phase 4) |
| Route: fitState, alternatives, `pick_served` | `app/api/recommend/route.ts` |
| Alternatives + feedback controls | `components/stats/GearPickSheet.tsx` |
| Golden set + harness | `__tests__/fixtures/fit-golden.json`, `__tests__/fit-golden.test.ts` |
| Feedback read | `app/api/admin/slice0/route.ts` (`picks`), `app/api/admin/fit-preview/route.ts`, `scripts/dump-fit-cases.mjs` |
| Privacy disclosure | `messages/{en,zh-CN}.json` → `legal.privacy` |
| Owned-racket backtest | `lib/fitBacktest.ts`, `app/api/reports/fit-backtest/route.ts`, `__tests__/fit-backtest.test.ts` |
| Property suite | `__tests__/fit-properties.test.ts` |
| Manufacturers' second opinion | `__tests__/fixtures/fit-golden.json` (`rater: 'manufacturer'`, m01–m04), `__tests__/fit-golden.test.ts` |
| Flag | `NEXT_PUBLIC_FLAG_RACKET_FIT` in `lib/flags.ts` |
