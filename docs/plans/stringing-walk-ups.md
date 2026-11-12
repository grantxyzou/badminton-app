# Stringing jobs for walk-ups

**Track:** North Star pillar 4 (equipment service). The bench's intake (`docs/plans/bench-redesign.md`) could only log a racket for someone on the club roster.
**Status:** in-flight
**Review on:** 2026-12-16 — How many walk-up jobs were logged in four weeks (the bench, `walkUp: true`), and did the reconcile's `unlisted` count rise by about the number left unpaid, with no new mismatch?

## Problem

Grant, on the design canvas, 2026-11-12: *"give me the ability to add a job for people thats not in the roster"*. He approved the design the same day (*"yesh it looks good"*) and asked for it as its own PR.

The "New job" screen's "Whose racket?" card searched the club's members and nothing else. A friend of a member, a parent, or a player from another club who hands over a racket at the gym had no way onto the bench, so the stringer either kept the job on paper or logged it under a member's name, which put the bill on that member's balance.

## Kill criterion

- **Nobody logs one.** If four weeks after it ships no job carries `walkUp: true`, the paper workaround was fine and this is surface area for nothing. Remove the walk-up row from the intake (the data stays readable, since every field is additive).
- **It breaks the money checks.** If the daily reconcile reports a mismatch for a walk-up job, or a walk-up's price shows on any member's balance, the "unlisted line" decision below was wrong. Stop and fix it before anything else.

## Non-goals

- **An account for the walk-up.** "No account needed. Just this job." A walk-up who later joins the club is a new member, and their old job stays a walk-up job.
- **Telling the walk-up anything.** They have no app, so nothing is pushed, mailed or listed for them. The contact field is for the stringer to call or text them.
- **Paying a walk-up job by e-transfer through the inbox.** Auto-match reads the roster's balances, and a walk-up is on none. They pay at pickup, and the stringer taps "Mark paid".
- **Editing the contact after the job is saved, or turning a member's job into a walk-up's (or back).** Neither was asked for.
- **Remembering walk-ups between jobs.** No "recent walk-ups" chips. Each job stands alone.

## Decisions

**The partition key is `~walkup:<16 hex>`, one per job, minted on the server.** `stringingJobs` is partitioned by `/memberId`, and a walk-up has no member. The alternatives were a shared `~walkup` partition for every walk-up, or the job's own id. One per job wins because the ledger mirror writes the job's charge and payment under the job's `memberId`, and a separate partition per walk-up means no read of one walk-up's ledger partition can ever see another's money. The `~` prefix follows the ledger's sentinels (`~club`, `~unlinked`, `~anon`): a real member id is hex from `randomBytes` and cannot start with `~`, so `isSentinelLedgerId` already answers true for it. That means `purgeMember` refuses it and the admin credit route refuses it with no new code. The client never sends it: `POST /api/stringing/jobs` with `walkUp: true` ignores any `memberId` in the body. A member job whose `memberId` starts with `~` is refused (`400 invalid_request`), so a forged sentinel cannot become a bench row with the groups flag off, when there is no roster check.

**Money: the existing "unlisted line" path, no new ledger meaning.** A walk-up pays at pickup, to the stringer.
- No member's balance can show it. `computeOwed` reads jobs by the caller's own `memberId`, and `computeOwedForRoster` reads by roster member. A `~walkup:` id is on no roster. The payments inbox matches against those same lines, so auto-match can never land on one.
- The mirror is left as it is. When a priced walk-up job reaches ready, the mirror writes `charge:<job>:<n>` under its `~walkup:` partition. "Mark paid" writes `payment:<job>:<ms(paidAt)>` and the line nets to zero. So the club's income counts walk-up work like any job, which is what "Mark paid" should mean. The alternative was to skip the mirror for walk-ups, and the money view would then have under-reported what the stringer earned.
- The reconcile does not flag it. A ready, unpaid walk-up job has an open ledger line that no roster member is shown. The reconcile reads the job row as the live side. The row is still billable at the same amount, so the line counts as `unlisted`, exactly like a removed member still owing. Once paid it nets to zero and is skipped. The backfill computes the same ids from the job, so it agrees with the mirror.
- The money view's "still owed" (`outstanding`) is live from the roster, so an unpaid walk-up is not in it. That is correct: nobody is going to send that money in. It is collected at the counter.

