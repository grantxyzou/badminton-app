# Ways to pay, in order: credit, e-transfer, card

**Track:** payments (`docs/plans/payments.md`): the member's side of paying, after `docs/plans/etransfer-copy.md` and `docs/plans/card-surcharge.md`.
**Status:** in-flight
**Review on:** 2027-01-15 — Do more e-transfers arrive with the app's memo, and does Needs a look name the right member for them more often?

## Problem

Grant, 2026-11-21: "For the payment buttons: Which one are we prioritizing? Are do we want e-transfers or credit card?" Then, 2026-11-22, the order he wants:

> 1. Pay with credit (if they have credits)
> 2. Interac e-transfer (button with dropdown)
>    1. Expanded: Etransfer info to include for copy and paste: 1. email 2. Memo, tailored to each user account
> 3. Credit card (not sure about the naming here)

Today Home's balance card shows the e-transfer rows open at the top, then credit, then the card, then "I've sent it". E-transfer costs the club nothing and a card costs a fee, but an open block of copy rows above every button made the card look like the only button.

## Kill criterion

If, by the review date, the share of nights paid by card has grown while e-transfers fell (the ledger's Collected by), the closed dropdown is hiding the free way to pay: open it by default again.

## Non-goals

- Making a memo proof of who paid. A name in the memo stays a weak clue (`.claude/rules/security.md`, F18): it names who to suggest in Needs a look and never pays a line on its own.
- A per-member reference code. A code only that member knows would be stronger proof than a name, but it changes how payments are matched and is its own decision.
- The Interac logo. It waits for the club's trademark licence and Interac's own file.

## Decisions

- **The order is credit, e-transfer, card.** Credit first, and only while it can pay something (as before). E-transfer second, as one button that opens to the copy rows and "I've sent it". The card last.
- **The e-transfer button starts closed.** Open, its rows filled the card above the other ways to pay. The chevron turns (`.motion-chevron`) and the rows open with `<Collapse>`, as every expanding row in the app does.
- **No amount row.** Grant, after seeing it: "we dont need the cost copy and past option". The total is the card's headline figure right above the buttons, so the dropdown copies only what a member cannot read off the screen: the address and the memo.
- **"I've sent it" moves inside the e-transfer dropdown.** It only means something after an e-transfer, and it sat under the card button.
- **The card button keeps "Pay by card"**, with the four card marks beside it. "Credit card" would sit under "Pay with credit" (store credit) and read as the same thing, and debit cards pay too, with no fee.
- **The memo is the club's own memo template filled in for this member**: the one the organiser edits beside the e-transfer address (`ETransferRecipient.memo`) and the receipts already print, `{club} {date} - {name}` by default, for example `BPM Core Oct 1, Oct 8 - Lin`. It is written on the server by `memberMemo` in `lib/receiptTemplate.ts`, beside the receipt's own `fmtMemo`, so the two cannot drift, and returned with the address, only to someone who owes, on their own balance (`GET /api/players/unpaid`). The template itself stays on the server. With the default template the name is last and is the member's name in this club, so `memoRosterName` reads it back out of the email (`__tests__/etransfer-memo.test.ts` holds the two together). Dates are the session nights owed, oldest first, at most three and then "+N"; stringing reads as "stringing".
- **This reverses a non-goal of `docs/plans/etransfer-copy.md`** ("Copying a memo"). That held because a memo cannot make a payment match on its own, and it still cannot. Grant asked for it anyway, and it still helps: a member who pays from a partner's account is suggested by the memo, and the organiser sees whose nights the money is for.

## Shape

| Piece | File |
|---|---|
| The memo | `lib/receiptTemplate.ts` (`memberMemo`), `lib/payTo.ts` (the template), `app/api/players/unpaid/route.ts` (`memo`) |
| The copy rows (address, memo) | `components/payments/EtransferCopy.tsx` |
| The order and the dropdown | `components/UnpaidSessionsCard.tsx`, `components/profile/AccountBalancePage.tsx` |
| Tests | `__tests__/etransfer-memo.test.ts`, `__tests__/components/UnpaidSessionsCard.test.tsx`, `__tests__/components/EtransferCopy.test.tsx` |
