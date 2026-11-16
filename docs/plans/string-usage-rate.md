# String usage rate

**Track:** ROADMAP North Star — admin cost-automation (the string inventory). Extends `docs/plans/string-inventory.md` and `docs/plans/string-stock-audit-fixes.md`.
**Status:** shipped 2026-11-16
**Review on:** 2026-12-15 — has any string read "Reorder now" or "Reorder soon", and was a reel logged within two weeks of it? If no string has shown a rate, nobody strings enough for one to mean anything: drop the runway line and keep the report block.

## Problem

Grant, 2026-11-15, after the stringing audit offered a one-off snapshot or a
standing report: *"for the options can we build a feature where taking a
picture in app gives the stocking inventory then option 2 tracks the usage
rate?"* Then, asked which first: *"Usage rate first."*

The shelf says how many sets are left, but not how long that lasts. A shuttle
tube already answers it (`lib/birdRunway.ts`: weeks of stock at the current
burn, "reorder now / soon"); a reel never has. And the operator's scheduled
report (the `x-reports-key` read) carries no stringing stock at all, so the
audit could not read the real shelf.

## Kill criterion

If, by the review date, no shelf string has a usage rate (nothing strung in
eight weeks), the runway line is noise: take it off the shelf card and keep
only the report block.

## Non-goals

- A rate per COLOUR. The line's rate only; colours share it.
- Forecasting (seasonality, trends). Sets strung per week over a window, as
  the shuttles do.
- The photo stocktake. Its own plan: `docs/plans/string-photo-stocktake.md`.
- Showing the new report block on the admin Metrics page. The data is the
  same `clubMetrics()` read; a section there is a separate, visible change.

## Decisions

- **The rate is sets strung per week over the last eight weeks, or since the
  club's FIRST strung job if that is sooner** (never under a week). A club
  that started stringing three weeks ago divided by eight would read a third
  of its real rate — the mixed-window bug CLAUDE.md names. A job counts on the
  day it was first moved to `strung` (its `history`), not when it was made; a
  player's own string counts nothing, as in the stock.
- **A deleted job keeps its date.** The `stringUse` row it leaves behind now
  carries `strungAt` (additive); an older row without one counts in the stock
  and not in the rate.
- **The same thresholds as shuttles**: under 2 weeks left is "reorder now",
  under 4 "soon" (`STRING_REORDER_NOW_WEEKS` / `_SOON_WEEKS`). Beat: a set
  count ("3 left"), which says nothing about a string strung twice a season.
  No rate (nothing strung in the window) is unknown, never "plenty".
- **The report gets a `stringShelf` block**: per shelf string the sets left,
  more-used-than-logged, the rate, weeks left and the reorder state, plus job
  counts by stage, archived and own-string. Labels and numbers only, never a
  name or an amount. `null` when the club has stringing off.

## Shape

| Piece | File |
|---|---|
| Rate, weeks left, reorder (pure) | `lib/stringStockMath.ts` |
| A job's strung date; the shared job projection | `lib/stringStock.ts` |
| Stock reads | `app/api/stringing/stock/route.ts`, `lib/stringShelfRead.ts` |
| Report block | `lib/metrics.ts`, `lib/metricsMath.ts` (`ClubMetrics.stringShelf`) |
| Shelf card and sheet | `components/admin/CommandCenter/StringShelfCard.tsx`, `StringShelfSheet.tsx` |
| Tests | `__tests__/string-usage-rate.test.ts` |
