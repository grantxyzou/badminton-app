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
- **The string cost is the shelf's**, never matched again: `summarizeStringStock` returns what each job took off the shelf (`jobParts`, job id → its strings; it was `jobLines`, job id → line, until hybrids were counted), and the job's cost is read from there. A job with the player's own string costs nothing and sits under "Own string"; a job whose string matches no shelf line keeps its own label and costs nothing, because the shelf cannot price it.
- **A set costs what it cost on the day it was strung** (2026-11-26; Grant, after asking for a check of the page: "This app is supposed to be my earning. It must be accurate end to end"). The first cut costed every job at the line's `costPerSetCents`, which is TODAY's price, so logging a dearer reel in November re-priced every set strung since the summer and moved months that were over. `summarizeStringStock` now prices each job's string (`costCents` on its `jobParts`; first as `jobCosts`, job id → cents) from `priceOn(points, day)`, the one price rule (latest paid reel, else latest paid purchase, else latest) over the purchases dated on or before the job's Vancouver strung day. A job strung before the string's first logged purchase takes the earliest one; a job with no strung entry is costed on the day it was made (the month Earnings counts it in), and only one with neither date takes today's. The shelf's own `costPerSetCents` is still today's price, which is right for what the shelf is worth.
- **Nothing is zero in silence** (same day). A strung job with no price adds no work, and a job whose set nobody can price (a string not on the shelf, a hybrid, a string never bought) adds no cost. Each is counted per month (`unpricedJobs`, `unknownCostJobs`) and said on the tile it qualifies: "1 job not priced" under Work done, "2 jobs: cost unknown" under After string cost.
- **The read re-checks the admin on every call** (`isAdminAuthedWithMember`, same day): it shipped on the cookie-only check a day after the security scan moved the stock read off it, so a demoted or removed admin could have read the club's earnings for the cookie's 30 days.
- **Payback is the shelf's, all-time**: what was bought for a string against all the work done with it. "N more jobs" divides the gap by the row's price (or the simulated one). It is not per reel: the shelf does not know which reel a set came off.
- **Admins and organisers only**, re-checked on every call (`isAdminAuthedWithMember`; see below), like the stock read the page sits beside.
- **Every month since the first counted job**, at most 36 (`EARNINGS_MAX_MONTHS`): the read started as the last four (the canvas's window) and widened with the time picker below; the current one reads "so far".
- **Time selection is Month / Quarter / Year, then ‹ ›** (2026-11-18; Grant: "what about time selection? canvas first", then "go with A" over quick-range chips (B) and a scroll-and-tap chart (C)). The server still sends months; the page folds them (`lib/earningsPeriods.ts`), so a quarter's or a year's figures are the sum of its months and nothing is counted twice. The columns show the six periods up to the chosen one, and tapping one is the same as stepping to it. The bench's line follows the period picked (Grant, 2026-11-18: "the line should follow the chosen period"): the bench holds the choice (`EarningsPick`, a period KEY so a refetch that adds a month cannot move it; `null` is the newest), and it is this month until one is picked. It is held for as long as the bench is open, not saved.
- **A period still filling is set against the same months of the one before** (`comparable`): Q4 so far (October, November) against July and August, this year so far against the same months last year, named in the tile ("vs Jul–Aug"). Set against a whole quarter, two months read as a drop that is only the month still to come. A month so far is set against the whole month before, because the read counts by month.

- **A hybrid takes string off BOTH shelves, by how the string is bought** (2026-11-27; Grant, on the canvas boards "Hybrid": "depending if I have the reel or packet. Packet would be the customer paying the whole packet, 2 of them. Reel is per side"). Until then a hybrid matched no shelf line: nothing came off the shelf and its string cost $0, so "After string cost" read too high. `splitSides` (`lib/stringingSides.ts`) is the one reading of "mains / crosses", shared with the bench row; the stock count tries the whole label first (a shelf string may hold " / " in its own name) and only then reads two sides. Each side takes **half a set when the string was bought by the reel** on or before the day it was strung (`sideSets`; the side is cut and the rest stays on the reel) and **a whole set when it only ever came in packets** (the packet is opened for that racket), at the price of the day. The app does not track which packet or reel a set came off, so "bought by the reel" is the rule: a string with a reel logged by then is cut from it. Two names for one shelf string ("BG80 / Yonex BG80") is one whole set, not a hybrid. The stock, the usage rate and the colour pools take the same halves, so the shelf and Earnings cannot disagree.
- **A hybrid's price is shared equally between its two strings** (my call; Grant did not pick between this and a "Hybrid" row of its own): each string's row gets half the job's price (the odd cent to the mains) and counts half a racket, so "what each string made" stays true and the rows still add up to the month. A side the shelf does not list keeps a row of its own at no cost, and the job counts under "cost unknown".
- **A deleted job that was PAID still counts** (2026-11-27; Grant: "Keep delete"). Deleting an archived job dropped it out of Earnings while the ledger kept its charge and payment, so the two disagreed. The job's `stringUse` row (the one that already keeps its set used) now also keeps `priceCents`, `paidAt`, `createdAt` and `ownString`, written only for a job paid when it left; a paid own-string job leaves a row too (`leavesAUse`), which takes no set. `deletedPaidJobs` turns those rows back into jobs for the fold, in the month they were strung, as collected. Nothing about the player is kept. **An account deletion leaves the same row** (security review of this change): `purgeMember` hard-deletes a member's jobs, and wrote no row, so a deleted account took its paid restrings out of Earnings (and put their sets back on the shelf) while the ledger kept the money under `~anon`. It now calls `recordStringUse` before each job goes; the row names no person. An own-string row keeps no label or colour: the name of a string the club never stocked is the player's own words, and an empty label is what a build from before this skips, so a rollback takes no set for it. **A paid job deleted before this shipped is not recoverable here**: its row holds no money, and only the ledger remembers it. A deleted job that was never paid owes nothing and stays out.
- **The club report carries the totals** (2026-11-27; Grant: "YEs to total in report"): `stringEarnings` on `clubMetrics()`, so the key-protected report and the admin Metrics read return what the page shows, month by month plus a total, from the same read (`loadStringEarnings`). Numbers and shelf labels only: no player, no job number, and a string the shelf does not list is counted under `offShelf`, never by the name somebody typed. Because it is the club's money, `GET /api/admin/metrics` moved to the fresh admin check (`isAdminAuthedWithMember`). **Open, Grant's call**: the reports key itself is not re-checked. In a club other than BPM any admin can mint it, and a key they kept still reads these totals after they are demoted, until someone mints a new one. BPM's key is the operator's alone. The options are organiser-only minting, or a new key whenever an admin is demoted.

## Shape

| Piece | File |
|---|---|
| Job → what it took off the shelf | `lib/stringStockMath.ts` (`jobParts`, `sideSets`), `lib/stringingSides.ts` (`splitSides`) |
| The fold, pure | `lib/stringingEarnings.ts` (`summarizeEarnings`) |
| Months into quarters and years | `lib/earningsPeriods.ts` (`periodsOf`, `comparable`, `windowAround`) |
| The read | `lib/stringingEarningsRead.ts` (`loadStringEarnings`), behind `app/api/stringing/earnings/route.ts` and the club report (`lib/stringStockReport.ts`, `stringEarnings`) |
| The bench's line and the page | `components/admin/CommandCenter/StringingPage.tsx` (`view: 'earnings'`), `components/stringing/EarningsLine.tsx`, `components/stringing/StringingEarningsPage.tsx` |
| Tests | `__tests__/stringing-earnings.test.ts`, `__tests__/earnings-periods.test.ts`, `__tests__/group-stringing-earnings.test.ts`, `__tests__/components/StringingEarningsPage.test.tsx` |
