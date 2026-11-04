# Season wrapped: a shareable story card

**Track:** North Star — between-session engagement (ROADMAP §LOCKED); the share-card pipeline the Set-up card already built (`equipment-setup-card.md`).
**Status:** intent — parked in the backlog by Grant on 2026-11-04 ("plan it but back log"); nothing built.
**Review on:** 2026-12-16 — is there a year-end moment worth building this for (a card drawn from the season's sessions, games and kudos), and has `GET /api/stats/attendance` got a season's worth of rows to draw from? If not, push to the next season end.

## Problem

Grant, 2026-11-04: *"Spotify wrap but for badminton shareable to social media story."*

Nothing in the app today gives a member a reason to post about the club. The one share surface is the Set-up card's gear image, which is about equipment, not about them. A season card — sessions played, games logged, kudos received, level then and now, how many people you played with — is the kind of thing a member posts without being asked, and every post is an invite the club did not have to send.

No member has asked for this. It is Grant's idea.

## Kill criterion

- A `wrapped_shared` engagement event, written when the share sheet is confirmed (never on open). If under a fifth of the members who open the card share it in its first month, the card is a curiosity and the next season's version is not built.
- If anyone asks for a partner's name to be taken off a posted card, the names rule below was wrong in the other direction and the card loses partners entirely.

## Non-goals

- Naming other members on the card. The roster is club-private; a card posted to Instagram carries only the member's own numbers and counts ("played with 14 people"), never a partner's name. Kudos appear as a count, never a note or a rater.
- Attendance guilt. The card counts what the member DID; it never shows sessions missed, a lapsed streak or a rank against the club (the "nothing counts sessions you missed" rule, and the club-comparison consent gate).
- A server-rendered image. The card is drawn on the phone by the canvas path the Set-up card uses, and shared through the native share sheet; nothing is uploaded.
- A video or animation. One still, story-sized.

## Shape (proposed, not built)

| Piece | Where |
|---|---|
| A season read: sessions played, games logged, kudos received (count), level at the start and now, distinct partners — one GET, roster-narrowed, members-only gated | a new `GET /api/stats/season`, pure maths in `lib/seasonWrapped.ts` |
| The card: 1080 × 1920, the brand's launch-screen shuttle, drawn by the Set-up card's canvas code at story size | `lib/setupShareCanvas.ts` (generalised) or a sibling, `lib/shareImage.ts` for the sheet |
| The door: a card on Stats → You, shown once a season has enough rows; "Share your season" | `components/stats/` |
| The beacon: `wrapped_shared` on a confirmed share, in the `events` allowlist | `app/api/events/route.ts`, `lib/engagement.ts` |
| The season boundary: a club setting later; the first cut is the calendar year | `lib/seasonWrapped.ts` |
