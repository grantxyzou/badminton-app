# Card payments — a sandbox prototype

**Track:** admin cost-automation (North Star pillar 3) — `docs/plans/payments.md` Phase 3, **ahead of its gate**. "Card payments processing" is still a locked ROADMAP non-goal; this prototype does NOT change that. It exists so the decision to lift it can be made looking at something that works against a Stripe sandbox, rather than at a paragraph.
**Status:** intent (prototype on a branch, flag OFF everywhere, nothing deployed)
**Review on:** 2027-01-31 — lift the ROADMAP non-goal and turn this into a real rollout (`plannedRemoval` = ship + 2 weeks), or delete the routes, the flag and the `stripe` dependency?

## Problem

Grant, 2026-10-03 (`docs/plans/payments.md`): "Currently we have etransfer which is admin send to a whatsapp group that the session costed X then everyone e-transfer me I get an email then manually goes to admin tick them off one by one." The inbox fixed the ticking; it did not give a member a way to pay that is not an e-transfer. No member has asked for cards out loud yet — this is the organiser's ask (2026-11-12: "Stripe products I need: Payments, Invoicing, Tax, Billing, Terminal"), which is a weaker reason than a reported problem.

## Kill criterion

If, once a club turns it on, fewer than 20% of that club's settled lines over four weeks are paid by card, the fee (about 5.5% on a $12 share, `payments.md`'s cost table) is buying nothing e-transfer did not already do, and this goes.

## Non-goals

- Invoicing, Billing (season passes, an organiser SaaS fee), Stripe Tax collection and Terminal. The Stripe planner covered all five; this slice is card pay for owed SETTLED session shares only. Tax: threshold monitoring in the Stripe Dashboard, no code.
- Stringing jobs. A job's payment is keyed on `paidAt`, not a payment id, and needs its own path.
- Card top-ups into store credit (`payments.md`'s cost table leans that way for fees; it is the next decision, not this one).
- The native shell. Checkout opens by navigating the WebView; whether Apple Pay shows there, and whether it should open in the system browser sheet like OAuth, is unverified.

## Decisions

- **2026-11-12 — Stripe Connect, a SaaS platform with direct charges** (the Stripe implementation planner's path, `use_case: add_and_monetize_payments_connect`). Each club is its own Stripe account (Accounts v2, `dashboard: 'full'`, Stripe collects the fees and owns the losses), so a member's money lands with the club and never with BPM or another club — what `payments.md` Phase 3 said ("Many clubs: Stripe Connect"). Beat: one platform account (BPM would hold every club's money) and destination charges (BPM would be merchant of record and carry the disputes).
- **Hosted Checkout, not Elements.** The planner's default; Apple/Google Pay and 3DS come with it, and no card field touches our page or our CSP.
- **Settled lines only**, exactly as e-transfer auto-match and "pay with credit" (`settledLines`): an estimate can move under a payment.
- **A line that cannot be applied when the money lands is REFUNDED to the card**, never kept as credit nobody asked for — "never guess with money". Keyed `bpm-unapplied:<session>` so a redelivery cannot refund twice.
- **The signed envelope decides the club**: `event.account` must equal the club's stored account. Metadata names a club; only the signature says whose money it is.
- **Ids from the Checkout Session**: `Player.paymentId` and the ledger's `payment:<row>:<cs id>`, so a redelivered webhook collides instead of double-writing.
- **No new container** (the account is at Cosmos's 25-container cap): the club's account is a `kind: 'cardPay'` doc in `clubSettings`.

## Shape

| Piece | File |
|---|---|
| Client, club account, checkout, webhook apply | `lib/cardPay.ts` |
| Organiser connect + status (organiser only) | `app/api/admin/card-pay/route.ts` |
| Member "Pay by card" | `app/api/payments/card/checkout/route.ts` |
| Stripe Connect webhook | `app/api/payments/card/webhook/route.ts` |
| Home button (`cardPay` on the balance) | `components/UnpaidSessionsCard.tsx`, `app/api/players/unpaid/route.ts` |
| Organiser card, on the E-transfers page | `components/admin/CommandCenter/CardPayCard.tsx` |
| `paidVia: 'card'`, ledger id + "Card" in the money view | `lib/types.ts`, `lib/ledgerMirror.ts`, `lib/ledgerView.ts`, `components/admin/LedgerPage.tsx` |
| Flag | `NEXT_PUBLIC_FLAG_CARD_PAY` (`lib/flags.ts`, `'false'` in both workflows) |
| Tests | `__tests__/group-card-pay.test.ts` |

Server settings it needs (App Settings, never committed): `STRIPE_SECRET_KEY` and `STRIPE_WEBHOOK_SECRET` (a Connect endpoint at `/bpm/api/payments/card/webhook` listening for `checkout.session.completed` and `checkout.session.async_payment_succeeded`).
