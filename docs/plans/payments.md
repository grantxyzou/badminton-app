# Payments: the system knows who paid

**Track:** admin cost-automation (North Star pillar 3). Phase 1 moves no money: it reads the
notifications the admin already receives. Phase 3 (cards) WOULD be "payments processing", a locked
ROADMAP non-goal, and needs that block changed on purpose before it starts.
**Status:** in-flight
**Review on:** 2026-11-07 — of the e-transfers received since the flag went on, what share auto-matched, and is the "Needs a look" queue staying short?

## Problem

Grant, 2026-10-03: "Currently we have etransfer which is admin send to a whatsapp group that the session
costed X then everyone e-transfer me I get an email then manually goes to admin tick them off one by one."

The information the app needs already arrives — as an Interac email in the admin's Gmail. The app just
never sees it, so a person re-types it, one pill at a time, every week.

Also from the same message: late payers ("access if we want late payment penalization"), and money that
moves outside an e-transfer ("Bruce paid for my session for sat") having nowhere to be recorded.

## Kill criterion

Four weeks after the flag goes on: **at least 70% of received e-transfers auto-matched** (status
`matched`, `matchedBy: 'auto'`). Below that, the admin is still ticking most of them by hand — through a
new queue instead of the old pills — and the matcher (or the alias coverage it leans on) is the thing to
fix before anything in Phase 2 starts.

## Non-goals (this phase)

- Card payments, Stripe, Apple Pay. (Phase 3, and a ROADMAP change first.)
- A ledger, account credit, overpayment balances, gift cards. (Phase 2 / 4.)
- Money late fees. Late payment gets a soft hold, not a charge (decided below).
- Reading Gmail from the server. The admin's own Google account does the reading.

## Decisions

- **Apps Script in the admin's Gmail, not a Gmail API connection.** Reading Gmail needs the restricted
  `gmail.readonly` scope. On the OAuth client the app already uses for member sign-in that means Google
  verification and a security assessment, or a "Testing" app whose refresh token expires every 7 days — a
  matcher that silently stops weekly. A script runs as the admin, stores no token, costs nothing, and
  scales per club: each club's admin installs it with their own key.
- **The script forwards; the app parses.** The script sends the raw subject/body/headers. Interac's
  wording changes; a parser fix should be a deploy, not "please re-paste the script".
- **Anti-spoof is DKIM, read from Google's own `Authentication-Results`.** Anyone can mail the admin a
  forged `From: notify@payments.interac.ca`, and Gmail's `from:` search matches the header. Only a message
  whose topmost `Authentication-Results` (the one `mx.google.com` adds; anything below it was written by the
  sender) shows `dkim=pass` for an `interac.ca` domain can auto-match. Everything else waits for a person.
- **Never guess with money.** Auto-match only on an authenticated email, an unambiguous person, and an
  amount equal to one owed line, the oldest *k* lines, or the full balance. Over/under-payments, two
  candidate people, unknown senders → "Needs a look".
- **Candidates are what Home shows.** Sessions and finished stringing jobs together, from the same function
  `/api/players/unpaid` uses — a player who owes $12 + $30 sends $42.
- **`Player.paid` stays the truth every reader uses.** The match writes `paid` plus additive
  `paidAt` / `paidVia` / `paymentId`. No reader of `paid` changes.
- **Late payment: a soft hold, no fee.** A member with ≥ 2 unpaid settled sessions signs up onto the
  waitlist with a reason, until they settle. Reminders (push, no amount on the lock screen) are Phase 1b,
  because App Service has nothing that runs on a schedule; they need a GitHub Actions `schedule:` calling a
  keyed endpoint.

## Roadmap

**Phase 1b — reminders.** Push at settle +3 and +7 days, no amount in the body.

**Phase 2 — the ledger ("one cost system").** Append-only `ledgerEntries` (never upserted, like `events`):
`charge` (session share, stringing, late fee), `payment` (e-transfer, card, cash), `credit` (top-up, gift
card, overpayment), `transfer` (payer ≠ beneficiary — "Bruce paid Grant's Saturday"). Balance = Σ entries.
`Player.paid` and `StringingJob.paidAt` become projections written when allocations cover a charge; settle
auto-applies available credit. An overpayment stops being a "Needs a look" dead end and becomes credit.

**Phase 3 — cards** (needs the ROADMAP non-goal changed first). Stripe Checkout with Apple/Google Pay;
webhook → ledger `payment`. In the native app this is a real-world service, so App Store guideline
3.1.3(e) permits external payment — no in-app purchase. One club: a plain Stripe account. Many clubs:
Stripe Connect, so one club's money never lands in another's account.

**Phase 4 — store credit and gift cards.** A code redeems to a ledger `credit`; "Bruce gave Grant a
session" is a `transfer`. Apple Wallet pass (PassKit, Pass Type ID cert on the existing developer account)
showing the balance — last. Ontario: gift cards may not expire.

### Card cost analysis (for the Phase 3 decision)

$12 share, ~12 players × 50 sessions = 600 payments/yr (~$7,200). Stripe Canada 2.9% + $0.30; Stripe keeps
the fee on a refund; a dispute costs ~$15.

| Model | Player pays | Club nets | Fee / session | Fees/yr if everyone used cards | Carried by |
|---|---|---|---|---|---|
| E-transfer (today) | $12.00 | $12.00 | $0 | $0 | nobody |
| Per session, club absorbs | $12.00 | $11.35 | $0.65 (5.4%) | ~$389 | club |
| Per session, payer covers | $12.67 | $12.00 | $0.67 (5.6%) | ~$400 | player |
| $40 top-up, payer covers | ~$12.45 | $12.00 | $0.45 (3.7%) | ~$270 | player |
| $100 top-up, payer covers | ~$12.40 | $12.00 | $0.40 (3.3%) | ~$238 | player |

At a realistic 30% card share: absorbing costs the club ~$117/yr; top-ups cost card users ~$70/yr between
them. Top-ups also create a liability (unspent balance is owed back when someone leaves). Surcharging is
legal in Canada with disclosure, except Quebec. Leaning: e-transfer stays the free default; cards as
top-ups ≥ $40 with the payer covering the fee.

## Shape

| Piece | File |
|---|---|
| Interac email → `{sender, amount, memo, authenticated}` | `lib/etransferParse.ts` |
| Who and which lines (pure) | `lib/etransferMatch.ts` |
| What a person owes (shared with `/api/players/unpaid`) | `lib/owedBalance.ts` |
| Ingest, key, assign, mark paid | `lib/paymentsInbox.ts` |
| Script → app | `POST /api/payments/etransfer` |
| Admin queue, assign, key | `/api/admin/payments`, `/api/admin/payments/assign`, `/api/admin/payments/key` |
| "I've sent it" | `POST /api/payments/self-report` |
| The script admins paste | `public/payments/apps-script.gs` (served at `/bpm/payments/apps-script.gs`, so the setup sheet can copy it) |
