# Members first — a window before the list opens to everyone

**Track:** multi-group critical path — "a SECOND club created and run through one session end to end" (CLAUDE.md, Groups). Step E of `docs/plans/six-feathers-onboarding.md`, the last rule Six Feathers runs that the app does not.
**Status:** in-flight — built in #790
**Review on:** 2026-12-09 — after Six Feathers' first two Saturdays with the window on: did the organiser move anyone by hand on a Tuesday, and did a drop-in ever get a spot before the window ended?

## Problem

Six Feathers' organiser, in the club chat (quoted in `docs/plans/six-feathers-onboarding.md`):

> *"As members, you have priority for a spot each Saturday …"*
> *"The member-priority registration deadline is 11:59 p.m. every Monday … Starting every Tuesday, if any spots remain available, we will move waitlisted players to the confirmed list in order."*

Today the app has one rule for everyone: a free spot goes to whoever signs up first. Run a members-first club on it and a drop-in who taps on Saturday night takes a spot a member was promised until Monday. The organiser's only way to honour the rule is to watch the list and move people by hand, which is the WhatsApp job the app was meant to take away.

What already exists, so E is only the window:
- **Member or drop-in** is `Membership.regular`, set by the roster import or the Roster sheet (#754).
- **The waitlist moves up on its own** when a spot frees (`lib/waitlistPromote.ts`, `docs/plans/waitlist-auto-promote.md`), in sign-up order, with a push to each person promoted.
- **A sign-up can already start on the waitlist with spots free**: the soft hold (`heldForUnpaid`) does exactly that, and promotion already skips such a row. The window is the same move for a different reason.

Last week's list does not carry over (Grant, 2026-11-04), so members sign up each week like everyone else; the window is what gives them first pick.

## Kill criterion

- **The organiser still moves the waitlist by hand** on either of the first two Tuesdays. Then the window ends at the wrong moment for them, or nobody saw it end (see Q3), and fixing that comes before anything else is built on it.
- **A drop-in gets a spot before the window ends**, even once. Then the window is not a rule the club can rely on, and it goes back to being an organiser's job until it is.

## Non-goals

- **A fixed number of drop-in spots** ("4 spots for drop-ins every week"). Not what the club's rule says. If it comes up, it is a separate setting.
- **Different prices for members and drop-ins** ($20 / $22). Six Feathers keeps its money outside the app (`money: 'off'`).
- **Carrying last week's list over.** Dropped (Grant, 2026-11-04).
- **A scheduler.** App Service runs nothing on a timer (the payment reminders ride the club's own Gmail script). Q3 is how the window ends without one.
- **Changing BPM Core.** The setting is absent for it, and absent means no window — BPM reads exactly as before.

## Decisions

Grant, 2026-11-04: "Yes to all five" (the recommended answer to each question below).

- **Q1, set as a day and time before the session.** Stored as calendar days before the session's day plus a clock time on the club's clock (`{ daysBefore, time }`, `ClubRun.membersFirst`), not as a count of hours. Same answer to the organiser, but it needs no session to convert a weekday into hours, keeps the minute ("11:59 PM", which whole hours could not), and stays Monday 11:59 PM if the session's start time moves. The plan said hours; this was decided while building it.
- **Q2, only someone marked member** (`Membership.regular === true`). The settings row counts the people nobody marked.
- **Q3, the first visit lets the waitlist in.** The visits are the session read, the roster read, a sign-up and a guest. The organiser's card has "Let the waitlist in now" while the window runs.
- **Q4, sign-up order, everyone together** — the order auto-promotion already used.
- **Q5, a guest waits with the drop-ins.**
- **The rule is copied onto the session at advance** (`Session.membersFirst`), and the end is worked out from it and the session's start. A change to the setting starts with the next session ("Starts with the next session you create" on the settings row). A session created before this shipped has no window.
- **"Members first" presets Six Feathers' rule**, 5 days before at 11:59 PM (the Monday before a Saturday). Changing it makes the club Custom, as changing 8 to a court does. A club that chose "Members first" before this shipped gets the preset on its next advanced session, by the "a gap fills from the club's style" rule.
- **A save that does not name the window keeps it**, so a phone still running the old settings screen cannot turn a club's window off by flipping its money switch.
- **"Another court can be added" waits until the session is full** during the window, on Home and on the organiser's card. While people wait with spots free, a court's worth of them is not a reason to book a court.
- **Paying off the unpaid hold does not skip the window.** A drop-in held for unpaid sessions who pays during the window stays on the waitlist until the window ends.

## Questions Grant answered

**Q1. How the organiser says when the window ends.**
- **(Recommended) As a day and time before the session**, e.g. "until Monday 11:59 PM", the way the club says it. Stored as hours before the session starts (`ClubRun.membersFirstHours`, like `lateCancelHours`), shown in the form as the actual day and time for the next session. For a Saturday at 7 PM, Monday 11:59 PM is 115 hours before. Like the late-cancel row in the onboarding plan, a count of hours equals a weekday cutoff while the session time stays fixed.
- Or a weekday and clock time stored as such. Reads more naturally, but it brings in a time zone the app does not yet keep per club (Gotchas: "Session times display in Vancouver time").

**Q2. Who counts as a member.**
- **(Recommended) Only someone marked member** (`regular === true`). Anyone else — a drop-in, or a name nobody marked — waits for the window to end. The settings row shows "N people aren't marked member or drop-in" so the organiser can fix the list before it matters.
- Or everyone except someone marked drop-in. Kinder to an unmarked member, but a new person who arrives through the club link would get member priority by default.

**Q3. How the window ends with nothing running on a timer.**
- **(Recommended) The first visit after it ends lets the waitlist in.** Any read of the session after `membersFirstEndsAt` (Home, the sign-up card, the Command Center, a widget) runs the same promotion the cancel path runs, once, etag-guarded, and stamps the session so it never runs twice. With 35 people on the list, someone opens the app on Tuesday morning; the push reaches the promoted people then, not at 12:00 AM. The organiser also gets "Let the waitlist in now" on the session card, for the day nobody opens it.
- Or an outside caller on a timer (a GitHub Actions schedule hitting a key-protected endpoint). The push lands at midnight exactly, but it is a new piece of infrastructure that fails silently if it stops.

**Q4. The order the waitlist moves in.** The club says "in order".
- **(Recommended) Sign-up order, everyone together** — the order auto-promotion already uses. A member who signed up after the list filled waits behind a drop-in who signed up earlier, because both were waiting when the window ended.
- Or members first, then drop-ins, each in sign-up order. Closer to "members have priority", but it is a second ordering rule the club has not asked for.

**Q5. A member's plus-one during the window.** A guest is not a member.
- **(Recommended) The guest waits with the drop-ins**, so a member cannot bring a guest into a spot another member was promised. The host is told "Alex waits until Monday 11:59 PM".
- Or the guest comes in with the host.

## Shape

| piece | file |
|---|---|
| The window's clock: end, open, due (pure, client-safe) | `lib/membersFirst.ts` |
| The setting, its preset, validation | `lib/clubRun.ts` (`ClubRun.membersFirst`), `app/api/admin/settings/route.ts` |
| `Session.membersFirst`, `Session.membersFirstReleasedAt`, `Player.waitingForMembers` (additive) | `lib/types.ts` |
| Copying the rule onto a new session | `app/api/session/advance/route.ts` |
| A non-member waits; a guest waits; a visit after the end lets the waitlist in first | `app/api/players/route.ts` (POST, guest, GET), `app/api/session/route.ts` (GET) |
| Skipping the waiting rows while it runs; the release | `lib/waitlistPromote.ts` (`planPromotions`, `releaseMembersFirst`) |
| The paid hold keeps the window | `lib/paymentsInbox.ts` |
| "Let the waitlist in now" | `app/api/session/members-first/route.ts`, `components/admin/CommandCenter/NextSessionCard.tsx` |
| The settings row | `components/admin/CommandCenter/ClubRunPage.tsx` |
| What a drop-in and a host see | `components/HomeTab.tsx`, `components/home/PlusOneRow.tsx`, `messages/*.json` |
| The demo club marks its members and stamps the window | `lib/cosmos.ts` (`SEED_DEV_SCENARIO=six-feathers`) |

Tests: `__tests__/group-members-first.test.ts` (two clubs: sign-up, a cancel during the window, the release, a late sign-up, a guest, the organiser's button, advance), `__tests__/members-first.test.ts` (the clock, across daylight saving), `__tests__/club-run.test.ts`, `__tests__/admin-settings-club-run.test.ts`, `__tests__/components/ClubRunPage.test.tsx`.
