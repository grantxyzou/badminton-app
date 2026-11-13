# Organiser fee

**Track:** admin cost-automation (North Star pillar 3) — rides with `docs/plans/card-pay-prototype.md`, whose card fee it pays for.
**Status:** in-flight
**Review on:** 2027-02-15 — for every club that set a fee: did its sign-ups per session over the four weeks after the fee hold within 15% of the four weeks before, and did any member say the price was unfair?

## Problem

Grant, 2026-11-12, deciding who pays the card fee once card payments go live: "What if we charge $1-$2 dollar extra and work it into cost of my labour". Canada caps a card surcharge at 2.4% on credit cards only (about 29¢ on a $12 share, against a ~65¢ fee), so the fee cannot honestly be passed to card payers alone. A price every player pays, whatever they pay with, is not a surcharge: it is the club's price, and it also pays for the organiser's work, which the at-cost split never did.

## Kill criterion

A club's sign-ups per session over the four weeks after it sets a fee fall more than 15% below the four weeks before (read from the sessions' active counts), or a member says the fee is unfair: then the default stays $0 and the fee is reconsidered with that club, not raised.

## Non-goals

- **A fee only card payers pay.** That is a surcharge whatever it is called (capped, credit only, networks notified). This fee is the same for e-transfer, credit and card.
- A fee on a session with no recorded cost. An unpriced or cancelled night bills nobody, fee included.
- Changing a bill that already exists. The fee is copied onto a session when it is created; a setting change starts with the next session, and a settled bill stays frozen.
- A percentage fee, a fee per court, or different fees for members and drop-ins.

## Decisions

- **2026-11-12 — A club setting, `ClubRun.organiserFee`, default $0** (Grant: "adjustable start at $0"). Absent reads as 0, so no club's bill changes until an organiser types a number. It is not part of a style: choosing "First come, first served" or "Members first" keeps the club's fee, and any fee reads as that style, the same way guests do.
- **Copied onto the session at advance (`Session.organiserFee`)**, like the members-first window, so changing the setting never moves a bill already being split — the "an estimate can move under a payment" rule.
- **Added inside `costSplit`**, the one per-person calculator, so settle, Home's balance, the live estimate, receipts, e-transfer matching and the ledger all carry it without each learning about it. `costPerPerson` INCLUDES the fee; `organiserFee` is reported beside it so a receipt can show it as its own line.
- **An absorb cover forgives the fee too** (the organiser is the one absorbing), and a resplit cover leaves the fee alone (the fee is per player who pays, not re-spread).
- **The receipt shows it**: Split N ways $X each → Organiser fee $Y each → Per person $Z. Players see what is cost and what is the organiser's.

## Shape

| Piece | File |
|---|---|
| The setting (validation, style rules) | `lib/clubRun.ts` |
| Copied onto a new session | `app/api/session/advance/route.ts` |
| Added to each share | `lib/sessionCost.ts` (`costSplit`) |
| Frozen at settle | `app/api/session/settle/route.ts` → `SettledSnapshot.organiserFee` |
| Receipt line | `lib/buildReceiptInput.ts`, `lib/receiptTemplate.ts` |
| Organiser's input | `components/admin/CommandCenter/ClubRunPage.tsx` |
| Tests | `__tests__/organiser-fee.test.ts` |
