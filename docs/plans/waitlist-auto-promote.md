# Waitlist auto-promote

**Track:** admin cost-automation (North Star pillar 3) — a freed spot used to wait for an admin to notice it.
**Status:** in-flight
**Review on:** 2026-12-09 — since ship, how many waitlisted rows carry `promotedAt`, and how many of those were then cancelled (late or not)? Promotions with few cancels = working; most promoted rows cancelled = the push reaches people too late to use it.

## Problem

Grant, 2026-10-28, asking what happens to a waitlisted player when a signed-up
player cancels, or when the admin adds a court. The answer was "nothing":

- A cancel only marks the row removed. Nobody on the waitlist moves up and
  nobody is told. The admin promotes by hand from the Payments card.
- Worse, a NEW sign-up sees the free spot (sign-up counts active rows) and
  takes it, ahead of everyone already waiting.
- Raising the player cap adds spots that go the same way.

Grant: "yes" to "move the first waitlister up automatically and push them when
a spot opens".

## Kill criterion

If, by the review date, most auto-promoted rows end up cancelled, the push is
arriving too late to be useful and promotion should stop at the late-cancel
window instead (the option Grant did not pick).

## Non-goals

- No "offer and accept" step. The waitlister already said they wanted to play
  when they joined; a hold-for-confirmation flow is a state machine nobody
  asked for.
- No demotion when the cap is LOWERED — unchanged, the admin decides who goes.
- No change to the held-for-unpaid rule: a held row is never auto-promoted; it
  moves up when its payment lands (`releaseHoldIfSettled`), as before.
- No promotion when an admin moves someone BACK to the waitlist: the first
  waitlister by sign-up time is often that same person, and it would undo the
  admin's move.

## Decisions

- **Promote right up to the session's start** (Grant, 2026-10-28, over "stop at
  the late-cancel window" and "promote until start, late tag stands"). A
  session that has started, has no start time, or is settled is left alone.
- **A row promoted inside the club's late-cancel window can cancel without the
  late tag.** `promotedAt` is stamped on every promotion (auto, the admin's
  manual PATCH, and the paid-hold release); `DELETE /api/players` asks
  `lateCancelVerdict` about `promotedAt` as well as about now, and a promotion
  that itself landed inside the window exempts the cancel. They never chose a
  late spot.
- **Order is sign-up order** (`compareBySignup` in `lib/capacity.ts`), the same
  order the post-insert race reconcile uses.
- **Fills every free spot, not one.** A cap raised by two promotes two.
- **Race-safe by etag.** Each promotion is a `replace`; a 412 (another request
  promoted that row, or it changed) re-reads and re-plans, up to three passes.
  The existing over-cap-by-one gotcha with a concurrent new sign-up is
  unchanged.
- **Best-effort after the primary write**, like every push trigger: a failure
  logs and never fails the cancel or the admin's save.
- **The push carries no money** and names the day in Vancouver time (CLAUDE.md
  — session times display in Vancouver whatever the server's zone).

## Shape

| Piece | File |
| --- | --- |
| Plan and promote, best-effort | `lib/waitlistPromote.ts` |
| Push copy | `lib/pushMessages.ts` `buildWaitlistPromotedPayload` |
| Self-cancel, admin remove, admin purge-one | `app/api/players/route.ts` `DELETE` |
| Admin `removed: true`; `promotedAt` on manual promote | `app/api/players/route.ts` `PATCH` |
| Raised `maxPlayers` | `app/api/session/route.ts` `PUT` |
| `promotedAt` on the paid-hold release | `lib/paymentsInbox.ts` |
| Tests | `__tests__/waitlist-auto-promote.test.ts` |
