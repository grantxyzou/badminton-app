# Ask for notifications when someone joins the waitlist

**Track:** between-session engagement (North Star pillar 1). A waitlister who hears that a spot opened comes to play; one who doesn't hear stays home.
**Status:** intent
**Review on:** 2026-12-09 — of members who joined a waitlist since ship, how many turned push on from the waitlist row, and how many promoted rows (`promotedAt`) belonged to someone with push on? Fewer than 1 in 4 tapping = the moment is wrong; drop the row.

## Problem

The monthly UX report (2026-11-02): only 3 of 41 members have push on, and only 2 of 5 new members came back within 14 days. Nobody has said this out loud yet; it comes from those numbers, not a quote.

Since 2026-10-28 a freed spot promotes the first waitlister automatically and pushes them ([waitlist-auto-promote.md](waitlist-auto-promote.md)). That push only reaches the few with notifications on. Everyone else finds out only if they happen to open the app before the session.

Today the ask lives in Profile → Notifications, the one-time Home nudge (`components/PushNudge.tsx`, PR #762) and a row in the stringing request sheet. None of them comes at the moment push is obviously useful. Joining the waitlist is that moment: the person has just been told "you're not in yet".

## Kill criterion

By the review date, if fewer than 1 in 4 people shown the row tap it, the ask isn't working at this moment either. Remove the row rather than adding more asks.

## Non-goals

- No automatic opt-in. Browsers, iOS and Android all need a tap and their own prompt, and a "no" is final (`denied` in `lib/usePush.ts`).
- No ask for someone it cannot help: push already on, denied, unknown, or an iPhone Safari tab (which has no push until it is installed).
- No new push trigger. The promotion push already exists in `lib/waitlistPromote.ts`.
- No change to who gets promoted or when.

## Open questions (for Grant)

1. **Where does the row live?** Recommended: inside the waitlist state of Home's sign-up card, under the "#2 of 5" banner: "Want a ping if a spot opens? Turn on →". It stays visible for as long as they're on the waitlist and push is off, so there's no separate "dismissed" state to keep. The alternative is a sheet that opens right after the join, which is louder and one more thing to close.
2. **An iPhone in a Safari tab** can't get push at all. Show nothing (recommended), or point to the app as the Home nudge does?
3. **Two asks on one screen.** On the native app with push off, the Home nudge (`PushNudge`) and this row could both be visible. Recommended: while the person is on the waitlist, the waitlist row wins and the Home nudge hides.

## Decisions

<appended as the work proceeds>

## Shape

| Piece | File |
|---|---|
| The row: reuse the stringing sheet's enable-push row by lifting it into a shared component | `components/stringing/RequestStringingSheet.tsx` → a new shared row component |
| Shown in the waitlist state of the sign-up card | `components/HomeTab.tsx` |
| Copy (English and Chinese) | `messages/en.json`, `messages/zh-CN.json` |
| Measuring the review question: promoted rows against push subscriptions | `lib/waitlistPromote.ts`, `pushSubscriptions` |
