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
- ~~**Telling the walk-up anything.** They have no app, so nothing is pushed, mailed or listed for them. The contact field is for the stringer to call or text them.~~ **Reversed by Grant on the canvas, 2026-11-12** ("automatically email"; "yes" to a second email when it is ready; "ok" to a phone number getting only the receipt). See "Two automatic emails, and a receipt" under Decisions. Still nothing is PUSHED or listed for them.
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

**Two automatic emails, and a receipt (2026-11-12).** Grant reversed the "telling the walk-up anything" non-goal on the canvas. Only a walk-up whose contact is shaped like an email (`walkUpEmailOf` in `lib/stringing.ts`, the same linear scan the sign-in forms use, now in the pure `lib/emailShape.ts`) is mailed; a phone number, or no contact, gets nothing sent.
- **The spec email** goes once from `POST /api/stringing/jobs`, after the job is created: "Your racket is with {club}'s stringer ({jobNo})", the spec in a box (job, racket, string and colour, tension, price as "$34, pay at pickup" or "Ask", ready by), and a footer saying why they got it.
- **The ready email** goes from `PATCH /api/stringing/jobs/[id]` when the status FIRST moves forward to `ready` — the same forward-only test as the member's stage notice — and never again once one has gone. The status write is etag-conditional, so two taps cannot both make the move. "Bring $34 or pay your stringer at pickup." only when it is priced and unpaid.
- **Each send is stamped on the job** (`walkUpEmails.spec` / `.ready`, `{ at, ok }`, additive), AFTER the job's own write and under a read-modify-`replace`. The page reads the stamp ("✓ Sent 3:04 PM" / "Not sent"), and a ready stamp with `ok: true` is what stops a second ready email. A failed ready send may go on a later forward move; a sent one never repeats.
- **"Send again"** is `PATCH { memberId, resendSpecEmail: true }`: admin only (a stringer's body allows `status` alone), on the bench's rate limit, nothing else in the body, and only for a FAILED or MISSING spec email (409 `already_sent` otherwise, `no_email` for a phone number). The tap claims the send under the job's etag first, so two taps send one email.
- **Same transport, sender and failure posture as the member's stringing email** (`lib/stringingNotifyEmail.ts`): `gmailTransport` with its timeouts, From the product's name, nothing sent without SMTP configured, never throwing out of the route. Its own module (`lib/stringingWalkUpEmail.ts`), because a shared private sender is how a subject ends up on the wrong template. English, like the member's email. The club's name is `Group.name` ("BPM Core"), the product's when it cannot be read.
- **Money is in the email**, as in the member's stringing email; only push bodies carry none, and nothing here pushes. The dispatcher's early `walk_up` return stays: no push, no Notifications-page record.
- **The receipt** is an image for any walk-up, phone or email or none: "Receipt for {name}" on the job page, drawn on a canvas (`renderStringingReceiptCanvas` in `lib/receiptTemplate.ts`, beside the session receipt, so it shares that file's token-guardrail exemption and no new escape hatch is needed) and shown as a PNG from a callback ref, the way `ReceiptSheet` does it. "Share" goes through `shareOrSaveImage` and "Save image" through the new `saveImage` in `lib/shareImage.ts`; both mark the external excursion before the hand-off. It names the person and the job and never the contact.

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
| The two emails: compose, send, stamp | `lib/stringingWalkUpEmail.ts`, called from both jobs routes |
| `walkUpEmails` stamps (additive) | `lib/types.ts` |
| "Send to {name}" card, receipt sheet | `components/admin/CommandCenter/StringingWalkUpSendCard.tsx`, `StringingReceiptSheet.tsx` |
| The receipt drawing; "Save image" | `lib/receiptTemplate.ts`, `lib/shareImage.ts` (`saveImage`) |
| Tests | `__tests__/stringing-walk-ups.test.ts`, `__tests__/components/StringingIntakeWalkUp.test.tsx`, `__tests__/stringing-walk-up-emails.test.ts`, `__tests__/components/StringingWalkUpSend.test.tsx` |
