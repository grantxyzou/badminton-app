# Guests the way Six Feathers brings them

**Track:** multi-group critical path — "a SECOND club created and run through one session end to end" (CLAUDE.md, Groups). Step F of `docs/plans/six-feathers-onboarding.md`, the last rule from the club's chat that the app does not yet match.
**Status:** in-flight — built in #795
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

## Decisions

Grant, 2026-11-05: "Yes to all four" (the recommended answer to each question below).

- **Q1, a club setting of 1 or 2 guests.** `ClubRun.guests` (`0 | 1 | 2`, `lib/clubRun.ts`). "Members first" presets 2. "First come, first served" says nothing about guests (its preset is `null`), so choosing it keeps the club's number and any number still reads as that style. A club whose `run` never named a number reads the old `guestsAllowed` switch (on = 1), so BPM Core is unchanged; every save of the run writes the switch beside it for rollback, and the old Guests screen's switch, if a phone still sends it, moves the number too.
- **Q2, `Jenny (Josh)` everywhere.** New rows store that name (`guestDisplayName`). Home's roster and Copy list build it from `guestName` and the host's row, so rows written before as `Jenny (Josh's guest)` read the new way too. A copied list pasted into the roster import skips the guests.
- **Q3, guests are a rule of How your club runs**, and "Members first" turns them on. The separate Guests page is gone; the Command Center's Guests row opens How your club runs.
- **Q4, an organiser adds a guest for a member** from "Add a guest" on the session card: a sheet to pick a member on this week's list and type the name (`hostMemberId` on the same `POST /api/players`). It skips the sign-ups-open and deadline gates, as an admin's sign-up does, and meets every other rule. It lives on the session card because a club with money off has no other list of the week's sign-ups (the Payments card is hidden); a money-free session list for those organisers is a separate suggestion.
- **A name already on the club's roster is refused** (`guest_on_roster`), in that club only. **So is the same guest name twice for one member.**
- **A member removes one guest at a time** (`DELETE { guest: true, guestId }`); a phone from before sends no id and removes the only one, as it always did.
- **"Their share goes on your balance" shows only where the club collects money in the app.** Six Feathers keeps its money outside it.

## Questions Grant answered

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

## Shape

| piece | file |
|---|---|
| The number of guests, its preset, the old switch as a fallback | `lib/clubRun.ts` (`ClubRun.guests`), `lib/plusOne.ts` (`guestsPerMemberOf`) |
| Saving it, and the old switch beside it | `app/api/admin/settings/route.ts` |
| The cap, a roster name refused, an organiser's add, one guest removed by id | `app/api/players/route.ts` (`addGuest`, `DELETE`) |
| The number on the session read | `app/api/session/route.ts` (`guestsPerMember`) |
| `Jenny (Josh)` | `lib/plusOne.ts` (`guestDisplayName`), `lib/rosterText.ts` (Copy list), `messages/*.json` (`home.guest.rosterName`) |
| A line per guest on Home | `components/home/PlusOneRow.tsx`, `components/HomeTab.tsx` |
| The guests rule | `components/admin/CommandCenter/ClubRunPage.tsx` (the Guests page and `GuestsEditor` removed) |
| "Add a guest" for a member | `components/admin/CommandCenter/AddGuestSheet.tsx`, `components/admin/CommandCenter/NextSessionCard.tsx` |
| The demo club's guest | `lib/cosmos.ts` (`SEED_DEV_SCENARIO=six-feathers`) |

Tests: `__tests__/group-guests.test.ts` (two clubs: the number per club, `Jenny (Josh)`, a roster name refused, the organiser's add obeying the cap, the list and the window, a member unable to name another host, one guest removed by id, Copy list and the roster import), `__tests__/components/PlusOneRow.test.tsx`, `__tests__/club-run.test.ts`, `__tests__/components/ClubRunPage.test.tsx`.
