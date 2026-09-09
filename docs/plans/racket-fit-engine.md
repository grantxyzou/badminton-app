# Racket fit engine

**Track:** ROADMAP North Star pillar 4 — "recommendations strong enough to suggest
equipment purchases"; Value-Hub Track 2 (Equipment). ROADMAP §4 still says tracks
1–4 stay blocked until the Slice-0 readout; the `VALUE_HUB_SLICE` note in
`lib/flags.ts` records that the fan-out was made by shipping, not by reading the
gate. This file says so rather than pretending the readout happened.
**Status:** in-flight — Phase 0 shipped 2026-09-08 (#335); Phase 1 shipped 2026-09-09 (#337, #344); Phase 2 (the engine, behind `NEXT_PUBLIC_FLAG_RACKET_FIT`) in review
**Review on:** 2026-10-19 — ≥5 golden cases rated, and ≥2 members with any `pick_*` event? If not, drop the fit questionnaire.

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
  `pick_tried`, `pick_rated`

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
- **Sequenced ahead of multi-group** (owner, 2026-09-07). Phases 0–3 are what
  unblock that plan's call-site sweep; Phase 4 lands after it.

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
| Feedback read | `app/api/admin/slice0/route.ts` (`picks`), `app/api/admin/fit-preview/route.ts` |
| Privacy disclosure | `messages/{en,zh-CN}.json` → `legal.privacy` |
| Flag | `NEXT_PUBLIC_FLAG_RACKET_FIT` in `lib/flags.ts` |
