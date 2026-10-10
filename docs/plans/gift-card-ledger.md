# Gift cards: who redeemed what, and who may give them out

**Track:** ROADMAP North Star — admin cost-automation; `docs/plans/payments.md` Phase 2 (the ledger), of which store credit and gift cards were the first slice (shipped 2026-10-06).
**Status:** shipped 2026-10-09
**Review on:** 2026-11-07 — with the payments review: has Grant opened a card's record and found what he needed (who, when, how much, what is left), and has anyone other than an admin given a card out? If the per-card view was never opened, fold it back into the plain list.

## Problem

Grant, 2026-10-09: *"gift card should get detailed documentation on: Who
redeemed it, remaining balance and when and how much its used. Ability to
set who can give out gift cards."*

Today a card's record is a line: amount, note, last four, redeemed or not.
Who redeemed it is on the ledger entry only (`gift:<hash>`, by design — see
`GiftCardDoc`'s docblock), and once redeemed the card's value joins the
member's one pool of credit, so "how much of THIS card is left" is not a
question the data answers. And only an admin can mint one: a stringer or a
helper who wants to give a thank-you has to ask Grant.

## Kill criterion

By the review date, if no admin has opened a card's record, the per-card
detail is folded back into the list (keep the `redeemedBy` field, it costs
nothing). If no non-admin has minted a card, drop the `canGift` switch from
the roster sheet and leave the field as harmless data.

## Non-goals

- Partial redemption or a card that is itself an account. A card still
  redeems in one tap into the member's credit; the per-card "remaining" is
  an ATTRIBUTION over the member's credit history (oldest source first),
  not a second balance. Two balances for one pool of money would disagree
  the first time a refund landed.
- A gifter seeing WHO redeemed their card. The gifter handed the code to
  someone; the admin's record names them, the gifter's shows redeemed or not.
- Revoking a minted-but-unredeemed card. Not asked for; the admin can see
  it is unredeemed and simply not hand it out.
- Changing how a member redeems or spends credit.

<!-- Everything above is the gate for starting. Everything below is appended as
     the work proceeds. -->

## Decisions

- **"Remaining" is an attribution, not a balance.** `attributeCredit` in
  `lib/creditAttribution.ts` walks the redeemer's credit entries in time
  order and draws every spend (and every admin take-back) from the OLDEST
  source that still has something left; a refund gives its spend back to
  the sources it came from and marks those uses reversed. Beat storing a
  per-card balance on the card doc, which would be a second ledger that
  disagreed with the first the moment a refund or a void landed, and beat
  "last source first", which no one could check by hand against the entry
  list. The card's record is therefore a READING of the ledger — the same
  entries an admin sees under the member's credit, assigned.
- **`redeemedBy` is written on the card from now on, and an older card is
  resolved from its ledger entry.** The docblock's reason for not storing
  it (account deletion already removes the ledger) still holds for the
  OLD data; the new field exists so the admin's list is one read, and a
  deleted account leaves a card that says so rather than a record that is
  wrong. `giftCardRecords` does one credit read per redeemer, not per card.
- **`canGift` is a third switch on `Member`, exactly like `canString`.**
  Re-read fresh on every mint, never carried in the cookie. A gifter mints
  from Profile through `/api/giftcards`, which is the admin route with the
  admin check swapped for the switch and a per-person ceiling (10 a day)
  on top of the per-IP one, because every card is liability once redeemed.
  Beat a membership-level role (groups are not on, and `canString` is the
  precedent) and beat exposing the switch through `members/me` (its
  projection is canary-pinned and the stringer card already proves the
  pattern of asking a dedicated route).
- **A gifter sees redeemed-or-not; the admin sees who.** The gifter handed
  the code to a person and already knows who they meant it for; naming the
  redeemer to a non-admin would be a roster read through a side door.

## Shape

| Piece | Where |
|---|---|
| Attribution (pure) | `lib/creditAttribution.ts`, `__tests__/credit-attribution.test.ts` |
| `GiftCardDoc.redeemedBy`, `giftCardRecords`, `giftHashOf` | `lib/storeCredit.ts` |
| Admin list with records | `GET /api/admin/giftcards`; `components/admin/CommandCenter/GiftCardsCard.tsx` (tap a card) |
| The switch | `Member.canGift` (`lib/types.ts`), `PATCH /api/members`, `RosterPage` checkbox |
| The gifter's surface | `GET`/`POST /api/giftcards`; `components/GiveGiftSheet.tsx`; Profile → "Give a gift card" (`profile.gift.*`, `settings.giveGift`) |
| Tests | `__tests__/store-credit.test.ts` (record, legacy card, gifter) |
