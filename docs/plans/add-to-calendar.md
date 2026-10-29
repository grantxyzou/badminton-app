# Add to calendar

**Track:** the native shell (`docs/plans/native-shell.md`), its third addition after launch (after `native-badge-shortcuts.md` and `native-widgets.md`); requested directly by the owner on 2026-10-28.
**Status:** in-flight
**Review on:** 2026-11-25 — on a phone with the new store build: does "Add to calendar" open the Calendar app's own New Event screen, filled in, on iPhone and Android, and has anyone in the club used it?

## Problem

Grant, 2026-10-28, on the green "you have signed up for this week!" banner:
"Thursday Oct 29, 8pm at wings is very redundant. What can we add that is
useful here? Add to calendar?" — and then: "cant we just have click on add to
calendar then the native calendar takes over to add onto Calendar APP?"

The banner's second line repeated the date, time and venue that the tiles
directly above the sign-up card already show. No player has asked for a
calendar entry; the owner has.

## Kill criterion

The button does nothing visible on some phone (a dead tap), or the event lands
at the wrong time. Either is worse than the redundant line it replaced.

## Non-goals

- Subscribing to a calendar feed of every week. One event, for this week's session, on a tap.
- Reminders or alarms inside the event — the calendar app's own default applies.
- Keeping the event in step when an admin edits the session afterwards (a second tap updates it on the platforms that honour the UID).

## Decisions

- **One tap opens the platform's own editor, filled in; the person taps Add.**
  Nothing is written to a calendar without them seeing it, so neither platform
  needs calendar permission on the common path.
  - **Android**: `Intent.ACTION_INSERT` on `CalendarContract.Events`, in the
    in-house `BpmCalendar` plugin. No permission at all.
  - **iOS 17+**: `EKEventEditViewController` from the same plugin, with no
    access request — the system runs the editor out of process.
  - **iOS 15–16** (the app's deployment target is 15): that editor needs
    calendar access before 17, so the plugin asks once (one system prompt,
    `NSCalendarsUsageDescription`) and then shows the same editor. Chosen over
    hiding the button for a shrinking share of phones.
- **The web gets a real URL, not a blob.** `GET /api/session/calendar` answers
  `text/calendar` for the active session, `inline`; iOS Safari and the
  home-screen app open it as the system "Add to Calendar" sheet, Android's
  browser downloads it and opens the calendar app. Members-only like every club
  read. A blob or `data:` URL is the flakier path on iOS.
- **Store builds without the plugin hide the button.** The cookie-free fallback
  would open the route in the Browser plugin's own cookie jar and get a 401;
  a share-sheet `.ics` is not reliably offered to Calendar. A dead button is the
  kill criterion, so the old binaries simply don't show it until they update.
- **One builder for the event** (`lib/calendarEvent.ts`): the route's `.ics` and
  the native plugin's fields both come from `sessionCalendarEvent`, so they
  cannot disagree about the time or the place. UTC times, escaped text, CRLF,
  75-octet folding, a `DTSTAMP`, and a UID from the session id so a second tap
  updates rather than duplicates where the calendar honours it.
- **No end time stored → two hours.** `endDatetime` is optional on legacy
  sessions; `DEFAULT_SESSION_MINUTES` is the one place that says so.

## Shape

| Piece | File |
|---|---|
| Event builder + `.ics` | `lib/calendarEvent.ts` |
| Web route | `app/api/session/calendar/route.ts` |
| App-side bridge | `lib/addToCalendar.ts` |
| Button in the banner | `components/HomeTab.tsx` |
| iOS plugin | `ios/App/App/BpmCalendarPlugin.swift` |
| Android plugin | `android/app/src/main/java/com/motioncraft/bpm/BpmCalendarPlugin.java` |
