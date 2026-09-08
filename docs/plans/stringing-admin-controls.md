# Stringing bench — admin controls

**Track:** admin cost-automation (North Star pillar 3). Not a new surface — the stringing
bench shipped in Stage 1 and this closes gaps found by using it.
**Status:** shipped 2026-09-06 (PR #320, plus the follow-ups in #321 and #326)

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

**Fields, not statuses.** `archivedAt` and `prioritizedAt` are orthogonal to
`status`. Beat: an `'archived'` member of `STRINGING_FLOW`, which would need
handling in seven places — the flow array, `playerStageFor`, `OPEN_STATUSES`,
`BILLABLE_STATUSES`, the bench's `TONE` table, `dueFor`, `INTERRUPTING_STAGES` —
four of them plain arrays that fail silently on an unhandled member.

**Archive does not touch money.** Beat: writing the debt off on archive, which
is faster but makes a routine tidy-up silently change someone's balance.
`isBillable` never reads `archivedAt`; the archive row prints "Still owed $X"
instead, and only *deleting* removes the line.

**Delete warns rather than refuses.** Beat: blocking a purge while an amount is
outstanding. Refusing would be the app overruling the person who knows whether
the racket was ever collected. Archive is the real safety net — delete is
reachable only from there (409 `not_archived`).

**The filter and the sort are both written in JS.** Not a style choice. The mock
store does not parse SQL — it applies one filter per parameter *name* — so a
parameterless predicate matches everything under test while reading as correct
in production. And Cosmos `ORDER BY` omits documents lacking the ordered field,
so `ORDER BY c.prioritizedAt` would have hidden every un-pinned job.

**The gesture reveals; the tap commits.** Beat: swipe-to-commit, which is one
mis-drag away from archiving somebody's job with no hover state to warn and no
cheap undo. And swipe is never the only affordance — every action is also in the
row's `more_vert` sheet, because a gesture nobody discovers is how kudos became
unfindable.

**No drag-to-reorder.** `lib/reorder.ts` already records that a pointer-events
drag hook was built for the rate card and deleted in favour of buttons.

**Price and spec travel as ONE proposal.** The request described two features; a
tension change usually costs something different, and asking twice about one
racket teaches people to dismiss the asking.

**Only a CHANGE needs confirming.** The first price is a direct write — there is
nobody to confirm with yet. Changing a price the player already knows returns
409 `confirm_required` unless forced, the same guard-then-escape shape as
settle's "unsettle first".

**A pending change does not block the bench.** The racket and the invoice are
two separate clocks: a status is a claim about the physical world, and somebody
agreeing to a price should not gate the stringer picking a racket up.

**The exact price crosses the wall inside the diff, and only there.** You cannot
ask somebody to agree to "$28–32". Documented in the same spirit as kudos'
`raterName`; emitted only while a proposal is outstanding and only for fields
actually changing.

**The push carries no money.** Not the figure, not the band. This is the most
tempting place in the app to break that rule, because the notification exists
*because* a price changed.

## Shape

| Piece | File |
|---|---|
| Fields (`archivedAt`, `prioritizedAt`, `pendingEdit`) | `lib/types.ts` |
| Archive filter, priority sort, player diff projection | `app/api/stringing/jobs/route.ts` |
| Archive / pin / propose branches, price guard, DELETE | `app/api/stringing/jobs/[id]/route.ts` |
| The player's only write path | `app/api/stringing/jobs/[id]/accept/route.ts` |
| Push payload (money-free) | `lib/pushMessages.ts` |
| Pending-edit dispatcher | `lib/stringingNotifyDispatch.ts` |
| Cross-component balance refresh | `lib/balanceRefresh.ts` |
| Swipe gesture | `components/primitives/SwipeRow.tsx` + `.swipe-row` in `app/globals.css` |
| Row-action row (lifted from PaymentsCard) | `components/primitives/ActionRow.tsx` |
| Bench, archive view, row menu, delete confirm | `components/admin/CommandCenter/StringingPage.tsx` |
| Propose form, pending/declined state | `components/admin/CommandCenter/StringingJobDetail.tsx` |
| Rate-card price prefill | `components/admin/CommandCenter/StringingIntake.tsx` |
| Player prompt | `components/stringing/ConfirmChangeSheet.tsx` + `StringingCard.tsx` |

## What the visual pass caught that the suite could not

Recorded because all four had a green suite and a clean `tsc`:

1. Four Material Symbols glyphs rendered as the literal words ARCHIVE and
   OPEN_IN_NEW. `__tests__/icon-subset.test.ts` existed and missed them, so it
   gained a fourth check for glyphs named in a JSX-prop or object-property
   ternary — the shape a primitive rendering `{props.icon}` always produces.
2. The un-archive swipe tray read PUT BACK ON THE BENCH — menu copy in an 88px
   button.
3. The neutral tray was drawn at 3% tint; since it sits *under* the card, the
   page showed through and it read as a hole rather than a control.
4. Accepting a price change left the balance card above it showing the old
   total, because it fetches separately. Fixed with `lib/balanceRefresh.ts`.
