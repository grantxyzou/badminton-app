# Notification center

**Track:** between-session engagement (North Star pillar 1). What the app has to tell a member should reach them whether or not they turned push on, without stacking cards on Home.
**Status:** in-flight (the page and phase 2; the other phase 1 prompts are still on Home, see Decisions)
**Review on:** 2026-12-16 — did the share of members with push on rise above 3 of 41, and how many members have opened the page at all (count `noticesSeen` docs in `insights`)? Of those, how many have push off? Few opens = the bell isn't being found; put the prompts back as one Home card.

## Problem

Grant, 2026-11-04, on the push nudge from #762 stacking under "Add BPM to your home screen" on a phone browser: "Nudge issue I think we should have a notification center".

Then, the same night, on the shape: "Take out the banner move the messaging to Notification", and "Notification would be an full page how you trigger it is a third round icon button beside translate, dark mode, there shoild be a red dot when new notification arrives."

Two problems are behind that:

1. **Prompts compete for the top of Home.** Each prompt is its own card above this week's session: Add to home screen (`InstallBanner`), the push nudge (`PushNudge`), What's new (`ReleaseNotesTrigger`) and Set a PIN (the `signInSetup` banner). On a phone browser the first two say different things (install the web app, get the store app) and push the session down.
2. **What a push says reaches almost nobody.** The monthly UX report (2026-11-02): 3 of 41 members have push on. The other 38 never hear "sign-ups are open", "you've been moved off the waitlist", "your racket is ready" or "payment due" unless they open the right screen. Every one of those is a push-only message today (the trigger table is in [push-notifications.md](push-notifications.md)).

## Kill criterion

By the review date, if fewer than a quarter of active members open the bell in a month, it isn't being found. Undo phase 1 by putting the prompts back as ONE Home card (not four), and don't build phase 2.

## Non-goals

- No new push triggers. The center shows what the existing triggers already send.
- No email, and no messages between members.
- No live updates. The list refreshes when the page opens, when the app comes back to the foreground, and when the store app resumes.
- Admins don't see who read what.
- This week's session, the sign-up card and the balance stay on Home. They're the page, not notices.

## Phase 1: prompts behind one bell (no server storage)

*Superseded in shape by the full page below (Grant, 2026-11-04). Only the push prompt has moved so far.*


- **A bell in Home's header,** beside the club name. It opens a sheet listing whichever prompts apply to this person on this device:
  - Notifications: turn on (store app), or get the app (web). This is `PushNudge` from #762.
  - Add to home screen (`InstallBanner`, mobile browser only).
  - Set a PIN, when the account has no way to sign back in.
  - What's new (`ReleaseNotesTrigger`).
- **A dot on the bell** while any prompt is undone and not dismissed. Each row keeps its own "done" and "dismissed" rules, which already exist per card.
- **Home loses those cards, Set a PIN included** (decided below). The one-shot PIN sheet that opens straight after an admin approval (`lib/offerPin.ts`) is not a card and stays.
- **Members already in the waitlist** see the waitlist push ask on the sign-up card, not in the bell ([waitlist-push-ask.md](waitlist-push-ask.md)): it belongs to that moment.

## Phase 2: what pushes said, kept for everyone

- **A notice is written for EVERY recipient a trigger names, push or not,** before the push is sent. The push stays best-effort; the notice is what someone without push will see.
- **Storage:** the database is at Cosmos's 25-container cap, so no new container. A `kind: 'notice'` doc in `insights`, not `events` (see Decisions).
- **A notice holds** its type, the facts its row needs (session date, racket, an announcement excerpt, a session count) and when it was sent, never the push's English sentence, so the page renders it in the reader's language. It never holds money, the same rule as the push body.
- **Unread:** notices newer than the last time this person opened the page put a red dot on the bell. "Last opened" is per account, per club (decided below).
- **Announcements are listed too**, as notices, beside the Home card that already shows them (decided below).

## Decisions

