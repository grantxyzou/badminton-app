# Notification center

**Track:** between-session engagement (North Star pillar 1). What the app has to tell a member should reach them whether or not they turned push on, without stacking cards on Home.
**Status:** intent
**Review on:** 2026-12-16 — phase 1: did the share of members with push on rise above 3 of 41, and do members open the bell at all (`notices_open` beacon)? Phase 2, once shipped: of the notices written, how many were seen in the app by someone with push off? Few opens = the bell isn't being found; put the prompts back as one Home card.

## Problem

Grant, 2026-11-04, on the push nudge from #762 stacking under "Add BPM to your home screen" on a phone browser: "Nudge issue I think we should have a notification center".

Two problems are behind that:

1. **Prompts compete for the top of Home.** Each prompt is its own card above this week's session: Add to home screen (`InstallBanner`), the push nudge (`PushNudge`), What's new (`ReleaseNotesTrigger`) and Set a PIN (the `signInSetup` banner). On a phone browser the first two say different things (install the web app, get the store app) and push the session down.
2. **What a push says reaches almost nobody.** The monthly UX report (2026-11-02): 3 of 41 members have push on. The other 38 never hear "sign-ups are open", "you've been moved off the waitlist", "your racket is ready" or "payment due" unless they open the right screen. Every one of those is a push-only message today (the trigger table is in [push-notifications.md](push-notifications.md)).

## Kill criterion

By the review date, if fewer than a quarter of active members open the bell in a month, it isn't being found. Undo phase 1 by putting the prompts back as ONE Home card (not four), and don't build phase 2.

## Non-goals

- No new push triggers. The center shows what the existing triggers already send.
- No email, and no messages between members.
- No live updates. The list refreshes when the sheet opens and when Home comes back into view (`useTabReturn`).
- Admins don't see who read what.
- This week's session, the sign-up card and the balance stay on Home. They're the page, not notices.

## Phase 1: prompts behind one bell (no server storage)

- **A bell in Home's header,** beside the club name. It opens a sheet listing whichever prompts apply to this person on this device:
  - Notifications: turn on (store app), or get the app (web). This is `PushNudge` from #762.
  - Add to home screen (`InstallBanner`, mobile browser only).
  - Set a PIN, when the account has no way to sign back in.
  - What's new (`ReleaseNotesTrigger`).
- **A dot on the bell** while any prompt is undone and not dismissed. Each row keeps its own "done" and "dismissed" rules, which already exist per card.
- **Home loses those cards.** The exception is Set a PIN: an account with no credential can be locked out, so it stays as a banner AND appears in the list (open question 1).
- **Members already in the waitlist** see the waitlist push ask on the sign-up card, not in the bell ([waitlist-push-ask.md](waitlist-push-ask.md)): it belongs to that moment.

## Phase 2: what pushes said, kept for everyone

- **A notice is written for EVERY recipient a trigger names, push or not,** before the push is sent. The push stays best-effort; the notice is what someone without push will see.
- **Storage:** the database is at Cosmos's 25-container cap, so no new container. Recommended: a `kind: 'notice'` doc in `events`.
  - `events` is already keyed by `/memberId` (a member's notices are one partition read), GROUP scoped (each notice belongs to one club), retained for 13 months by its container TTL, and deleted when an account is deleted.
  - The risk: metrics read `events` by kind. Every reader that counts must keep filtering on its own kinds; that needs checking reader by reader before the first write (`lib/metrics.ts`, `app/api/admin/slice0/route.ts`).
- **A notice holds** the trigger, a short title, the tab it opens, and when it was sent. It never holds money, the same rule as the push body.
- **Unread:** notices newer than the last time this person opened the sheet put a count on the bell.

## Open questions (for Grant)

1. **Set a PIN:** keep it on Home as well as in the list (recommended, because without it the account can be lost), or only in the list?
2. **"Last opened"** for the unread count: per device (simple; a second phone shows them unread again) or per account (recommended for phase 2; stored on the membership)?
3. **Announcements:** they already have their own card on Home. List them in the center too, or leave them out?

## Decisions

- **Prompts first, then push history** (Grant, 2026-11-04), over prompts only (leaves 38 of 41 hearing nothing) and history only (leaves the stacked cards).
- **#762 ships its push nudge as a Home card now** (Grant, 2026-11-04). Phase 1 moves it into the bell, so the push ask reaches people this week rather than after the center is built.

## Shape

| Piece | File |
|---|---|
| The bell and its sheet | a new `components/home/NotificationCenter.tsx`, opened from `components/HomeTab.tsx`'s header |
| Prompts it gathers | `components/PushNudge.tsx`, `components/InstallBanner.tsx`, `components/ReleaseNotesTrigger.tsx`, the `signInSetup` banner in `components/HomeTab.tsx` |
| Bell glyph (`notifications` is already in the icon subset) | `lib/iconNames.ts` |
| Phase 2: one writer for notices, called beside each trigger's push | `lib/push.ts` and the trigger sites listed in [push-notifications.md](push-notifications.md) |
| Phase 2: read route | a new `GET /api/notices` (members-only gate, `requireMember`) |
