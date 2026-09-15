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

If six weeks after ship the requests from members who had a `lastStrungAt` date
are no higher than in the six weeks before, the reminder is noise; remove the line
and keep the door.

## Non-goals

- Moving Gear next to You in the Stats register. Deferred until after the
  2026-10-15 `reach` read in `docs/plans/skill-leads-stats.md`; moving it now
  restarts that measurement.
- Anything that counts sessions missed (Stage 8) or shows money on Sign-Ups (Home only).
- Guessing a "last strung" date for someone with neither a shop job nor a logged
  restring. No date renders nothing.

## Decisions

- **"Last strung" is the later of two sources:** a shop job's `ready`/`picked_up`
  step (archived jobs included; archiving does not un-string a racket) and the
  member's own `stringLog`.
- **A string ADDED to the bag is not a restring.** The gear route logs on add as
  well as on a tension change, and an add is the day someone told the app about
  their strings, not the day they went on. The first log entry per string item is
  dropped (`restringEntries`).
- **`lastStrungAt` rides on the existing player jobs read** rather than a new
  route: one more field, a date only, so the price wall is untouched.
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
