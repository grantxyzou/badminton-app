# Racket fit engine

**Track:** ROADMAP North Star pillar 4 — "recommendations strong enough to suggest
equipment purchases"; Value-Hub Track 2 (Equipment). ROADMAP §4 still says tracks
1–4 stay blocked until the Slice-0 readout; the `VALUE_HUB_SLICE` note in
`lib/flags.ts` records that the fan-out was made by shipping, not by reading the
gate. This file says so rather than pretending the readout happened.
**Status:** in-flight — Phase 0 shipped 2026-09-08 (#335); Phase 1 shipped 2026-09-09 (#337, #344); Phase 2 (the engine, behind `NEXT_PUBLIC_FLAG_RACKET_FIT`, retired ON 2026-10-24) shipped 2026-09-09 (#345); Phase 3 (alternatives, feedback beacons, admin reads) shipped 2026-09-09 (#346, #350); engine re-weighted on the published evidence as `fit-2` 2026-09-10; `fit-3` 2026-10-09 (a slow swing's "more power" leaves the head alone, from the first stringer-rated case); Phase 4 waits on ≥5 golden ratings (3 rated 2026-10-09: g01–g03; the owner owes two of his own)
**Review on:** 2026-11-18 — moved from 2026-11-02 (Grant, 2026-11-04: "come up with a different way to validate the racket fit"). Read the **Validation v2** gate below: has the back-test run, and does the full engine beat both baselines AND the level-only ablation? Also `picks.engagedMembers` ≥ 2 in `GET /api/admin/slice0` (unchanged: `pick_served` is the denominator, not engagement).
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

- Fewer than **5** expert-rated golden cases (owner + club stringer) — **superseded by Validation v2 below once Grant approves it** — OR
- fewer than **2** members who saw a pick recorded any of `pick_added`,
  `pick_tried`, `pick_rated` (`picks.engagedMembers`; `pick_served` is written
  on every request that returns a pick and is the denominator, never the
  numerator)

→ remove the fit questionnaire (`GearFitSheet`, the `fit*` fields stay as
harmless optional data) and revert the engine to anchor-only: current racket +
level. Keep the defect fixes — tie-break, all-owned exclusion, i18n reason keys —
because they are correct regardless of uptake.

## Validation v2 (2026-11-04)

*Status: proposed, awaiting Grant's yes. Written BEFORE any result exists, so the
thresholds below cannot be bent to fit one. An independent read of the first draft
found fifteen holes; each is closed below, and the engine facts they rest on were
checked against the code (paths in brackets).*

**Why the old gate is replaced.** "≥5 expert-rated golden cases" can only be met by
two people (the owner and the club stringer), has sat at 3 for a month, and its
failure drops a feature for want of a rater, not for being wrong. The golden set
stays as a regression test and as the record of the owner's taste; it stops being the
gate. The "fewer than 5 golden cases" clause in *Kill criterion* above is
**superseded by this section** once Grant says yes. The member-engagement half
(`engagedMembers` ≥ 2) is unchanged.

**Two checks, neither needing a new rater.**

### 1. Back-test against racket choices members already kept

*The signal.* A racket a member stayed with. Three signals exist, and the readout
first reports how many members have EACH populated, before any cohort count:
- **Restrung with it**: 3+ DISTINCT string changes (`stringItemId` differs) logged
  against it. Count changes, not entries: a tension-only edit is a new entry
  [`lib/stringLog.ts:44-65`]. Attribute an entry only when its `racketItemId` still
  resolves to an item in the bag, because the log records the ACTIVE racket, not the
  one strung [`lib/stringLog.ts:21-24`], so a member who restrings a spare is
  mis-attributed and is excluded as `ambiguous_racket` when they own 2+ rackets.
  History starts 2026-09-14 and is capped at 50 entries, so expect few qualifiers.
- **In the bag 60+ days**: only where `GearItem.acquiredAt` is populated. It is an
  unvalidated client pass-through that nothing in the app is known to write
  [`app/api/equipment/gear/route.ts:370`], so if fewer than half the items carry it
  the signal is dropped, not guessed.
- Anything else is not a signal.

*Running the engine.* "Hidden" means removing the kept racket from `anchor`,
`ownedIds` AND `ownedLabels`. Removing it from `anchor` alone leaves it excluded
from the candidates, so it could never be picked [`lib/racketFit.ts:613-614`,
`lib/racketFitInput.ts:39-40`]. The member's OTHER rackets stay excluded, and every
baseline uses the same rule.

*Who is in the cohort.* A member needs a top pick unanchored, which requires
`fitGoal` AND `fitSwing` [`lib/racketFit.ts:592-599`]. No pick is `no_pick`: excluded
and counted, never scored as a miss.

*Match.* The kept racket's catalog id is in the top 3, or a top-3 row shares its
(balance, flex, weight-class) triple. Exact id alone is too strict: the catalog
holds near-identical rows. Baselines use the identical rule.

*Three comparisons, all must hold:*
- (a) **random**: the analytic expected hit rate over all scorable rows in the
  member's tier (not one random draw, so there is no seed to tune);
- (b) **club popularity**: the racket most owned across the cohort, with the member's
  own racket NOT counted in its tally (leave-one-out);
- (c) **ablation**: the same engine fed ONLY level, with `goal`, `swing`,
  `courtSide`, `armComfort`, `grip` all unset. That lands in `level_only`, a
  different path with a wider tolerance [`lib/racketFit.ts:597`], so beating (c)
  partly measures tolerance, not just the answers. The readout states this, and (c)
  is re-run with the answers shuffled across members as a second reading. (c) is
  what tests the questionnaire: if answering swing and goal does not beat level
  alone, the questions earn nothing.

*Decision rule (fixed now).* n = members left after every exclusion.
- `pass`: n ≥ 10, and for each of (a), (b), (c) the one-sided exact (or Wilson)
  lower bound on (engine − baseline) is above 0 AND the point difference is ≥ 15
  points. Reported as k of n, never a bare percentage. Three tests at n near 10 give
  a real chance of a spurious pass or fail; the readout prints that rate, and a pass
  is called "consistent with", never "proves".
- `fail`: n ≥ 10 and the lower bound of (engine − (c)) is below 0. Beating (a) or
  (b) while not beating (c) is a fail: the questionnaire is the thing on trial.
- `undecided`: anything else, including n < 10. The review date moves a month. After
  **two** consecutive `undecided` reads the default is `fail`, so "wait for more
  data" has an end date.

### 2. Direction tests (vitest, no data)

Properties the engine's code commits to, each tested at the level it actually
exists. A fixed-seed pairwise generator over (goal, swing, side, comfort, level,
anchor present/absent) with the catalog snapshot committed and the case count
printed, not every combination.
- **Slow swing.** Scoped to `goal = more_power`: `swing = slow` versus `medium`
  never raises a head-heavier row's score relative to a lighter one with equal other
  axes (the fit-3 rule). Other goals can legitimately keep the head-heavy target
  with an anchor, and a slow swing also moves `sideBalance` [`lib/racketFit.ts:376`].
  Assert on SCORE, not position: ties are ordered by price then id
  [`lib/racketFit.ts:520-527`].
- **Comfort.** `often_sore` leaves `target.flex` unchanged, never raises
  `weightCeil` or `balanceCeil`, and never raises any row's score against the same
  profile with `fine`. The engine has no racket tension or swing-weight output
  [`lib/racketFit.ts:356-357, 430-441`]; tension lives in the string engine and its
  own tests (`comfortTensionDeltaLb`).
- **Budget.** Budget is a ramped penalty, never a filter
  [`lib/racketFit.ts:452-456`]: a larger `budgetMaxCad` never LOWERS any row's score
  and never reorders rows within both budgets.
- **Grip.** `fitGrip` may change scores only by `gripMiss` on rows whose grip set
  excludes it [`lib/racketFit.ts:451`]; every other row's score is unchanged.
  `fitOvergrips` is not an engine input, so it gets no test.
- **Determinism.** Same input, same order.

These check that the engine behaves as designed, NOT that the design is right;
check 1 is the only one that touches the world, and a direction test passing is weak
evidence. A failing one is a bug to fix, never a reason to relax a property without
a written reason in *Decisions*.

### Loopholes found in this gate, and what closes each

1. **Leakage: answers describe the racket in the hand.** A member who owns a stiff,
   head-heavy frame says "fast swing" *because* of it. `fitUpdatedAt` is NOT a clean
   guard: it moves only when a fit ENUM changes, so any later edit (grip) pushes it
   forward, `fitOvergrips` and the string budget never stamp it, and docs written
   before the stamp have none [`app/api/equipment/gear/route.ts:566-572`]. So treat
   it as a lower bound on the latest changed answer. No `fitUpdatedAt` is
   `no_fit_stamp`, excluded. Count a member as pre-purchase only when
   `fitUpdatedAt` is before the earliest of `acquiredAt` and their first matching
   log entry; report post-purchase members apart and never in the pass/fail count.
   Under 10 left is `undecided`.
2. **Influence, not fit.** Members buy what Grant owns. Baseline (b) absorbs
   club-wide popularity. Report Grant's own bag apart. A run without the most common
   racket is a SENSITIVITY run, reported and never deciding.
3. **Kept is not right.** Restringing shows a racket was not abandoned, not that it
   suits the player. The claim is only "the engine points to what members stayed
   with", never "the engine is accurate".
4. **Selection.** Only members who use the stringing service and answered the
   questionnaire are in. A pass says nothing about a casual member. The readout shows
   cohort size beside `pick_served` members.
5. **Metric inflation.** Top-3 plus the triple rule makes a random pick hit often in a
   catalog of near-duplicates. Baselines use the same rule and the margin is over
   them, not over zero.
6. **Tuning on the test set.** The engine version (`fit-4`) is recorded with every
   read; any change to `GOAL_DELTA` or a scorer after a read voids it, and a new read
   needs members who joined the cohort since, not a re-run.
7. **Moving the goalposts.** The exclusion list, the (c) ablation input and the
   thresholds are frozen in this section before any run. Post-hoc filters are
   forbidden; a change is a dated entry in *Decisions* made before the run it
   affects.
8. **Silent cohort shrinkage.** The route returns every exclusion and why
   (`no_catalog_id`, `fit_after_purchase`, `no_fit_stamp`, `ambiguous_racket`,
   `no_pick`, `under_threshold`). A cohort that lost more than half before scoring is
   `undecided`.
9. **Two-club members.** `playerGear` and the log belong to the PERSON. A club's read
   covers members on THAT club's roster (`rosterMemberIds(groupId)`); a person on two
   rosters counts once toward each club's own read and never in a combined one.
10. **Tests that agree with the code by construction.** Direction tests gate
    regressions only; the only pass/fail evidence about the design is check 1.
11. **Health-adjacent data.** `fitArmComfort` and `fitSoreness` feed ranking and are
    stripped from other readers [`lib/types.ts:849-857`]. The route returns counts
    only, no output keyed by a health field, and suppresses any cell under 5, since
    in a club of ~36 a small cell names a person.
12. **The route's auth.** `GET /api/admin/fit-preview` today uses `isAdminAuthed` and
    returns top-3 per member id [`app/api/admin/fit-preview/route.ts:56-82`]. The
    back-test route is OPERATOR-only (the `migrate-groups` rule, an admin of BPM, not
    any club's admin), reuses fit-preview's roster check, and applies the roster
    narrowing before its first read.

**What this does not settle:** whether the engine's picks are *good for the player* —
only whether they match what members stayed with. Real-world fit still needs a loan
racket on a court. That stays out of the gate and in the wish list.

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
| Flag | `NEXT_PUBLIC_FLAG_RACKET_FIT` in `lib/flags.ts` |
