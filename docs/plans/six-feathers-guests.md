# Guests the way Six Feathers brings them

**Track:** multi-group critical path — "a SECOND club created and run through one session end to end" (CLAUDE.md, Groups). Step F of `docs/plans/six-feathers-onboarding.md`, the last rule from the club's chat that the app does not yet match.
**Status:** intent
**Review on:** 2026-12-09 — after Six Feathers' first two Saturdays: did any guest reach the list through the app, and did the organiser add or fix one by hand in the chat?

## Problem

The club's own words, from its chat (quoted in `docs/plans/six-feathers-onboarding.md`):

> *"You're welcome to bring friends. Please add their name(s) to the waitlist as soon as it is posted."*

and the list writes a guest as **`Jenny (Josh)`**.

Plus-one (`docs/plans/plus-one.md`, #751) already does the core of it: a guest is a row of their own, takes a spot or waits, leaves with their host, and follows the late-cancel rule. Since #790 a guest waits for the members-first window like a drop-in. The roster import already recognises `Jenny (Josh)` and skips it as a guest.

Checked against how the club actually runs, four things do not fit yet:

| The club | The app today |
|---|---|
| "bring **friends**", "their **name(s)**" | one guest per member per session (a plus-one non-goal) |
| a guest is written `Jenny (Josh)` | the row is `Jenny (Josh's guest)`, and **Copy list** prints that |
| guests are normal for the club | guests are a club switch, **off** by default, and choosing the "Members first" style leaves it off |
| a member texts "+1 Jenny" and the organiser adds her | only the host's own phone can add a guest; an organiser can remove one but not add one |

Nobody at Six Feathers has used the app yet, so none of these has been reported by a player. They come from the club's written rules and its list.

## Kill criterion

- **The organiser still adds or fixes a guest by hand** in the chat on either of the first two Saturdays. Then guests through the app do not match how the club works, and the gap is named before anything else is built.
- **Or no guest reaches a Six Feathers list through the app** by the review date. Then plus-one's own review (`docs/plans/plus-one.md`, 2026-12-16) decides whether the feature stays at all.

## Non-goals

- **Guest prices.** A guest pays the drop-in rate, and Six Feathers keeps its money outside the app (`money: 'off'`).
- **Guest accounts.** A guest stays a seat and a name. A regular guest becomes a member through a one-time invite, as plus-one already offers.
- **Changing BPM Core.** It keeps one guest and its own switch.
- **Guests skipping the members-first window.** Settled in #790 (Q5): they wait with the drop-ins.

## Proposed — for Grant to confirm

**Q1. How many guests a member can bring.**
- **(Recommended) A club setting: 1 or 2 guests per member per session.** "Members first" sets 2, BPM stays at 1. "Friends" is plural, the original Six Feathers plan said "at most two", and a cap keeps one member from filling the waitlist.
- Or keep it at one for everyone until someone at Six Feathers asks for a second.

**Q2. How a guest is written.**
- **(Recommended) `Jenny (Josh)` everywhere the list is shown or copied**: the roster on Home, the organiser's card and Copy list. A copied list then reads the way the chat already does, and pasting it back into the roster import still skips the guests.
- Or keep `Jenny (Josh's guest)` in the app and change only Copy list.

**Q3. Guests on for the "Members first" style.**
- **(Recommended) Yes.** The guests switch becomes one of the rules under How your club runs, and choosing "Members first" turns it on. A club already on that style gets it from the style when this ships, the same way the window arrived in #790. First come, first served keeps whatever the club has set.
- Or leave it a separate switch the organiser turns on by hand.

**Q4. The organiser adds a guest for a member.**
- **(Recommended) Yes, from the session's list.** "Add a guest for Josh" on a signed-up member's row on the organiser's card, with the same rules as the member's own button: the cap, the window, the host must be on the list, and the guest leaves with the host. This is the pilot's bridge while some members still text the organiser.
- Or only the member adds their own guest.

**Smaller rules, decided unless Grant says otherwise:**
- **A guest whose name is already on the roster is refused** ("Kodai is on the club's list — ask them to sign up themselves"). Otherwise one person could hold two spots under two rows.
- **Each guest is their own row**, as now. Removing one removes that one, and a host who leaves takes all of theirs.

## Shape (to confirm with the answers)

- **The cap.** `ClubRun.guests: 0 | 1 | 2` in `lib/clubRun.ts`, read through `clubRunOf` like the other rules. `0` replaces the `guestsAllowed` switch: absent reads the old switch (`guestsAllowed: true` = 1) so BPM is unchanged, and the settings route keeps writing `guestsAllowed` for rollback. "Members first" presets 2.
- **The add.** `addGuest` in `app/api/players/route.ts` counts the host's live guests against the cap instead of refusing a second outright, and refuses a guest name that resolves to an active roster name (`guest_on_roster`). An admin may pass `hostMemberId`, checked against the session's rows, with the same rules.
- **The name.** `guestDisplayName` writes `Jenny (Josh)`; `isGuestRow` and `matchesIdentity` already key on `guestOf`, never the name, so nothing reads the old form. Rows written before keep their stored name.
- **Screens.** The guest row on Home shows "Add another guest" up to the cap. The organiser's card gets "Add a guest for …" on a member's row. How your club runs shows the guests rule beside Members first. English and Chinese for every member string.
- **The demo.** The six-feathers seed turns guests on and adds a `Jenny (Josh)`-style guest, so the screens can be looked at.
- **Tests.** Two clubs: the cap per club, the second guest refused at 1 and allowed at 2, a roster name refused as a guest, an organiser's add obeying the window and the cap, Copy list writing `Name (Host)` and the roster import skipping it, and BPM unchanged.
