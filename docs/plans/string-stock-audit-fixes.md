# String stock audit fixes

**Track:** ROADMAP North Star — admin cost-automation (the string inventory). Extends `docs/plans/string-inventory.md` and `docs/plans/string-stock-by-colour.md`.
**Status:** in-flight
**Review on:** 2026-12-15 — has any job been marked "their own string", and has the shelf shown a "more used than logged" warning? If a warning showed, was a missing reel logged afterwards?

## Problem

Grant, 2026-11-15: *"Review the stringing action end to end, including the
inventory, the color … and audit the inventory calculation for everything.
Cost, how much string should be left, and the business effect."* The audit ran
`summarizeStringStock` on small made-up shelves and found four ways the count
or the cost reads wrong. Grant: *"fix 1-4 in one PR."*

1. **A player's own string came off the club's shelf.** "Bring my own string"
   saved the job with the string's name and nothing else, so a player who
   brought their own BG80 used up one of the club's BG80 sets. Two such jobs
   took two sets. The shelf then reads low or out early, the request sheet
   hides that string or colour, and a reel may be bought before it is needed.
2. **Using more string than was logged read as zero, silently.** One 200 m
   reel and 27 jobs showed "0 left" and nothing else. That gap is almost
   always a reel nobody logged, so the club's string spending reads low.
3. **The colour pools could add up to more than the total.** One white reel,
   one untagged reel and 25 white jobs: 15 left in total, 0 white + 20 mixed
   by colour. The rule said the colour view "can only be more cautious"; it
   was the other way round, and a player could ask for a colour that was not
   there.
4. **One odd purchase set the price of every set.** A single $15 retail set
   bought after a $10-a-set reel made every set cost $15; a free (gifted) reel
   logged last made every set cost $0, so the shelf's margin read as the
   whole price and the stock's value as nothing.

## Kill criterion

If, by the review date, no job carries "their own string" and the
own-string price chip has not been tapped, the marker is noise: keep the stock
rules (2–4) and fold the toggle away.

## Non-goals

- Back-filling old own-string jobs. Nothing on them says whose string it was;
  the stringer can mark one on its page, and that corrects the count at once.
- A full cost-of-goods (FIFO) model. Cost per set stays "what replacing it
  costs now"; this only stops a one-off from setting that price.
- Logging usage. Stock is still counted from jobs.
- The request-response numbers in the club report (a cancelled request reads
  as unanswered) — a separate change.

## Decisions

- **`StringingJob.ownString?: true`, additive.** Written by the request
  sheet ("I have my own"), the bench's new-job form (a toggle, also set by
  tapping the "Own string" price chip) and the job page (admin only — a
  stringer's PATCH still allows `status` alone). Absent on every older job.
  A job carrying it counts no set, and deleting it leaves no `stringUse` row.
  Both stock reads project `c.ownString`.
- **Overdraw is reported, never clamped away.** `StringStockLine.overdrawnSets`
  (whole sets used past what was logged) and `totals.overdrawnSets`, additive;
  only once a purchase exists, since a string with none logged already says
  "No stock logged". A few metres short is a reel's slack, so it counts whole
  sets only. The shelf card and sheet say "N more used than logged".
- **A tagged colour that runs dry draws its excess from the mixed pool**,
  which is the one pool that could have held that colour. What neither can
  cover is the overdraw above. The line's remaining is then the SUM of its
  pools, so the colours can never add up to more than the total. Beat: capping
  each pool at the old total, which kept a total that subtracted a white
  overdraw from a red reel nobody touched.
- **Price per set comes from the latest PAID REEL**, else the latest paid
  purchase, else the latest purchase (all free reads $0). Beat: an average,
  which would have changed the meaning of "costs you" on the shelf for every
  club for a fix only the odd purchase needs.

## Shape

| Piece | File |
|---|---|
| The rules (own string, overdraw, pools, price) | `lib/stringStockMath.ts` |
| A deleted own-string job leaves no use | `lib/stringStock.ts` (`usesASet`) |
| Both reads project `ownString` | `app/api/stringing/stock/route.ts`, `lib/stringShelfRead.ts` |
| Saving the marker | `app/api/stringing/requests/route.ts`, `app/api/stringing/jobs/route.ts`, `app/api/stringing/jobs/[id]/route.ts` |
| Request sheet | `components/stringing/RequestStringingSheet.tsx` |
| Bench: new job, job page | `components/admin/CommandCenter/StringingIntake.tsx`, `StringingJobDetail.tsx` |
| Bench: the warning | `components/admin/CommandCenter/StringShelfCard.tsx`, `StringShelfSheet.tsx` |
| Tests | `__tests__/string-stock-audit.test.ts` |
