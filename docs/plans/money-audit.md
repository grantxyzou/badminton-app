# Money audit: every place the app writes money

**Track:** admin cost-automation (North Star pillar 3) — `docs/plans/payments.md` Phase 2 (the ledger). The reconcile is only worth running if a mismatch means something; this audit is what makes it mean something.
**Status:** in-flight
**Review on:** 2026-11-23 — Has Grant approved (or declined) each fix in "Gaps, worst first", and has the Ledger check read clean for seven days since the approved ones shipped?

## Problem

On 2026-11-16 the Ledger check (`lib/ledgerReconcile.ts`, `components/admin/ledger/ReconcileSheet.tsx`) flagged one stringing job: $40 paid in the ledger, no charge. It took three PRs the same day (#951, #952, #953). Grant afterwards:

> "I got no trust in this system now."

The ask is evidence, not reassurance: every path that writes money, traced from the route to the row write and the ledger mirror, with each claim checked against the code and, where it was in doubt, a test.

## Kill criterion

This audit failed if, after its approved fixes ship, the Ledger check flags a line in production whose cause is not named below. Each such line is a path this audit missed and is added here before it is fixed.

## Non-goals

- **No app code changes.** This file and one evidence test are the whole PR. Every fix waits for Grant's yes.
- No production data access. This is a code audit on the mock store, so it says what CAN happen, not what HAS.
- Not a redesign of the ledger. Each fix proposed is the smallest that closes its gap.

## How it was checked

Each path was read from the route through to the row write and the hook in `lib/ledgerMirror.ts`, asking four things: (1) do the row and the ledger agree in every direction, including the reverse (unpay, uncover, unsettle, delete, refund, withdraw)? (2) can two requests at once, or a redelivered webhook, double-write or lose a write? (3) is it scoped to the right club? (4) which test fails if it breaks?

Every gap below is PROVEN by `__tests__/money-audit-gaps.test.ts`: each test drives the real routes on the mock store and pins today's WRONG answer, in cents. When a gap is fixed its test fails, and the fix flips it to the right answer, which each test names in a comment. Two mock-store traps were kept in mind: it filters by parameter name and ignores partition keys, so nothing here relies on a query the mock would answer differently from Cosmos. Concurrency (gap 3) was made deterministic by giving each request its own clock tick; without that, two taps in the same millisecond compute the same payment id and the race hides behind the 409.

## The table

`replace` = the etag-conditional write (`lib/groupScope.ts`): a second writer that read the same version gets `undefined` and must re-read. `upsert` = unconditional: the last writer wins, whatever it read.

| Path | What it writes | Reverse handled? | Race-safe? | Club-scoped? | Test that covers it | Verdict | Proposed fix |
|---|---|---|---|---|---|---|---|
| **Settle** `POST /api/session/settle` | `session.settled`; `owedAmount`/`settledAt` per row; mirror: charge per row, cover per absorb row, payment for rows already ticked paid, court cost | Re-settle (`resettle: true`) thaws and re-freezes in one request and refuses `paid_would_change` | Rows written with `upsert` from the list read at the start: a payment landing in that window is overwritten back to unpaid (ms window, not tested) | Yes | `ledger-mirror.test.ts` (settle/unsettle), `settle-resettle-keeps-billed.test.ts`, `session-settle.test.ts` | **safe** for the common flow; race is theoretical | Write rows with `replace`; on `undefined`, re-read and re-stamp |
| **Unsettle / "Edit the bill"** `DELETE /api/session/settle` (NextSessionCard's "Edit the bill") | Clears `owedAmount`/`settledAt`, keeps `paid`; mirror voids charges, covers, court cost | **No.** A paid row's payment is not voided, so it stands alone. And a plain `POST` settle afterwards skips the `paid_would_change` check, so a paid row is stamped a new amount under `paid: true` | `upsert` (as above) | Yes | none until now: `money-audit-gaps` GAP 2 | **gap** | Refuse the unsettle while any billed row is paid (409 naming them). See gap 2 |
| **Cover / uncover** `PATCH /api/players { writtenOff }` | `writtenOff`, `coverMode`, forces `paid: false`; mirror: cover entry (absorb), void of cover on uncover, void of payment if it was paid | Yes. Resplit on a paid bill refused (`paid_would_change`); resplit itself is followed by a client re-settle | `upsert` (see gap 3) | Yes | `ledger-mirror.test.ts`, `settle-resettle-keeps-billed.test.ts` | **safe** (one minor record issue, gap 7) | — |
| **Remove / restore** `PATCH { removed }` | Soft flag only; no money moves. A billed row removed after settle still owes (re-settle keeps it) | Restore capacity-checked; a never-stamped row cannot rejoin a settled session (`session_settled`) | `upsert` | Yes | `settle-resettle-keeps-billed.test.ts`, `settled-session-writes.test.ts` | **safe** | — |
| **Hard delete** `DELETE /api/players { purgeOne / purgeAll }` | Removes the row; mirror `mirrorRowDeleted` voids charge and cover, keeps payment | **No** for a PAID row: −$X left with no charge. Same shape as the stringing bug #951 fixed. `ledger-mirror.test.ts:196` pins the current behaviour as intended | n/a | Yes | `ledger-mirror.test.ts` "purgeOne voids the charge and keeps the payment" (asserts the bug); `money-audit-gaps` GAP 1 | **gap** (no screen sends it today) | Leave a paid row's books alone, as #951 did. See gap 1 |
| **Plus-one guests** (`lib/plusOne.ts`) | A guest row is a normal `players` row with `guestOf`; the mirror charges it to the host (`memberOf`) | Same as any row | Same as any row | Yes | `plus-one.test.ts`, `ledger-reconcile.test.ts` (guest lines), `group-member-payments.test.ts` | **safe** | — |
| **Admin "paid" tap** `PATCH /api/players { paid }` | `paid`, `paidAt`, `paidVia: 'manual'`; mirror payment (or void of it) | Yes, un-tick voids the payment by id | **No.** `upsert` over the read: two taps (two phones, two admins) both see `paid !== true`, both write, both mirror under their own `paidAt`. Also overwrites an e-transfer or card payment landing in the same moment | Yes | `ledger-mirror.test.ts` (sequential only); `money-audit-gaps` GAP 3 | **gap** | `replace` with the read's etag, like the other three payment paths. See gap 3 |
| **Self-report "I paid"** `PATCH { selfReportedPaid }` | A flag only; no money | n/a | `upsert`: can overwrite a payment landing in the same moment (ms window) | Yes | `players-self-pay.test.ts` | **safe** (flag only), race theoretical | `replace`, with the gap 3 change |
| **E-transfer auto-match / assign** `lib/paymentsInbox.ts` `applyAllocations` | Row `paid` + `paidVia: 'etransfer'` + `paymentId`; job `paidAt`; mirror payment keyed on the payment doc | Un-pay goes through the admin tap (above). No un-assign route | `replace` (etag) per row; dedupe on Interac's reference number | Yes, by the club's payments key | `payments-inbox.test.ts` ("same email twice is one payment", half-applied resolve) | **safe**, one hardening | Re-check the row still owes exactly the allocated amount before marking it paid, as card pay does. See gap 8 |
| **Card pay** `lib/cardPay.ts` webhook + Stripe-dashboard refunds | Row/job paid by Checkout id; refunds un-pay only when the amount says which rows; mirror payment keyed on the Checkout id, void on refund | Yes, refunds void the payment; a re-priced line is refunded, not paid at the old amount | `replace` + per-line amount check; a redelivery reads `paymentId === checkoutId` and does nothing | Yes, by `event.account` matched to the club's Stripe account | `group-card-pay.test.ts` (redelivery, partial and full refunds, re-priced line, foreign account) | **safe** | — |
| **Store credit: pay with credit** `payWithCredit`, `refundStaleSpends` | `spend:<ref>:<n>` (credit), then row/job paid; refund on any failure | Paid another way → credit refunded. **But** an admin un-tick of a credit-paid row is undone by the next balance read, and the ledger cannot record it | Spend ids collide on a double tap; balance re-read after insert; row via `replace` | Yes | `store-credit.test.ts` (double tap, two taps at once, stale spends); `money-audit-gaps` GAP 6 | **gap** | An un-tick of a credit payment returns the credit in the same request. See gap 6 |
| **Credit codes (gift cards)** `lib/storeCredit.ts`, `lib/creditAttribution.ts` | Claim doc in `clubSettings` (unique by `/id`), then `gift:<hash>` credit entry | n/a (redeem once) | Claim doc is the lock; double tap credits once | Yes; minting is organiser-only | `store-credit.test.ts`, `credit-attribution.test.ts`, `group-giftcards.test.ts` | **safe** | — |
| **Stringing: status, price, paid, proposals** `PATCH /api/stringing/jobs/[id]`, `.../accept` | Job fields; mirror `mirrorStringingChanged` (charge while `ledgerHoldsCharge`, void on price change or leaving it, payment on paid, void on unpaid; heals a missing charge on any touch) | Yes since #951; a paid job cannot be re-priced (`job_paid`) | `replace` | Yes | `ledger-mirror.test.ts` (stringing), `stringing-billing.test.ts`, `ledger-reconcile.test.ts` | **safe** | — |
| **Stringing: invoice** `POST .../invoice` | `invoice.sentAt`; mirror charges an invoice-billed job | n/a (an invoice is not unsent) | `replace`; a second tap inside a minute is 409 `sending` | Yes | `group-stringing-invoice.test.ts` | **safe** | — |
| **Stringing: create** `POST /api/stringing/jobs` (incl. walk-ups) | New job, `paidAt: null`. **No mirror call** | n/a | `create` | Yes (roster check; walk-up under `~walkup:`) | `money-audit-gaps` GAP 5 | **gap, latent** (closed while the invoice flag is on) | Call the mirror after create. See gap 5 |
| **Stringing: archive / delete** `DELETE /api/stringing/jobs/[id]` | Archived jobs only; unpaid → charge voided; paid → books kept | Yes since #951/#953 (repair restores a charge an old delete voided) | Point read then `remove` | Yes | `group-ledger-repair.test.ts`, `ledger-reconcile.test.ts` | **safe** | — |
| **Court cost** (at settle) | `court:<session>:<ms>` under `~club` | Voided by unsettle / re-settle | With settle | Yes | `ledger-mirror.test.ts` | **safe**, but not reconciled (see "What the reconcile cannot see") | — |
| **Shuttle purchases** `app/api/birds/route.ts` | `shuttles:<id>`, adjustments `shuttles:<id>:adj:<n>`, voids on delete | Yes | `upsert` on the purchase; two edits at once compute the same `adj:<n>`, one delta 409s and is lost | Yes | `ledger-mirror.test.ts`, `ledger-backfill.test.ts`, `birds.test.ts` | **safe** in practice; race theoretical | `replace` on the purchase if outlay is ever reconciled |
| **String purchases** `app/api/stringing/stock/route.ts` | `strings:<id>` expense; void on delete | Yes | create / delete | Yes | `group-string-stock.test.ts`, `ledger-view.test.ts` | **safe** | — |
| **Expenses** `/api/admin/expenses` | `expense:<random>` under `~club`; delete is a void | Yes; a double void 409s | Random id: a double tap on Add writes two expenses | Yes | `admin-expenses.test.ts` | **safe** (double tap is the admin's to undo) | — |
| **Account deletion** `lib/memberPurge.ts` | Credit deleted; `member_owed` entries copied to `~anon:<id>`; `players` rows anonymized (kept); **`stringingJobs` deleted** | A paid or settled session line stays consistent. An UNPAID finished stringing job loses its row and keeps its charge | n/a | Per club (names) | `ledger-mirror.test.ts`, `member-purge-coverage.test.ts`; `money-audit-gaps` GAP 4 | **gap** | Reconcile counts a gone `~anon` row as `unlisted`. See gap 4 |
| **The reconcile** `lib/ledgerReconcile.ts` | Reads only; stores ids and cents | n/a | Runs once a day and on tap | Yes | `ledger-reconcile.test.ts` | **safe** for what it reads; blind spots below | — |

## Gaps, worst first

Ordered by how likely a club hits it today, times how much it confuses the books.

1. **Gap 2: "Edit the bill" after someone has paid.** Settle a session at $30 each, Lin pays, the organiser notices the court cost was wrong and taps **Edit the bill**. The unsettle voids Lin's charge but keeps her −$30 payment, so the Ledger check flags −$30 the next morning. The organiser fixes the cost to $45 and taps Settle: a plain settle never runs the `paid_would_change` check, so Lin's row now says **paid $45** when she paid $30. The ledger holds +$45 charge and −$30 payment, and the check flags +$15 every day. Nobody is told Lin owes $15 more. *Likely*: it is an ordinary button, and fixing a wrong cost after someone paid is exactly when it gets pressed. **Smallest fix:** `DELETE /api/session/settle` answers 409 `bill_has_payments` with the names while any billed row is paid. The organiser un-ticks those people (which voids their payments properly), edits, re-settles, and re-ticks them (a new `paidAt`, so a new payment id at the right amount). Applying the `paid_would_change` check to a plain settle does not work on its own: the unsettle has already wiped `owedAmount`, so every normal "paid during the week" row would be refused.

2. **Gap 3: two "paid" taps at once.** Two admins, or one admin on two phones, tick Lin paid at the same moment. Both requests read the row as unpaid, both write it (`upsert`), and both mirror a payment, under different `paidAt` ids: the ledger holds −$60 against a $30 charge and the check flags it daily. The same unconditional write can also wipe an e-transfer or card payment that lands in the same instant. *Unlikely but not rare*: a double tap on a slow connection does it. **Smallest fix:** `PATCH /api/players` writes with `replace` (the read's etag), as the inbox, card and credit paths already do. When it gets `undefined` it re-reads, and if the row is already paid it answers with that row and mirrors nothing. The self-report path takes the same change.

3. **Gap 6: un-ticking a row paid with store credit.** Lin pays $30 with credit. The organiser un-ticks her ("mis-tap" or "that was wrong"). The payment is voided, so the ledger correctly says she owes $30. Two minutes later Lin opens Home, `refundStaleSpends` sees a credit spend with no live payment, and reads it as a payment that crashed half-way. It marks the row paid again with the same credit, quietly undoing the organiser. The ledger cannot follow: the payment it would write is keyed on the spend's time, which is the id already written and voided, so it 409s. The row says paid, the ledger says $30 owed, and the check flags it daily. The same shape applies to a credit-paid stringing job un-ticked on the bench (same code path, not separately tested). *Unlikely*. **Smallest fix (Grant's call on the meaning):** an un-tick of a row whose `paidVia` is `'credit'` (or a job whose `paidAt` equals its spend's time) writes `refund:<ref>:<n>` in the same request, so the credit goes back to Lin and nothing is left half-done.

4. **Gap 4: deleting an account that owes for a finished stringing job.** Lin's racket is ready, priced $28, unpaid; Lin deletes her account. The purge deletes her `stringingJobs` but copies the $28 charge to `~anon` as the club's history. The reconcile then looks for the job, finds nothing, and reports `stale_charge $28` every day. There is no button that clears it: the repair from #953 restores charges, it does not retire them. Session lines are fine here because their rows are anonymized, not deleted. *Unlikely* (it needs an unpaid finished job at the moment of deletion). **Smallest fix:** in `runReconcile`, an open ref whose entries sit under `~anon` and whose row is gone counts as `unlisted`, like any line nobody on the roster is shown. The alternative is to void an unpaid stringing charge at purge, treating it as forgiven; that is a decision about money and Grant's to make.

5. **Gap 1: hard-deleting a paid sign-up (the known suspect).** Confirmed: `mirrorRowDeleted` voids a session row's charge and cover but never its payment, exactly the shape #951 fixed for stringing. An admin purges a paid $30 row, and the ledger keeps a −$30 payment with no charge, which the check flags daily. `purgeAll` does it to every paid row of the session. `__tests__/ledger-mirror.test.ts:196` asserts the current behaviour as if it were intended. *Rare*: **no screen sends `purgeOne` or `purgeAll` today**; only a direct API call reaches it. **Smallest fix:** `mirrorRowDeleted` takes `paid` and returns early for a paid row, leaving its charge and payment both standing. That is the same rule `mirrorStringingDeleted` follows, for the same reason: the money was collected, so the bill it paid exists. An unpaid row's charge is still voided. Update that test to the new rule.

6. **Gap 5: a stringing job created already finished and priced.** `POST /api/stringing/jobs` accepts `status: 'ready'` with a price and calls no mirror. A job made that way bills at Ready, with no charge in the ledger until someone next touches it; the check reports `missing_charge` meanwhile, and for a walk-up nothing reports it at all. *Not reachable today*: with `NEXT_PUBLIC_FLAG_STRINGING_INVOICE` on (production), a new job owes nothing until its invoice, and the invoice route mirrors. It reopens the day that flag goes off. **Smallest fix:** call `mirrorStringingChanged` after the create, with an empty "before" job.

7. **Gap 7 (minor, a record rather than the ledger): `paid: true` uncovers a resplit row past the guard.** On a settled bill someone has paid, `PATCH { writtenOff: false }` on a resplit-covered row is refused (`paid_would_change`), but `PATCH { paid: true }` on the same row is accepted and clears the cover through the paid mutex. The row then reads "paid $0" instead of "covered". Nobody's amount moves and the ledger agrees with itself (checked on the mock store, not kept as a test). **Smallest fix:** apply the same resplit check when `paid: true` would clear a resplit cover.

8. **Gap 8 (hardening): e-transfer allocation does not re-check the amount at write time.** Card pay refuses a line whose `owedAmount` moved since checkout; `applyAllocations` re-reads the row but checks only paid/covered. A line re-stamped between match and write (a re-settle in the same second) would be marked paid at the new amount for a transfer of the old one. Theoretical. **Smallest fix:** the card path's `owedAmount === amountCents` check, in `applyAllocations`.

## What the reconcile cannot see

The Ledger check compares the `member_owed` account against the rows Home shows, and nothing else. It cannot see:

- **Club outlay.** Court costs, shuttle purchases and adjustments, string purchases and expenses are written to the ledger but never compared with the `birds` docs, string purchases or session snapshots. A lost shuttle adjustment would show in the money view and nowhere else.
- **Store credit.** `member_credit` balances are not compared with anything. Stale spends self-heal on the member's next tap or balance read (`refundStaleSpends`), not in the check.
- **What actually arrived.** A ledger payment is the row's `owedAmount`, not the e-transfer's or the Stripe charge's amount. An admin assigning a $30 transfer to a $45 line records $45 collected.
- **An unpaid walk-up line with no charge.** A walk-up is on no roster, so its live line is never listed, and with no ledger entry there is nothing open to find.
- **Mirror failures across restarts.** `mirrorFailures` is a per-process counter, and three scheduled deploys a day reset it.
- **Payments before settle.** A row ticked paid on an unsettled session has nothing in the ledger until settle (by design: there is no amount yet).

None of these is a gap in what the app charges people. They are the honest edges of what "the Ledger check is clean" proves.

## Review (second pass, 2026-11-16)

A second reader went over the audit with one question added: not only "is the money right?" but "could an organiser understand and reconcile it from what the app shows?" (Grant: "We need the money in the app to be accurate and transparent to understand"). Each point below was checked against the code.

### Where the first pass holds

- All six gaps reproduce, and the ranking is right. Gap 2 ("Edit the bill") is the one an organiser meets in ordinary use; the rest need a race, a deletion or an un-tick of a credit payment.
- The four payment paths that already use the etag (`replace`) — e-transfer, card, credit, stringing — are the model the admin tap should follow. Nothing further was found in them.
- The pinned-wrong tests are the right shape of evidence: the gate stays green and each test fails the moment its gap closes. The one hazard is a future fix that flips a test to match without reading its comment; the comments name the right answer for that reason.

### Three money writes the table left out

| Path | What it writes | Finding |
|---|---|---|
| **Backfill** `POST /api/admin/ledger-backfill` (`lib/ledgerBackfill.ts`) | Charges, payments, covers, court costs, shuttle purchases for history the mirror never saw | Idempotent by the derived ids, bounded, key-gated behind `migrate-groups`. **Safe.** One transparency flaw, below: it labels every stringing payment `manual`. |
| **Repair** `POST /api/admin/ledger/repair` (`lib/ledgerRepair.ts`) | `charge:<job>:<n>` for a deleted paid job | Refuses a job that still exists and a job with nothing to restore; the id follows the mirror's own numbering so a second tap 409s. Club-scoped; `group-ledger-repair.test.ts`. **Safe.** |
| **Admin credit grant** `POST /api/admin/credit` (`grantCredit`) | `grant:<random>` credit entry | A random id, so a double tap grants twice. Rate-limited (30/min per caller) and visible in the member's credit history, so the admin can see and undo it. **Safe enough**; a derived id would need an idempotency key from the client. |

### Where the books are accurate but not transparent

These are not bugs in what anyone is charged. They are places where the app's own records cannot answer a question an organiser reconciling the books would ask.

1. **A stringing job does not remember HOW it was paid.** `Player` carries `paidVia` and `paymentId`; `StringingJob` carries only `paidAt` (and `cardPaymentId` for card). The live mirror writes the method into the ledger entry's `meta.via`, but the backfill cannot know it and writes `manual` for every job (`lib/ledgerBackfill.ts:93`), and the bench cannot show it either. So the money view's "collected by method" (`lib/ledgerView.ts`) is wrong for every backfilled stringing payment and for any job the mirror missed: an e-transfer for a restring reads as "Marked paid". **Fix:** additive `StringingJob.paidVia` / `paymentId`, written by the four payment paths (`applyAllocations`, `markJobCardPaid`, `markRowPaid`, the bench PATCH), read by the backfill and the bench. The payment id can stay keyed on `paidAt`, so no existing entry moves.

2. **The ledger records the bill, never the money that arrived.** A `payment` entry is `−owedAmount` (`paymentEntry`), whatever the transfer or Stripe charge said. An organiser assigning a $30 e-transfer to a $45 line records $45 collected, and gap 2's row — paid $30, re-stamped $45 — has no field anywhere that says "$30 was received". The Interac amount exists only on the `payments` doc, which the row does not point back to for amount. **Fix:** additive `Player.paidAmount` (and the same on a job), stamped by every payment path with what was actually received; the ledger payment is that figure; a row whose `paidAmount < owedAmount` shows "paid $30 of $45" on the Payments card and in the member's balance. This is the one change that would let the app *show* gap 2 instead of only flagging it — and it is the better long-term fix for gap 2 than refusing "Edit the bill": the unsettle would then void the payment with the charge, the re-settle would re-mirror it at the amount paid, and the $15 difference would appear as still owed. Grant's call: the 409 is a one-line fix today; `paidAmount` is a small feature.

3. **The money view shows two sources and does not say when they disagree.** `outstanding` is LIVE from the rows, `collected`/`income` are from the ledger, by design (`.claude/rules/money.md`). While the Ledger check is clean the two agree; while it is not, nothing on the page itself says which number to trust. `LedgerPage.tsx` already reads the last reconcile, so the hook is there. **Fix:** when the last check has mismatches or is stale, the ledger-sourced figures carry a visible "unchecked" mark naming the count, so a reader never takes `collected` as settled truth over a red check.

4. **Mirror failures are forgotten on every restart.** `mirrorFailures` is a process counter; production restarts three times a day on the scheduled deploys. The daily check finds the gap eventually, but the only direct evidence that a write failed is a log line nobody reads. **Fix (low priority):** persist each failure as a `kind: 'mirrorFailure'` row on the club's payments settings doc (id, kind, when), surfaced on the Ledger check sheet as "N writes failed since the last clean check".

5. **What a member sees is consistent.** Home's balance, "Pay with credit", the e-transfer candidates and Profile's "what you paid" all read the ROWS through `computeOwed` / `loadOwedInputs`, never the ledger, so a member can never see a number the organiser's row does not. That is the right design, and it is why every gap above is the ORGANISER's problem to notice, not the member's.

### How BPM stays true with Stripe (Grant, 2026-11-16: "how do BPM stay true with Stripe?")

The card path (`lib/cardPay.ts`, `app/api/payments/card/webhook/route.ts`, `docs/plans/card-pay-prototype.md`) is **one-directional**: Stripe tells BPM what happened, and BPM never asks Stripe what it holds.

**Stripe → BPM is strong.** Every event is signature-verified before anything is read; the event's `account` must equal the club's connected account (so one club's money can never mark another club's rows paid); the Checkout's `amount_total` and currency must equal the lines in its metadata; each row is marked paid under the etag and only while it is still this member's, settled, unpaid and at exactly the amount charged; the ledger payment is keyed on the Checkout Session id, so a redelivery collides and changes nothing; a line that can no longer be paid is refunded to the card under an idempotency key; a refund made in the Dashboard un-pays rows only when its amount names them. A webhook the app answers with a non-2xx (a 500 from a thrown apply, a 404 while the flag or key is off, a connection dropped by a deploy restart) is retried by Stripe for about three days. `group-card-pay.test.ts` holds all of it.

**BPM → Stripe does not exist.** Nothing in the app lists the club's Checkout Sessions, charges, refunds or disputes and compares them with the rows. So these are invisible in the app:

| What Stripe knows | What BPM shows | Why |
|---|---|---|
| A webhook Stripe gave up on after three days of failures (or one sent to an endpoint later disabled) | The row still owed, the member's card charged | No pull from Stripe; only the member complaining would surface it |
| A **chargeback / dispute** on a card payment | The row stays paid | `charge.dispute.*` is not subscribed; only the three events in the plan are |
| A Dashboard refund whose amount matches no single line ("left for a person") | Nothing: a `console.error` nobody reads | The e-transfer path writes a `review` row the organiser sees in "Needs a look"; the card path has no review row |
| A Checkout whose amount or account did not match (`amount_mismatch`, `account_mismatch`) | Nothing: `console.error` | Same |
| **Stripe's fee** on each payment | `collected.card` is the GROSS amount | BPM records what was owed, Stripe pays out the net; the club's bank statement will never equal the money view's card figure |
| A payment taken in Stripe outside the app (a Dashboard payment link, a manual charge) | Nothing | Not a Checkout the app built; no metadata to match |

The last two are by design and only need saying on the money view. The first four are the same shape as the "logged for a person" rule the e-transfer inbox was built to replace: a message in a log is not a message to a person.

**Smallest fixes, in order:**
1. **A card review row.** Every card outcome that is not "applied" or "already ours" (`amount_mismatch`, `account_mismatch`, `amount_matches_no_line`, a refund with no payment intent) writes the same kind of `review` row the e-transfer inbox writes, so it appears in "Needs a look" with the Checkout id, the amount and the reason. No new container: the `payments` container already holds review rows.
2. **Subscribe to `charge.dispute.created`** (and `.closed`), and treat a dispute like a Dashboard refund of the disputed amount: un-pay the rows it names, or a review row when it names none.
3. **A daily pull from Stripe**, on the same `POST /api/payments/remind` tick the Ledger check runs on: list the club account's Checkout Sessions with `payment_status: 'paid'` created since the last check, and for each one whose metadata lines are not all paid by that Checkout id, write a review row. That is the Ledger check's twin for Stripe: not a second writer, a reader that names the differences.
4. **Say "before Stripe's fee" beside the card figure** on the money view, and record `balance_transaction.fee` on the payment entry's `meta` when the webhook has it (the Checkout's payment intent carries the charge; one extra read per payment) so a later "net" column is possible.

Also a stale comment: `lib/cardPay.ts`'s header still says the flag "stays off in production"; it has been on since 2026-11-15 (`deploy-next.yml`, `NEXT_PUBLIC_FLAG_CARD_PAY: 'true'`). A docs-truth fix, not a money one.

### Recommended order, revised

1. **Gap 2**: ship the 409 on "Edit the bill" now (one line, no schema), and schedule `paidAmount` (transparency item 2) as the real fix.
2. **Gap 3**: `replace` in the admin tap.
3. **Transparency item 1** (`StringingJob.paidVia`): small, additive, and it makes the money view's method breakdown true.
4. **Gap 5** (`mirrorRowDeleted`), with the test in `ledger-mirror.test.ts:196` updated.
5. **Transparency item 3**: the "unchecked" mark on the money view.
6. Gaps 4 and 6 (need Grant's decision on the meaning), then items 4 and the minor gaps 7–8.

## Decisions

- **Evidence as pinned-wrong tests, not failing tests** (2026-11-16). A test that asserted the right answer would turn `main` red until each fix landed; a test that pins today's wrong answer keeps the gate green, proves the gap with numbers, and fails, naming the fix, the moment the gap closes. The alternative, `it.fails`, would also stay green but hides what the app actually does.
- **No fix in the audit PR** (#954), by the brief: Grant approves each one first.
- **Gap 2 fixed as the 409** (2026-11-16; Grant: "do gap 2 next"): `DELETE /api/session/settle` answers `bill_has_payments` with the names while any billed row is paid, and the card's "Edit the bill" says what to do. `paidAmount` (transparency item 2) stays the fuller fix and is not in this change. The evidence tests for gap 2 now assert the right answer.

## Shape

| Piece | File |
|---|---|
| This audit | `docs/plans/money-audit.md` |
| Evidence (gaps 1–6) | `__tests__/money-audit-gaps.test.ts` |
| Gap 2 fix | `app/api/session/settle/route.ts` (DELETE), `components/admin/CommandCenter/NextSessionCard.tsx` (`editBill`), `__tests__/session-settle.test.ts` |