**Notifications: nothing goes to the walk-up, and the dispatcher says so first.** `notifyPlayerOfStage` and `notifyPlayerOfPendingEdit` return before any read or write when the job is a walk-up (`reason: 'walk_up'`). Without that, the stage notice would point-read `members` with a sentinel id (a quiet 404), and the pending-edit notice would have written a Notifications-page record under a person who does not exist. The new-request push is sent only by `POST /api/stringing/requests`, which a player makes for themselves, so a walk-up job never reaches it. The 48-hour nudge goes to stringers, not the player. A walk-up job left at `requested` nudges them like any other, and leaving out the "requester" removes nobody. Stringer and admin pushes (assignment, nudge) may name the walk-up, as they name a member, and never carry the contact.

**The contact goes to admins and to the stringer the job is assigned to.** The hint promises "So you can tell them it's ready", and the person who tells them is whoever has the racket. A stringer who is not an admin may be that person. `toStringerJob` therefore carries `walkUp` always and `walkUpContact` only when asked (`{ contact: true }`). The stringer's own queue (`jobs`) asks for it. The "Waiting for a stringer" list (`unclaimed`, seen by every stringer in the club) does not. A player response never carries it: `toPlayerJob` lists its fields one by one and names neither, and a walk-up job is never in a player's list anyway. No push builder reads it.

**A change to a walk-up job applies at once. Nobody is asked.** "Change this job" sends a proposal (`propose`) that waits for the player to confirm in the app. A walk-up has no app, so a proposal would sit forever and the bench would say "Waiting on {name}". The smallest correct behaviour: on a walk-up job the route applies a `propose` body straight onto the job (the same validated, differing-fields-only diff), sets no `pendingEdit`, and sends nothing. A direct price change skips the `confirm_required` 409 too, because "confirm with the player" means confirming in person here. The paid rule still holds: a paid walk-up job cannot be re-priced (`409 job_paid`), for the same ledger reason as any job. On the job page the form says the change applies at once and should be agreed in person, the button reads "Save change", and the "Change without asking" menu is hidden because there is nobody to ask.

**The player routes cannot reach a walk-up job.** `accept`, `cancel` and the player list are all keyed by the caller's cookie `memberId`, and no cookie carries a `~walkup:` id.

**Stock counts it.** Stock is counted from every job in the club by label and status, whoever the racket belongs to, so a strung walk-up job draws a set like any other.

## Shape

| Piece | File |
|---|---|
| `walkUp`, `walkUpContact` (additive) on `StringingJob` and `StringerJob` | `lib/types.ts` |
| `WALK_UP_ID_PREFIX`, `isWalkUpJob`, limits | `lib/stringing.ts` |
| Create a walk-up job; refuse a `~` member id | `app/api/stringing/jobs/route.ts` (`POST`) |
| The stringer projection's contact option | `app/api/stringing/jobs/route.ts` (`toStringerJob`) |
| A change applies at once on a walk-up job | `app/api/stringing/jobs/[id]/route.ts` (`PATCH`) |
| No notice to a walk-up | `lib/stringingNotifyDispatch.ts` |
| Intake: "Add {name} as a walk-up", the walk-up row, contact field, "How they pay" | `components/admin/CommandCenter/StringingIntake.tsx` |
| Walk-up pill on the bench card and the stringer's queue | `components/stringing/JobCard.tsx` |
| Job page: pill, contact, "How they pay", the direct-change form | `components/admin/CommandCenter/StringingJobDetail.tsx` |
| Recent chips skip walk-ups | `components/admin/CommandCenter/StringingPage.tsx` |
| Tests | `__tests__/stringing-walk-ups.test.ts`, `__tests__/components/StringingIntakeWalkUp.test.tsx` |
