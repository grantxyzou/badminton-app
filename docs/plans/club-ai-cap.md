# A daily AI allowance per club

**Track:** multi-group (`docs/plans/multi-group.md`): a second club must not be able to run up the operator's bill. Follows `docs/plans/string-photo-stocktake.md`, the fourth feature on the shared key.
**Status:** in-flight
**Review on:** 2026-12-31 — has any club hit an allowance (a `[club-ai-cap]` log line)? If one did on an ordinary day, the number is too low; raise it there. If none did and a second club is active, leave it.

## Problem

Grant, 2026-11-16, asking about the photo stocktake: *"id this API following
badminton group, organiser, or App wide?"* It is app-wide: one
`ANTHROPIC_API_KEY` for every club, and every limit in front of it was per
caller or per person. A second club with five stringers could make 150 photo
calls a day on his key. Then: *"add the per-club AI cap"*.

## Kill criterion

A club's ordinary use is refused: a member's Stats read falls back to an old
one, or an admin is told to try tomorrow, on a day nothing unusual happened.
Then the allowance is wrong, and the number in `lib/aiBudget.ts` goes up.

## Non-goals

- A bill per club, a key per club, or showing a club its usage. One ceiling
  per club per feature per day is the whole change.
- Persisting the count. In-memory like every limiter here: a restart resets
  it, which can only let a club through, never lock one out.
- Changing the per-person and per-caller limits each route already has.

## Decisions

- **One allowance per feature per club**, not one shared pot: a busy day of
  shelf photos must not starve a club's members' Stats reads. 60 writing, 300
  Stats reads, 300 fit verdicts, 30 shelf photos a day.
- **Charged only before a real model call.** A cached answer takes nothing.
- **Over the allowance, each feature does what it does with no key**: Stats
  serves its last read, the fit verdict its templated words, the stocktake
  counts by hand, the writing helper says try tomorrow.

## Shape

| Piece | File |
|---|---|
| The allowance | `lib/aiBudget.ts` |
| Callers | `app/api/claude/route.ts`, `app/api/stats/insight/route.ts`, `app/api/equipment/fit-verdict/route.ts`, `app/api/stringing/stocktake/scan/route.ts` |
| Tests | `__tests__/club-ai-cap.test.ts` |