- **Prompts first, then push history** (Grant, 2026-11-04), over prompts only (leaves 38 of 41 hearing nothing) and history only (leaves the stacked cards).
- **#762 ships its push nudge as a Home card now** (Grant, 2026-11-04). Phase 1 moves it into the bell, so the push ask reaches people this week rather than after the center is built.
- **Set a PIN lives in the bell only** (Grant, 2026-11-04: "In notification only"), over keeping a Home banner as well. The risk: someone with no way to sign back in who never opens the bell can be locked out when their session cookie expires (30 days). The bell's dot is the only signal, so the PIN row must always count toward it.
- **"Seen" is per account** (Grant, 2026-11-04: "Account"), stored on the membership, so a second phone doesn't show everything as unread again. Per device would have needed no server write, but every new phone would start with a full unread count.
- **Announcements are listed in the bell** (Grant, 2026-11-04: "In notifications"). Read as "also": the Home announcement card stays, because it is the server-rendered first thing on Home. If "only" was meant, moving it off Home is its own decision.

- **A full page, opened from a third round button beside translate and dark mode, with a red dot** (Grant, 2026-11-04). This replaced the bell in Home's header and its sheet: the button is on every tab, like the two toggles, because a notice can be about any tab.
- **On the web the page leads with the app, not a push switch** (Grant, 2026-11-04: "It should be a card for get the app. Then turn on notification only when user is in the app."). The top card is "Get the BPM app on your phone", opening `MigrateSheet`; the push switch shows in the store app, and on the web only to a browser that already has push on, so those few can still turn it off. The iPhone "Add to Home Screen for notifications" path no longer appears on the page.
- **The Home push card from #762 is gone**, and its copy moved to the top of the page (Grant: "Take out the banner move the messaging to Notification"). The page leads with "Get a ping when sign-ups open"; on the web, a "Get the BPM app on your phone" card opens `MigrateSheet`. Profile's Notifications row opens the page; the old Notifications sheet is gone.
- **Everyone gets notices, push or not** (Grant, 2026-11-04). So a notice is written BESIDE `sendPushToMembers`, never inside it: that sender no-ops with no VAPID key and reaches only people with a device row, so an inbox written from inside it would reach the 3 of 41 who need it least.
- **Listed** (Grant): sign-ups open, a spot from the waitlist, racket updates (the stages push announces, and a change to confirm), announcements, and settle-up reminders. **Not listed:** staff notices (access requests, join notices, new stringing requests) and the push test.
- **Stored in `insights`, not `events`**, reversing this doc's earlier recommendation once the readers were checked. `app/api/admin/slice0/route.ts` reads `events` with `c.at >= @since` and NO kind filter, so every notice would have counted as engagement. `events` is also append-only, which a "seen" stamp cannot be. `insights` is GROUP-scoped and keyed by `/memberId` like `events`, deleted on account deletion, and its two existing readers point-read their own ids, so a new kind cannot reach them. `pushSubscriptions` was out too: metrics count every row there as "push enabled".
- **"Seen" is one `noticesSeen` doc per member per club in `insights`, not a field on the membership.** It keeps Grant's "per account" (a second phone does not start fully unread). The membership doc is re-read on every authenticated request and written under an etag by role changes, so stamping it on every page open would put a hot write on the hottest doc.
- **Bounded:** the page shows the newest 30; past 60 the oldest are deleted on read.
- **Not built yet, still on Home:** Add to home screen, What's new, and Set a PIN. Set a PIN was decided "in notification only", but moving it puts a lockout risk on whether the bell's dot is noticed, so it waits for Grant to see the page first.

## Shape

| Piece | File |
|---|---|
| Notice kinds, write, read, seen | `lib/notices.ts` |
| List + unread | `GET /api/notifications` (`requireMember`) |
| Mark seen | `POST /api/notifications/seen` |
| Writers, beside each push | `app/api/session/route.ts`, `lib/waitlistPromote.ts`, `lib/stringingNotifyDispatch.ts`, `app/api/announcements/route.ts`, `lib/paymentReminders.ts` |
| The round button and its red dot | `components/NotificationsButton.tsx`, `.notif-toggle` / `.notif-dot` in `app/globals.css` |
| The page | `components/NotificationsPage.tsx`, opened by `components/HomeShell.tsx` |
| Push on/off (store app; web only when already on) | `components/PushSettings.tsx` (was `PushSheet`) |
| The get-the-app card at the top on the web | `components/NotificationsPage.tsx` |
| Shared client state (dot + list) | `lib/useNotices.ts` |
| Two-club isolation | `__tests__/group-notifications.test.ts` |
