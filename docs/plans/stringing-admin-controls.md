# Stringing bench — admin controls

**Track:** admin cost-automation (North Star pillar 3). Not a new surface — the stringing
bench shipped in Stage 1 and this closes gaps found by using it.
**Status:** intent

## Problem

Four things the bench cannot do, found by running it:

- **Nothing ever leaves it.** `GET /api/stringing/jobs` is an unfiltered `SELECT * FROM c`.
  `picked_up` is a terminal *status*, not a way off the list, and there is no `DELETE`
  handler anywhere under `app/api/stringing/**`. Every racket ever strung is still on
  screen.
- **A price change is silent.** `PATCH .../jobs/[id]` overwrites `priceCents` freely, with
  no freeze and no notification. Someone quoted $30 can be billed $34 and find out from
  their balance card. Asked for as *"the ability to set the job's price also cost
  confirmation"* and *"the ability to edit a request, then send to the requester for
  confirmation"* — one mechanism, described twice.
- **No ordering.** Sort is `createdAt` desc only. `lib/stringingDue.ts:16` says the bench
  "sorts and colours by urgency"; only the colouring shipped. Asked for as *"the ability
  to prioritize the request"*.
- **The player-confirm seam is stubbed and empty.** `StringingJob.acceptedAt` exists,
  documented "Set when the player accepts the quote", written `null` at both intake paths,
  read by nothing.

Nobody outside the club has reported these — they are the stringer's own, from running the
bench. That is a weaker warrant than a player quote, and it is why the price loop (the one
part that touches somebody else's money) is the last of the four to ship.

## Kill criterion

- **Archive**: if after four weeks the bench still shows jobs the stringer considers done,
  archiving is too much work and the answer was an auto-archive rule on `picked_up`, not a
  gesture.
- **Priority**: if no job is ever pinned, urgency was already legible from the existing
  due-date colouring and the pin is clutter. Remove it.
- **Propose→confirm**: if proposals are routinely sent and never answered, the loop has
  added a blocking step to getting paid rather than trust. Fall back to notify-only —
  tell the player the price changed, do not ask.
- **Swipe**: if the row menu is used and the gesture is not, the gesture is decoration;
  delete `SwipeRow` rather than maintain a hand-rolled touch handler.

## Non-goals

- **Drag-to-reorder.** `lib/reorder.ts:9-13` records that a pointer-events drag hook was
  built for the rate card and deleted in favour of up/down buttons. Priority here is a
  pin, not an ordering.
- **A new status.** `archivedAt` is orthogonal to `status`; adding an `'archived'` member
  to `STRINGING_FLOW` would ripple through seven call sites, four of them silently.
- **A new container or feature flag.** Rides `stringingJobs` and
  `NEXT_PUBLIC_FLAG_STRINGING`.
- **Auto-archiving.** Archive stays a deliberate act until the kill criterion above says
  otherwise.
- **Telling the admin when a player declines.** The bench shows it; a push to the person
  already looking at the app is noise.
- **Reopening the price wall generally.** The exact price is exposed *only* inside a
  pending-change diff, because you cannot ask someone to agree to a range.

## Decisions

<!-- appended as the work proceeds -->

## Shape

<!-- appended as the work proceeds -->
