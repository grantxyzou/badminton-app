# Stringing earnings

**Track:** ROADMAP North Star — the stringing service (the bench). Follows `docs/plans/stringing-jobs-list.md` and reads the stock from `docs/plans/string-usage-rate.md`.
**Status:** in-flight
**Review on:** 2027-01-15 — after two full months, does Grant open Earnings from the bench, and did "Waiting on payment" lead to a Send invoice or a Mark paid he would otherwise have missed? If nobody opens it, the line on the bench is enough and the page is weight.

## Problem

Grant, 2026-11-17: "on the strining job side, can we pull out how much earning ideate with me first", then "can we add string profit analysis?". On the canvas (String stock page, boards EarnRow, EarnPiles, EarnKept, EarnKeptOpen):

- "Kept what does that mean?" → "after string cost"
- "there is so many $ amount...."
- "a lot of the things here can be communicated with data viz. Think finance best practice and data viz design."
- "When I come here I want to understand how much each string type has made net. I dont care about my price and per string. That calculation can show....... how does use go into strining profit?"
- "does this update or its an what if?" → "no, call out its a simulation"
- "go with A" for the shape, then "implement".

The bench showed every job and what each one owed, and nothing added them up: not the month's work, not what came in, not what the string cost.

## Kill criterion

A number on the page disagrees with the bench or the ledger for the same jobs: a collected figure that is not the sum of the paid jobs, an owed figure that is not what `isBillable` says, or a string cost that is not the shelf's cost per set. One wrong total and the page is worse than none.

## Non-goals

- A stringer who is not an admin sees no money here, as everywhere else (`toStringerJob`). Per-stringer pay is not modelled: one stringer per club for now (Grant, 2026-11-18: "we are not scaling like that yet"), so the club's earnings are that stringer's.
- Saving a price. "Simulate price" is a what-if on the page and writes nothing.
- Anything off the stringing jobs: sessions, shuttles and gift cards have their own money screens.
- Tax, fees, time. "After string cost" is the price minus the string that went into the racket, nothing else.

## Decisions

- **Counted by the day the string went in** (`strungAtOf`, the first `strung` in the history), the same day the usage rate counts, so a month's string cost and its work fall in the same month (the mixed-window rule). A job with no such entry (made before the history existed) counts on its `createdAt`. Only jobs in `STRUNG_STATUSES` count: a racket still on the bench is not work done.
- **Three piles, one reading each.** Collected = `paidAt` set. Owed = `isBillable`. Not invoiced yet = priced, unpaid and not billable (an invoice-billed job not yet sent, or a racket strung and not yet Ready). A withdrawn job counts only if it was paid. An unpriced job counts as a job and adds no money.
- **The string cost is the shelf's**, never matched again: `summarizeStringStock` now returns `jobLines` (job id → line), and the job's cost is that line's `costPerSetCents`. A job with the player's own string costs nothing and sits under "Own string"; a job whose string matches no shelf line keeps its own label and costs nothing, because the shelf cannot price it.
- **A set costs what it cost on the day it was strung** (2026-11-26; Grant, after asking for a check of the page: "This app is supposed to be my earning. It must be accurate end to end"). The first cut costed every job at the line's `costPerSetCents`, which is TODAY's price, so logging a dearer reel in November re-priced every set strung since the summer and moved months that were over. `summarizeStringStock` now also returns `jobCosts` (job id → cents) from `priceOn(points, day)`, the one price rule (latest paid reel, else latest paid purchase, else latest) over the purchases dated on or before the job's Vancouver strung day. A job strung before the string's first logged purchase takes the earliest one; a job with no strung date takes today's. The shelf's own `costPerSetCents` is still today's price, which is right for what the shelf is worth.
- **Nothing is zero in silence** (same day). A strung job with no price adds no work, and a job whose set nobody can price (a string not on the shelf, a hybrid, a string never bought) adds no cost. Each is counted per month (`unpricedJobs`, `unknownCostJobs`) and said on the tile it qualifies: "1 job not priced" under Work done, "2 jobs: string cost unknown" under After string cost. Hybrids stay in that count until the half-set split is decided (canvas board "Hybrid").
- **The read re-checks the admin on every call** (`isAdminAuthedWithMember`, same day): it shipped on the cookie-only check a day after the security scan moved the stock read off it, so a demoted or removed admin could have read the club's earnings for the cookie's 30 days.
- **Payback is the shelf's, all-time**: what was bought for a string against all the work done with it. "N more jobs" divides the gap by the row's price (or the simulated one). It is not per reel: the shelf does not know which reel a set came off.
- **Admins and organisers only** (`isAdminAuthed`), like the stock read the page sits beside.
- **Every month since the first counted job**, at most 36 (`EARNINGS_MAX_MONTHS`): the read started as the last four (the canvas's window) and widened with the time picker below; the current one reads "so far".
- **Time selection is Month / Quarter / Year, then ‹ ›** (2026-11-18; Grant: "what about time selection? canvas first", then "go with A" over quick-range chips (B) and a scroll-and-tap chart (C)). The server still sends months; the page folds them (`lib/earningsPeriods.ts`), so a quarter's or a year's figures are the sum of its months and nothing is counted twice. The columns show the six periods up to the chosen one, and tapping one is the same as stepping to it. The bench's line follows the period picked (Grant, 2026-11-18: "the line should follow the chosen period"): the bench holds the choice (`EarningsPick`, a period KEY so a refetch that adds a month cannot move it; `null` is the newest), and it is this month until one is picked. It is held for as long as the bench is open, not saved.
- **A period still filling is set against the same months of the one before** (`comparable`): Q4 so far (October, November) against July and August, this year so far against the same months last year, named in the tile ("vs Jul–Aug"). Set against a whole quarter, two months read as a drop that is only the month still to come. A month so far is set against the whole month before, because the read counts by month.

## Shape

| Piece | File |
|---|---|
| Job → shelf line | `lib/stringStockMath.ts` (`jobLines`) |
| The fold, pure | `lib/stringingEarnings.ts` (`summarizeEarnings`) |
| Months into quarters and years | `lib/earningsPeriods.ts` (`periodsOf`, `comparable`, `windowAround`) |
| The read | `app/api/stringing/earnings/route.ts` |
| The bench's line and the page | `components/admin/CommandCenter/StringingPage.tsx` (`view: 'earnings'`), `components/stringing/EarningsLine.tsx`, `components/stringing/StringingEarningsPage.tsx` |
| Tests | `__tests__/stringing-earnings.test.ts`, `__tests__/earnings-periods.test.ts`, `__tests__/group-stringing-earnings.test.ts`, `__tests__/components/StringingEarningsPage.test.tsx` |
