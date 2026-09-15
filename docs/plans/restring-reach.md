# Restring reach — a reminder when it is time

**Track:** North Star pillar 4 (traffic/recommendations strong enough to suggest equipment purchases) — stringing is the one paid equipment service the app sells, and its only door is one Home card.
**Status:** in-flight
**Review on:** 2026-10-26 — From `stringingJobs.createdAt`: did requests per month from repeat shop customers rise in the six weeks after ship vs the six before?

## Problem

Grant, 2026-09-14: "any upsell opportunities? I am thinking move equipment after
you and have sign up to show some type of interesting insight above the sign up
list what else?"

Nobody has reported this one; it is the owner's read. The shop is OPEN in
production and push notifications for jobs are wired, so the service exists. What
it lacks is reach: "Submit a request" sits on one Home card with nothing
suggesting it is time to use it.

## Kill criterion

Requests per month from members with at least one earlier shop job, counted
from `stringingJobs.createdAt`, for the six weeks after ship against the six
before. No rise: the reminder is noise; remove the line.
Nothing records who SAW the reminder, so this reads
the cohort the reminder can reach, not the people it reached — add an
`app/api/events` kind first if that distinction ever decides anything.

## Non-goals

- Moving Gear next to You in the Stats register. Deferred until after the
  2026-10-15 `reach` read in `docs/plans/skill-leads-stats.md`; moving it now
  restarts that measurement.
- Anything that counts sessions missed (Stage 8) or shows money on Sign-Ups (Home only).
- Reminding anyone who has not used the shop. No shop job, no line.

## Decisions

- **Shop customers only, after two months** (Grant, 2026-09-14: "Just timing
  reminder after like 2 months for now. Only show up for people who got
  stringing with me"). `RESTRING_AFTER_WEEKS = 8`. Before that, nothing renders —
  no quiet "last strung N weeks ago" line.
- **The date is a shop job's `ready`/`picked_up` step, archived jobs included**;
  archiving does not un-string a racket. The member's own `stringLog` was built
  in and then taken out on that answer: it records strings done elsewhere, and a
  string ADDED to the bag logs the day it was typed, not the day it went on.
- **`lastStrungAt` rides on the existing player jobs read** rather than a new
  route: one more field, a date only, so the price wall is untouched.
- **No "Get these strung" link on the Set-up card.** Built, looked at, and removed
  the same evening on Grant's call.
- **No kudos tip above the Sign-Ups roster.** Built, looked at, and removed the
  same evening on Grant's call.

## Shape

| Piece | File |
|---|---|
| Date + due rule | `lib/restring.ts` |
| `lastStrungAt` on the player view | `app/api/stringing/jobs/route.ts` |
| Shop-open probe, one owner | `lib/useStringingShop.ts` |
| Reminder line | `components/stringing/StringingCard.tsx` |
