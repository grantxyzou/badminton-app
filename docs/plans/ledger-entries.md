# Ledger entries: the ledger as a statement

**Track:** admin cost-automation (North Star pillar 3) — `docs/plans/payments.md` Phase 2 (the ledger), beside `docs/plans/money-audit.md`.
**Status:** in-flight
**Review on:** 2026-12-16 — Has Grant opened "Every entry" at least once a week, and has it answered a "where did this come from?" question the Ledger check alone could not?

## Problem

Grant, 2026-11-16, after the Ledger check's "Restore the $40.00 charge" wrote an entry he could not find: "where did it restore to?", then "i dont see it. We dont even have Nov 15 the date in ledger", then "I got no trust in this system now". Asked for the audit and this list: "add the ledger entries list too".

The Ledger page showed only sums (Collected, Outlay, Net, Still owed). The entries behind them — every charge, payment, cover, reversal and club cost — had no screen, so an entry the app wrote could not be seen or checked by a person.

## Kill criterion

If, by the review date, the list has not been opened in four weeks of normal use, or Grant still has to ask where an entry is after it shipped, the list is not doing its job: fold it into the Ledger check instead of a page of its own.

## Non-goals

- Editing or deleting entries. The ledger is append-only; the list only reads.
- Members seeing it. Admin only, like the rest of the Ledger page (it names who paid what).
- A new store. It reads the same `ledger` container the page already sums.

## Decisions

- **A sheet off the Ledger page, in the page's own range** ("Every entry behind these numbers, with dates", under In and out). It lists the entries the sums above it are made of, so the two can be compared line by line.
- **Dated the way the sums are dated** (`effectiveDate` in `lib/ledgerView.ts`): an entry on its money's date, a reversal on the date of what it reverses. Days are headed in Vancouver time, like every other date in the app.
- **Nothing is hidden**: a reversed entry and its reversal both stay, struck through, with the reason ("job deleted"), because "the ledger never edits" is only believable if the corrections are visible.
- **Filters, not search**: All, Charges, Payments (and covers), Club costs, Reversals, Credit. Newest 500 in the window; a longer window says so.

## Shape

| Piece | File |
|---|---|
| The statement (who, what, how, reversed) | `lib/ledgerEntries.ts` |
| The read | `app/api/admin/ledger/entries/route.ts` (admin, sync check like the Ledger page) |
| The sheet | `components/admin/ledger/LedgerEntriesSheet.tsx`, opened from `components/admin/LedgerPage.tsx` |
| Tests | `__tests__/group-ledger-entries.test.ts`, `__tests__/components/LedgerEntriesSheet.test.tsx` |
