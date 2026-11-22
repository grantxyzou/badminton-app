# E-transfer: tap to copy the address and the amount

**Track:** payments (`docs/plans/payments.md`): the e-transfer half, which costs the club nothing, made as quick as the card button beside it.
**Status:** in-flight
**Review on:** 2027-01-15 — Did the share of lines paid by e-transfer hold or grow against card once the card fee went on?

## Problem

Grant, 2026-11-20: "Can tapping on e-transfer take player to their e-transfer set up?" No: Interac publishes no link that opens a bank's send screen, and each bank's app is its own, with no public way in. Asked what to do instead, he chose the option of copying with one tap ("1. yes").

Today Home's balance card prints "E-transfer to {email}" as plain text, and the Balance page's sheet copies the email only. A member types the address and the amount into their bank by hand, which is slow and is where a typo sends money nowhere.

## Kill criterion

If, by the review date, e-transfers matched to the wrong line or sent to a wrong address have not dropped (the inbox's review rows for an amount that matches nothing), the copy is not what slowed people down; leave it, it costs nothing to keep, but stop treating it as the answer.

## Non-goals

- Opening a bank's app. There is no shared link, and a per-bank list would break whenever a bank changed its app.
- Copying a memo. Since the 2026-11-17 security scan, a name in the memo is never proof of who paid (`.claude/rules/security.md`, F18), so it would not make a payment match. (Reversed 2026-11-22 at Grant's request: `docs/plans/payment-order.md`.)
- Interac "Request money": it needs a business Interac service and per-request fees.

## Decisions

- **One component for both places** (`components/payments/EtransferCopy.tsx`): Home's balance card and the Balance page's e-transfer sheet showed the address two ways and copied it one way; now both show the same two rows, the address (with the recipient's name under it, which the bank shows back) and the amount, each a button that copies it.
- **The amount copies as a plain number with two decimals** (`27.00`): banks' amount fields refuse a `$`, and some refuse a thousands separator.
- **A copy that fails says so and leaves the text selectable**: the clipboard can be refused (an old WebView, a permission), and press-and-hold still works.

## Shape

| Piece | File |
|---|---|
| The two copy rows | `components/payments/EtransferCopy.tsx`, `.copy-row` in `app/globals.css` |
| Home's balance card | `components/UnpaidSessionsCard.tsx` |
| The Balance page's sheet | `components/profile/AccountBalancePage.tsx` |
| Copy | `etransferCopy` in `messages/en.json` and `messages/zh-CN.json` |
| Tests | `__tests__/components/EtransferCopy.test.tsx` |
