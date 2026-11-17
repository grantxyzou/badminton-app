# A card fee on credit cards (surcharge)

**Track:** admin cost-automation (North Star pillar 3), beside `docs/plans/card-pay-prototype.md`: the club stops absorbing Stripe's fee on every card payment.
**Status:** in-flight
**Review on:** 2027-01-15 — With the fee on, did card payments drop against e-transfers (people avoiding the fee), and did any surcharge refund or dispute need a person?

## Problem

Grant, 2026-11-17: "give me the ability to charge the stripe fee on per transaction, it should be a toggle I turn on off … when on fee [Stripe] charge". Today Stripe's fee (about 2.9% + 30¢ in Canada) comes out of every card payment the club takes, and the money page says "Card · before Stripe's fee" because the club receives less than members paid.

Asked how, given the rules below, he chose the rule-following version: "Rule-following 2.4%".

## The rules this has to follow (Canada)

- A fee for paying by card is a **surcharge**: at most **2.4%**, and never more than the club's own cost of acceptance (Stripe's docs list Canada as "Credit cards only, 2.4%").
- **Credit cards only**: never on debit or prepaid. So the card type has to be known BEFORE the charge, which Stripe's hosted Checkout cannot do; Stripe's surcharge support is on PaymentIntents (API `2026-03-25.preview`), which means a card form inside the app.
- **Shown before paying**, as its own amount, with a way to pay another way instead; **shown on the receipt** (Stripe's receipt does it).
- **Refunds return the fee**: in full on a full refund, prorated on a partial one.
- **Tell Mastercard (and Stripe) before turning it on.** Quebec bans it; BPM Core is in BC.

Sources: Stripe, "Collect surcharges" (docs.stripe.com/payments/cards/surcharge); FCAC, "Merchant surcharges…" (canada.ca); Mastercard Canada merchant surcharge rules.

## Kill criterion

If, within four weeks of turning it on, card payments fall to under half their share before (members routing around the fee to e-transfer), or a single surcharge is refused by Stripe or the networks, turn it off: the fee is costing more trust than it saves.

## Non-goals

- Passing on Stripe's fee in full. Above 2.4% is not allowed.
- Any fee on debit or prepaid cards, or on e-transfers.
- Charging the fee to members of a club in Quebec (there is no per-club province yet; a club there must leave it off).
- Recording the fee in the ledger. It offsets Stripe's fee, which the ledger does not record either; the money view's card figure stays "before Stripe's fee". The fee is on Stripe's records (`amount_details.surcharge`) and the PaymentIntent's `bpm_surcharge` metadata.

## Decisions

- **2026-11-17 — An in-app card form, only while the fee is on.** Hosted Checkout cannot see the card type before charging, and Stripe's surcharge support is PaymentIntents-only. Fee off, "Pay by card" is the hosted Checkout exactly as before; fee on, it opens `CardPaySheet`: Stripe's card Element (an iframe on the club's account, so the number never touches BPM), then a quote, then Pay. Beat: a fee on every card through Checkout (illegal on debit), and building the form for every payment (a new surface for the club that leaves the fee off).
- **The server decides the fee, twice.** `quoteCardPayment` creates the PaymentIntent with the card attached and `amount_details.surcharge.enforce_validation: 'enabled'`, reads Stripe's verdict (`status: 'available'`, `maximum_amount`), and writes the fee with `paymentIntents.update` — credit only, `floor(base × bps / 10000)`, never above Stripe's ceiling. `confirmCardPayment` confirms THAT intent; the browser never sends an amount. The webhook checks again: `lines + fee` must equal the charge and the fee may not exceed 2.4% of the lines (`maxAllowedSurcharge`), or the payment is a `card_amount_mismatch` review row.
- **The webhook does not depend on the preview API.** Its events arrive in the webhook's own API version, which has no surcharge fields, so the fee rides on the intent's metadata (`bpm_surcharge`) and the flow on `bpm_flow: 'surcharge'`; `applyPaidIntent` acts only on those, so a Checkout's own `payment_intent.succeeded` is ignored and never double-applies.
- **Refunds return the prorated fee** (the card networks' rule). An unapplied line is refunded with its share of the fee (`feeShareOf`); a refund made in the Dashboard is converted to the lines' part (`linesPartOfRefund`) before it is matched to a row, ±1 cent for the rounding.
- **A chargeback reads the fee the same way** (merged beside #976's disputes). `cardSourceOf` in `lib/cardPay.ts` is the one answer to "which payment was this": a Checkout, or the card form's PaymentIntent with its fee. A dispute converts its amount to the lines' part as a refund does, so a disputed $27.64 un-pays both lines and a disputed $15.35 un-pays the $15 one.
- **Turning it on needs the organiser's word** that they told Mastercard and Stripe (`acknowledgedAt` / `acknowledgedBy`, kept across off and on), a rate of 1–240 basis points (default 240), and `STRIPE_PUBLISHABLE_KEY` in App Settings — without the key the switch is disabled and says so. Organiser-only, under the settings doc's etag.
- **Members see it before they tap**: a line under "Pay by card" ("Credit cards add 2.4%. Debit cards pay no fee."), the rate again at the top of the form, the fee as its own row with the total before Pay, and "Rather not pay a card fee? Close this and pay by e-transfer." — the alternative the rules require.

## Shape

| Piece | File |
|---|---|
| The arithmetic (pure) | `lib/surchargeMath.ts` |
| Setting, form start, quote, confirm | `lib/cardSurcharge.ts` |
| Paid intent, fee check, prorated refunds | `lib/cardPay.ts` (`applyPaidIntent`, `applyPaidSource`, `applyRefund`) |
| Member form steps (`start` / `quote` / `confirm`) | `app/api/payments/card/form/route.ts` |
| Organiser switch (`PATCH { surcharge }`) | `app/api/admin/card-pay/route.ts` |
| Webhook (`payment_intent.succeeded`) | `app/api/payments/card/webhook/route.ts` |
| Home note + sheet | `components/UnpaidSessionsCard.tsx`, `components/payments/CardPaySheet.tsx`, `app/api/players/unpaid/route.ts` (`cardFee`) |
| Organiser card | `components/admin/CommandCenter/CardPayCard.tsx` |
| Stripe.js allowed in | `lib/csp.ts` (script, frame, connect) |
| Tests | `__tests__/group-card-surcharge.test.ts`, `__tests__/surcharge-math.test.ts`, `__tests__/components/CardPaySheet.test.tsx`, `__tests__/components/CardPayCard.fee.test.tsx` |

Before turning it on: `STRIPE_PUBLISHABLE_KEY` (the platform's live `pk_live_…`) in App Settings; `payment_intent.succeeded` added to the Connect webhook destination; the restricted key's Payment Intents raised to Write and Payment Methods at least Read; Mastercard and Stripe told.
