# Show how close the waitlist is to filling another court

**Track:** admin cost-automation (North Star pillar 3). Deciding whether to book another court is the one waitlist step still done by hand and by asking around.
**Status:** intent
**Review on:** 2026-12-09 — since ship, how many sessions had their court count raised after the line showed "a court's worth"? None, while waitlists stayed long = the line isn't helping the decision; remove it.

## Problem

Relayed on 2026-11-04 (no verbatim quote yet): people still message Grant about the waitlist. Promotion and position already work: a waitlister sees "Position #2 of 5" and "You'll be moved up automatically", and a freed spot fills itself ([waitlist-auto-promote.md](waitlist-auto-promote.md)). What nobody can see is whether the waitlist is big enough for another court. That decision is Grant's, and the number he needs isn't on any screen. His Next session card shows "+N waitlist" but not how many more would fill a court.

## Kill criterion

By the review date, if no session's court count was raised after the line read "a court's worth", the line isn't changing the decision. Remove it.

## Non-goals

- No automatic court booking. Courts are booked with the venue, outside the app.
- No automatic cap raise. Raising `maxPlayers` already promotes waitlisters; this only informs the admin's decision to do it.
- No new setting. Use the club's existing `playersPerCourt` (`lib/clubRun.ts`), or the session's own numbers.

## How the number is worked out

Courts and the player cap are separate fields on a session (`Session.courts`, `Session.maxPlayers`), and BPM Core has no per-court setting (`playersPerCourt: null`, the `first_come` style), so its cap is typed by hand.

- **Players per court:** the club's `playersPerCourt` when set (Six Feathers: 8). Otherwise `maxPlayers ÷ courts` when it divides evenly (12 ÷ 2 = 6). Otherwise show nothing rather than guess.
- **The line:** with P per court and W waitlisted (held-for-unpaid rows excluded, since they wouldn't move up):
  - W < P: "3 waiting · 3 more fills a court"
  - W ≥ P: "6 waiting · that's a court's worth"

## Open questions (for Grant)

1. **Who sees it?** Recommended: the admin's Next session card first (`components/admin/CommandCenter/NextSessionCard.tsx`, beside "+N waitlist"), because the decision is the admin's. On the members' sign-up card the same line could read as a promise of a court the venue may not have. If members should see it too, it needs softer wording.
2. **Is 6 a court for BPM?** `maxPlayers ÷ courts` assumes the cap was set per court. If BPM's cap isn't a clean multiple, or 6 isn't how Grant thinks about a court, set `playersPerCourt` for BPM on the Club run page instead (`components/admin/CommandCenter/ClubRunPage.tsx`). That also makes the cap follow the courts in both session forms, which changes how BPM's cap is entered.
3. **A push to the admin** when the waitlist first reaches a court's worth? Not in this plan; only if the line alone doesn't get seen.

## Decisions

<appended as the work proceeds>

## Shape

| Piece | File |
|---|---|
| Players per court, and the line's numbers (pure, tested) | `lib/clubRun.ts` (beside `capacityForCourts`) |
| Admin line | `components/admin/CommandCenter/NextSessionCard.tsx` |
| Member line, if Grant wants it | `components/HomeTab.tsx` (waitlist and full states) |
| Copy | `messages/en.json`, `messages/zh-CN.json` (member line only; admin screens are English-only by decision) |
