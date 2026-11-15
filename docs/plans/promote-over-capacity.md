# Promote from the waitlist into a full session

**Track:** the waitlist (`docs/plans/waitlist-auto-promote.md`): the organiser running the night decides who plays.
**Status:** shipped 2026-11-13

## Problem

Grant, 2026-11-12: "Give organizer and admin the ability to promote waitlisted people even if the session is full."

A full session refused every promotion (409 "Session is full", security rule 8), so an organiser who knew a court could take one more — someone always leaves early, a fourth on a court of three — had to raise the max players in Edit details, promote, and remember to put it back.

## Kill criterion

An over-the-cap promotion that nobody meant: a session read "13 of 12" after a tap that did not say it would. The row's label and hint, and the Payments card's confirm, are what stop it.

## Non-goals

- Raising the session's max players. The cap stays as set; the session reads over it ("13 of 12").
- Restoring a removed player over the cap, or a member signing up over it. Both stay capacity-checked.

## Decisions

- **An explicit flag, not a looser check.** `PATCH { waitlisted: false, overCapacity: true }`, on the admin-only path (any admin rank: admin or organiser, as every other promotion). Without the flag a full session still answers 409, so no older client and no slip of a finger goes over by accident.
- **The organiser is told what it makes.** The Session list sheet's row reads "Move into the session anyway" with "The session is full at 12. This makes 13 playing." (in courts when the club counts that way); the Payments card's Promote asks "The session is full. Move Kento in anyway?" after the server's 409.
- **The automatic promotion is untouched.** It fills free spots only (`planPromotions`), so while the session is over its cap a cancel hands nobody the spot until the count is back under the cap.

## Shape

| Piece | File |
|---|---|
| The override | `PATCH` in `app/api/players/route.ts` (`promoteOverCapacity`) |
| The client call | `promotePlayer(id, sessionId, { overCapacity })` in `lib/sessionRowActions.ts` |
| The two places it is offered | `components/admin/CommandCenter/SessionListCard.tsx`, `components/admin/CommandCenter/PaymentsCard.tsx` |
| Tests | `__tests__/promote-over-capacity.test.ts`, `__tests__/components/SessionListCard.test.tsx`, `__tests__/components/PaymentsCard.test.tsx` |
