# What was actually received: `paidAmount`

**Track:** Admin cost-automation (North Star pillar 3) · `docs/plans/payments.md` Phase 2, the ledger
**Status:** in-flight
**Review on:** 2026-12-07 — has a part-payment shown up in production, and did the organiser understand the row ("paid $30 of $45") without asking?

## Problem

From the money audit's second pass (`docs/plans/money-audit.md`, "Where the books are accurate but not transparent", item 2): **the ledger records the bill, never the money that arrived.** A `payment` entry was `−owedAmount` whatever the transfer said, so an organiser assigning a $30 e-transfer to a $45 line recorded $45 collected, and nothing anywhere said "$30 was received". The Interac amount lived only on the `payments` doc. Grant, 2026-11-16: "do paidAmount next".

## Kill criterion

If, a month after shipping, no row in production carries a `paidAmount` short of its bill, the field is only ever equal to `owedAmount` and the "paid $30 of $45" line is dead weight: fold it back to a boolean and delete the spread.

## Non-goals

- **No part-payment by hand.** The admin tap stays "paid in full". A part-payment arises only when an organiser assigns a transfer by hand to lines it does not cover; nobody types "$30 of $45".
- **No part-paid stringing job.** A job line is paid whole or left for the next payment; `StringingJob` gets no amount field.
- ~~Lifting the "Edit the bill" refusal~~ — done 2026-11-18, below.
- No change to what the automatic match, card pay or credit accept: a line in full, or nothing. (Credit since takes a part of a session line: `docs/plans/partial-credit.md`, 2026-11-21.)

## Decisions

- **`Player.paidAmount` (dollars, additive) is what was received against the row; `paid: true` keeps meaning paid in full.** A payment short of the bill leaves `paid: false` with `paidAmount` set, and the row owes `owedAmount − paidAmount`. Absent on a paid row = paid in full, so every row from before reads as it did. `paid` stays the truth every reader already trusts; only the one reading of what a row owes (`classifyOwed`) subtracts.
- **Every payment path writes it.** The admin tap and settle record the whole bill; card and credit (full by construction) the same; the inbox writes what it put against the line. An un-tick, a card refund and a returned credit clear it.
- **The ledger payment entry is what was received.** A live hook passes the delta it just applied (`mirrorPaid(scope, row, receivedCents)`); settle and the backfill read the row (`paidAmount ?? owedAmount`), and a part-paid row gets its entry at settle like a paid one. An un-tick voids every payment on the row, a part-payment's included, so a bill paid in two transfers un-ticks clean.
- **A short transfer assigned by hand is spread oldest first** (`spreadOverLines` in `lib/paymentsInbox.ts`): each session line takes what is left of the money, down to a part of itself; a stringing line is taken whole or skipped. `PaymentAllocation.lineCents` (additive) keeps what the line owed when matched beside `amountCents`, what was put against it.
- **Gap 8's rule becomes "never more than the line owes".** A re-settle that RAISED the bill between match and write now lands as a part-payment (which is the truth: $30 came for a $45 line); one that LOWERED it still leaves the payment in the queue, because paying more than a line owes is a guess.
- **Settle makes `paid` follow the money.** A row ticked paid at the estimate records the whole frozen bill; a row a short transfer was assigned to before settle is paid once the money covers the bill, else owes the rest. An over-payment (the bill came in under what was received) is left visible to the Ledger check as a mismatch, never hidden.
- **What a member sees:** Home's balance line shows what is LEFT and "paid $30 of $45" beside the date; Profile's "what you paid" chart counts what was received; the Payments card shows the remainder and "Paid $30 of $45" under the name; the Ledger check's sentence says "$30.00 received so far".

- **"Edit the bill" with people paid, and the over-payment is the club's income** (2026-11-18; Grant, asked credit or income: "creadit it extra income for me~", then picked "Keep it as club income"). The unsettle keeps every payment and the row's `paidAmount`; the re-settle marks a row paid when what it received covers the new bill and books anything above it as `overpaid` (club income, `income.overpaid` on the money view, "Paid $30 · $10 kept" on the Payments card); a row short of the new bill owes the rest. Beat: store credit (the money would have gone back to the member as next week's discount — Grant's choice was income), a refund (card fees, and a manual step for cash).

## Shape

| Piece | File |
|---|---|
| The field, the allocation's `lineCents` | `lib/types.ts` |
| The one reading of what a row owes | `lib/playerIdentity.ts` (`classifyOwed`), `lib/owedBalance.ts` (`UnpaidSession.paidAmount` / `billedAmount`) |
| Writers | `app/api/players/route.ts` (PATCH), `app/api/session/settle/route.ts`, `lib/paymentsInbox.ts` (`spreadOverLines`, `applyAllocations`), `lib/cardPay.ts`, `lib/storeCredit.ts`, `lib/creditReview.ts` |
| The ledger | `lib/ledgerMirror.ts` (`paymentEntry`, `paymentEntryAtSettle`, `mirrorPaid`), `lib/ledgerReconcile.ts` |
| Readers | `lib/memberPayments.ts`, `app/api/admin/ledger/route.ts`, `lib/ledgerReconcileDetail.ts`, `components/admin/ledger/ReconcileSheet.tsx`, `components/admin/CommandCenter/PaymentsCard.tsx`, `components/UnpaidSessionsCard.tsx` |
| Tests | `__tests__/paid-amount.test.ts`, `__tests__/payments-assign-amount.test.ts`, the two component tests |
| Edit the bill after payments | `app/api/session/settle/route.ts` (DELETE, `clearSettlement`, POST), `lib/ledgerMirror.ts` (`overpaidEntry`, `mirrorUnsettle`, `mirrorUnpaid`), `lib/ledgerReconcile.ts`, `lib/ledgerView.ts`, `__tests__/money-audit-gaps.test.ts` GAP 2 |
