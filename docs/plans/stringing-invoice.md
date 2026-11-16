# Send an invoice for a restring

**Track:** North Star pillar 4 (equipment service), with pillar 3 (admin cost-automation): the money half of a restring, beside `docs/plans/card-pay-prototype.md`.
**Status:** in-flight (`NEXT_PUBLIC_FLAG_STRINGING_INVOICE` ON in production from 2026-11-16; Grant: "turn on invoices")
**Review on:** 2027-01-15 — for invoiced restrings over the first four weeks with the flag on: how many days from "Send invoice" to paid (median), how many needed the day-3 or day-7 reminder, and did any invoiced job reach the reconcile as a mismatch?

## Problem

Grant, 2026-11-15: "For stringing jobs can we have sent invoice feature." When asked which kind (an in-app bill, a Stripe invoice, or a shareable picture): "Can we combine the 3 options n ideate", and the stringer should tap it ("Stringer taps it"). On who may send: "Stringer, organiser". On reminders he asked whether they go to the player or the stringer; the answer below is both, in sequence.

Before this, a priced job became money owed the moment it was marked Ready, with no step where the stringer says "here is your bill". The player learnt the figure from the Balance card or the ready email; a walk-up without an email learnt it from nothing unless the stringer shared the receipt picture by hand.

## Kill criterion

If, over the first four weeks with the flag on, the median invoiced restring takes longer to be paid than restrings did in the four weeks before (paid `paidAt` − first `ready`), the explicit step is costing money rather than collecting it: switch the flag off (new jobs go back to billing at Ready; invoiced jobs keep their invoices).

## Non-goals

- **Stripe Invoicing.** 0.4% per paid invoice on top of card fees, and it reaches only people with an email on file. The pay link opens the Stripe Checkout that card pay already uses, and Stripe's own receipt after payment is the formal document.
- **A pay link for walk-ups without an account.** Phase 2: it needs a tokened public checkout route. Phase 1 gives a walk-up the invoice by email or as a shared picture.
- **Invoices for sessions.** Sessions already have "Send the bill".
- **Changing what an invoice charges.** The Balance line is the job's price, as before; the invoice records the figure it was sent at so a later change is visible ("Price changed since invoiced · Resend").

## Decisions

- **Turned on 2026-11-16** (Grant: "turn on invoices"), the day after card payments went live, so an invoiced restring can be paid by card from the start. Jobs already on the bench that day keep billing at Ready; only jobs made from then on wait for an invoice.

- **Paying before the invoice still books the charge** (2026-11-16, found by the Ledger check: "Grant · stringing · ledger −$40 · app $0"). A job paid at pickup without an invoice got a payment and no charge in the ledger, because the charge waited on the invoice. The ledger now holds a charge for every paid job (`ledgerHoldsCharge`), and the mirror writes a missing one whenever the job is next touched. What a player OWES is unchanged: an un-invoiced job still owes nothing.
- **Billing starts at the tap, not at Ready** (Grant: "Stringer taps it"), but only for jobs made while the flag is on. `StringingJob.billOn: 'invoice'` is stamped at creation; a job without it (every job before the flag, and every job while it is off) bills at Ready exactly as before, so nobody's balance changes on deploy and turning the flag off strands nobody. One rule, `invoiceGateOpen` in `lib/stringingBilling.ts`, is read by every place that decides "is this owed" — `isBillable`, the ledger mirror's `billableShaped` and the backfill's `jobEntries` — so the Balance card, the reconcile and the ledger cannot disagree.
- **A finished, priced, unpaid job that is not yet invoiced still keeps the club's stringing switched on** (`isOpenStringingJob`): it is money the club has not asked for yet, not money nobody owes.
- **Who sends: an organiser or admin, or the stringer the job is assigned to** (Grant: "Stringer, organiser"). A stringer who is not an admin still never sees prices on the bench; the invoice is the one place they see a figure, and only for their own finished job. The route re-checks `canStringIn` for this club and `job.stringerId`, like the status write.
- **Reminders go to both, in sequence** (Grant asked "player or stringer?"): day 3 after sending, one push to the player ("Your restring bill is still open", no amount, the lock-screen rule); day 7, one push to whoever sent it ("J-0006 for Lin is still unpaid"), so they can ask in person. Each stamped on the invoice under the job's etag before the send, like the request nudge, so neither ever goes twice. The hourly tick runs them.
- **The invoice number is the job number** (`J-0006` → `INV-0006`): one per job, already unique per club, nothing new to count.

## Shape

| Piece | File |
|---|---|
| The rule: invoiced or legacy, then priced, finished, unpaid | `lib/stringingBilling.ts` |
| The fields (`billOn`, `invoice`) | `lib/types.ts` |
| Send / resend | `app/api/stringing/jobs/[id]/invoice/route.ts`, `lib/stringingInvoice.ts` |
| Push and email | `lib/stringingInvoice.ts` |
| Reminders | `lib/stringingInvoiceRemind.ts`, `lib/tick.ts` |
| Bench and stringer card | `components/stringing/StringingInvoiceSheet.tsx` |
