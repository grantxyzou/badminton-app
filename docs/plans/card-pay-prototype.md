# Card payments

**Track:** admin cost-automation (North Star pillar 3) — `docs/plans/payments.md` Phase 3. Began as a sandbox prototype ahead of its gate; the ROADMAP non-goal was lifted on purpose on 2026-11-12 (Decisions).
**Status:** in-flight (built and proven against the Stripe sandbox; flag OFF in production until the live keys are in Azure)
**Review on:** 2027-01-15 — for each club taking cards, over its first four weeks: what share of its settled lines were paid by card (kill criterion: under 20%), and did any card payment need a person to fix it?

## Problem

Grant, 2026-10-03 (`docs/plans/payments.md`): "Currently we have etransfer which is admin send to a whatsapp group that the session costed X then everyone e-transfer me I get an email then manually goes to admin tick them off one by one." The inbox fixed the ticking; it did not give a member a way to pay that is not an e-transfer. No member has asked for cards out loud yet — this is the organiser's ask (2026-11-12: "Stripe products I need: Payments, Invoicing, Tax, Billing, Terminal"), which is a weaker reason than a reported problem.

## Kill criterion

If, once a club turns it on, fewer than 20% of that club's settled lines over four weeks are paid by card, the fee (about 5.5% on a $12 share, `payments.md`'s cost table) is buying nothing e-transfer did not already do, and this goes.

## Non-goals

- Invoicing, Billing (season passes, an organiser SaaS fee), Stripe Tax collection and Terminal. The Stripe planner covered all five; this slice is card pay for what a member owes: SETTLED session shares and, since 2026-11-13, finished priced stringing jobs (Decisions). Tax: threshold monitoring in the Stripe Dashboard, no code.
- Card top-ups into store credit (`payments.md`'s cost table leans that way for fees; it is the next decision, not this one).
- The native shell. Checkout opens by navigating the WebView; whether Apple Pay shows there, and whether it should open in the system browser sheet like OAuth, is unverified.

## Decisions

- **2026-11-13 — Stringing jobs are paid by card too** (Grant: "I also use stripe to charge stringing services", then "Both" — describe it for Stripe's review AND build it). A finished, priced, unpaid job is a line in the same Checkout as the session shares (`stringing:<job>:<memberId>:<cents>` in the metadata), into the same club account: "Stringers string. Organisers handle the money." The webhook marks it paid only while it is still this member's, billable, at exactly the price charged. The ledger keeps keying a job's payment on `paidAt` (`stringingPaymentEntry`, every via), so the new additive `StringingJob.cardPaymentId` is what tells a redelivery the job is already paid by this Checkout, and `refundedPaymentId` does for a refund what it does on a session row.

- **2026-11-12 — Lifted** (Grant: "lift it"), after the live sandbox run and the screens were seen. The ROADMAP non-goal is struck, the fee question is answered by the organiser fee (`docs/plans/organiser-fee.md`; a card-only fee would be a surcharge, capped at 2.4% in Canada), and going live is: live Connect platform setup + Accounts v2, a live restricted key and a Connect webhook in Azure App Settings, the flag on, then the organiser pays one of their own shares by card on the web and in the iPhone app before telling members. Two things were added for live: the Privacy and Terms pages name Stripe, and a refund made in the Stripe Dashboard reaches the app (`charge.refunded`, below).
- **2026-11-12 — A refund made in Stripe un-pays the row, only when the amount says which.** The webhook takes `charge.refunded` from the club's account, finds the Checkout Session behind the charge, and leaves out refunds the app made itself (`metadata.bpm_reason`). Then: refunded to the full amount still applied → every row it paid goes back to unpaid; refunded to exactly one paid row's amount, and only one → that row; anything else → logged for a person and nothing changes. The same "never guess with money" rule as e-transfer matching.

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
| Visa / Mastercard / Amex acceptance marks on the button | `public/brand/cards/` — from Aaron Fagan's svg-credit-card-payment-icons (flat-rounded), Apache-2.0, its LICENSE beside them; copied as SVG text, not a dependency |
| `paidVia: 'card'`, ledger id + "Card" in the money view | `lib/types.ts`, `lib/ledgerMirror.ts`, `lib/ledgerView.ts`, `components/admin/LedgerPage.tsx` |
| Flag | `NEXT_PUBLIC_FLAG_CARD_PAY` (`lib/flags.ts`, `'false'` in both workflows) |
| Tests | `__tests__/group-card-pay.test.ts` |

Server settings it needs (App Settings, never committed): `STRIPE_SECRET_KEY` (a live restricted key: Accounts, Account Links, Checkout Sessions and Charges and Refunds as Write; Payment Intents as Read) and `STRIPE_WEBHOOK_SECRET` (a webhook for **events on connected accounts** at `https://bpm.grantzou.com/bpm/api/payments/card/webhook`, listening for `checkout.session.completed`, `checkout.session.async_payment_succeeded` and `charge.refunded`). The fast off switch is deleting `STRIPE_SECRET_KEY`: every card route answers 404 from the next restart, with no rebuild.
