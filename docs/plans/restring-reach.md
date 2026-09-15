# Restring reach — a reminder, a second door, and the kudos hint

**Track:** North Star pillar 4 (traffic/recommendations strong enough to suggest equipment purchases) — stringing is the one paid equipment service the app sells, and its only door is one Home card.
**Status:** in-flight
**Review on:** 2026-10-26 — Did stringing requests per member-month rise after the reminder and the Set-up door shipped, and did anyone tap in from Stats → Gear?

## Problem

Grant, 2026-09-14: "any upsell opportunities? I am thinking move equipment after
you and have sign up to show some type of interesting insight above the sign up
list what else?"

Nobody has reported this one; it is the owner's read. The shop is OPEN in
production and push notifications for jobs are wired, so the service exists. What
it lacks is reach: "Submit a request" sits on one Home card with nothing
suggesting it is time to use it, and the Set-up card, which is literally a list of
what is on your racket, has no route to it at all.

The kudos per-name button on Sign-Ups has the same shape of problem, already
recorded in CLAUDE.md in a player's words: "how do I give kudos to other people?"

## Kill criterion

If six weeks after ship the members who were shown the reminder request no more
often than before, the reminder is noise; remove the line and keep the door.

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
- **The Set-up card's "Get these strung" link is for everyone** once the shop is
  known to be open. It is a door, not a reminder.
- **The kudos hint dismisses for an ISO week**, the same unit kudos dedupe on.

## Shape

| Piece | File |
|---|---|
| Date + due rule | `lib/restring.ts` |
| `lastStrungAt` on the player view | `app/api/stringing/jobs/route.ts` |
| Shop-open probe, one owner | `lib/useStringingShop.ts` |
| Reminder line | `components/stringing/StringingCard.tsx` |
| Set-up card door | `components/stats/GearSetupCard.tsx`, `GearRegister.tsx` |
| Sign-Ups hint | `components/KudosRosterHint.tsx`, `components/PlayersTab.tsx` |
