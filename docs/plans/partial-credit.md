# Credit that does not cover the whole bill

**Track:** payments (`docs/plans/payments.md`, store credit), with `docs/plans/paid-amount.md`: a line may be part-paid.
**Status:** in-flight
**Review on:** 2027-01-15 — Has a member used credit short of a bill, and did the Ledger check stay clean for those lines?

## Problem

Grant, 2026-11-21: "Can we let the player to use credits even if the amount does not have enough to pay the entire bill?" Then: "go ahead with partial credit".

Until now credit paid a line only in full. A member with $10 of credit who owed $15 saw no "Pay with credit" at all, and the $10 sat unused while they paid the whole $15 another way.

## Kill criterion

If a part-credit line ever leaves the Ledger check with a mismatch it cannot explain, or credit is taken that no line received and no refund returned, stop offering part-payments (credit goes back to whole lines only) until the cause is found.

## Non-goals

- Part-paying a stringing job. A job has no amount received of its own (`docs/plans/paid-amount.md`, non-goals); credit pays a job whole or not at all.
- Paying an unsettled estimate. Credit stays on FROZEN lines only, as before.
- A member choosing how much credit to use. It uses what it can, oldest first.

## Decisions

- **Whole lines first, then one part.** "Pay with credit" first pays every frozen line the credit covers in full, oldest first, as before. Whatever is left goes onto the oldest frozen SESSION line still owing, as a part-payment (`paidAmount`, "paid $10 of $15"); the rest is paid by e-transfer or card like any part-paid line. Whole lines first leaves fewer lines open: $12 of credit against $15 (older) and $12 pays the $12, not $12 of the $15.
- **Every credit payment is tracked on its own.** A line can now hold several credit payments (part this week, the rest next). The row records each spend it received (`Player.creditSpends`, additive, the `spend:` ids), in the same write that records the money. A spend is "landed" when the row lists it, or when the mirror wrote a live credit payment at the spend's time. Before, any credit taken for a line meant "a payment in progress", which would have blocked a second part forever.
- **Finishing a crashed payment never moves more than is missing.** `refundStaleSpends` works out the credit still taken for the line and not shown as landed, and finishes or refunds at most that, spend by spend. A spend whose money no longer fits the line (paid another way, or the bill lowered) is refunded, never forced on.
- **Un-ticking a line credit helped pay goes through the review**, as a credit payment always has (`docs/plans/money-audit.md`, gap 6): a row that lists a credit spend, paid in full or not, answers `paid_with_credit`; returning the credit clears the row's payments and gives back the net credit taken for it.

- **Security review, 2026-11-21 (the `security-reviewer` agent, before the PR), three findings, all fixed in this change:**
  1. A card refund or chargeback on a night credit part-paid cleared the row and voided every payment on it, the credit's too, so the credit stayed spent on a line that owed it all again. Both un-pay paths now give the credit back (`giveBackRowCredit` in `lib/cardPay.ts` → `returnRowCredit`), and a won chargeback records only the card's own part (`paidAmount` + the line, paid only once that covers the bill).
  2. "Return the credit" numbered its refund by how many refunds the line had, which could collide with a refund already paired to a spend; the 409 was swallowed and the next balance read re-applied the credit. Every return is now per spend under the spend's own pair id (`returnRowCredit`).
  3. Returning the credit while a "Use credit" was mid-way refunded the in-flight spend too. A return now gives back only the spends the row had received (its `creditSpends`, or every spend for a line paid in full that keeps no list); one mid-way lands or returns itself.
- **A credit payment's ledger entry is keyed on its spend** (`paymentId` = the spend id, `payment:<row>:<spend id>`), not its time: two parts could fall in one millisecond and the second entry was swallowed as a duplicate. A credit row from before keeps its time key.
- **Known and left:** purging a row credit part-paid voids its charge and keeps the credit payment, so that credit is not returned (an e-transfer part on a purged row has the same shape already). A purge of a row someone has part-paid is rare and is an organiser's deliberate act.

## Shape

| Piece | File |
|---|---|
| Credit onto a row, whole or part; stale spends; the two passes | `lib/storeCredit.ts` |
| The field | `lib/types.ts` (`Player.creditSpends`) |
| Un-tick guard, return the credit | `app/api/players/route.ts`, `lib/creditReview.ts` |
| What the button offers | `components/profile/useBalance.ts` (`creditWouldPay`), `components/UnpaidSessionsCard.tsx`, `components/profile/AccountBalancePage.tsx` |
| Tests | `__tests__/partial-credit.test.ts` |
