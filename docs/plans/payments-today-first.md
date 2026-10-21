# Payments: today first, any session by date

**Track:** admin cost-automation (North Star pillar 3), the Payments card in the Command Center — alongside `docs/plans/payments.md`.
**Status:** in-flight
**Review on:** 2026-11-18 — after four Thursdays: does Grant reach an older session through the date picker, or does he still scroll for it somewhere else?

## Problem

Grant, 2026-10-20, with a screenshot of the card: "yo how can we show this in a
way prioritize today, date manuvering, and see outstandding day?"

The card opened on a grid of every session ever as equal chips — 35 of them,
about 40 tiles to read past before the money — and only four of them owed
anything. Anything older than the 24 sessions the history read covered said
"Past", because its payments were never counted, so an old debt could not be
seen at all.

## Kill criterion

If, a month in, Grant is still asking "which sessions still owe?" or finds an
owing session the picker did not mark, the dots are not doing the job and the
"Still owed from earlier" row he removed on the canvas comes back.

## Non-goals

- No change to how a payment is recorded, settled, covered or reconciled.
- No new money figure: every number on the card is one the card already had.
- Member-facing balances (Home) are untouched.

## Decisions

- **2026-10-21 — the canvas boards are the spec** (Admin page, "Payments ·
  today first" and "Payments · tap the date to pick a session"). Grant's
  comments on them shaped this:
  - "redundant" on the hero's date label: the stepper above already says it.
  - "remove" on the line under the date: the hero says how many have paid.
  - "Not this weeks info" / "remove" on a "Still owed from earlier" row: the
    card is this week only. Earlier debts are found in the picker instead —
    an amber dot on each owing session's day, and on the ‹ month arrow when an
    earlier month still owes.
  - "open a date picker instead" on the ⌄: a month calendar, not a list.
  - "get a receipt, or share a receipt": the button is "Receipt", because it
    opens the receipt, where sharing is one of two things to do with it.
- **The chip grid went, not a smaller grid.** Every alternative that kept
  every session on screen kept the problem; the stepper reaches the next one
  and the calendar reaches any.
- **Owing state for every session, not the last 24.** `GET
  /api/sessions/history?counts=1` answers counts only (no receipts, no
  recipient read) for up to 200 sessions, so the calendar can mark an old
  debt. The receipt-carrying read keeps its 24 cap.
- **Paid and covered became dimmed rows, not chips** — the board draws one
  list, owing first, so the eye reads straight down to who is left.

## Shape

| Piece | File |
| --- | --- |
| Session days, month grid, owing state (pure) | `lib/sessionCalendar.ts` |
| The calendar popover and its trigger | `components/admin/CommandCenter/SessionDatePicker.tsx` |
| Stepper, hero, rows | `components/admin/CommandCenter/PaymentsCard.tsx` |
| Counts for every session | `app/api/sessions/history/route.ts` (`counts=1`) |
| Styles | `.pay-*` in `app/globals.css` |
