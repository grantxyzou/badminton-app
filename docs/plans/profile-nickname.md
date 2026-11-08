# What should the club call you? (a member renames themselves)

**Track:** onboarding through the club's door link (`docs/plans/door-link.md`): the door now asks for a first and last name, and this is how a member goes by something shorter afterwards.
**Status:** shipped 2026-11-08
**Review on:** 2026-12-08 — has anyone renamed themselves, and did any rename break a sign-up, a cancel or an e-transfer match (look for "Needs a look" rows naming an old name)?

## Problem

Grant, 2026-11-08, after the door started asking for "first and last name": "Do we wanna separate first and last name?" and then "one name what about username like an alias?". People are known at the court by a short name ("Chris", "Lin D"), but the door now asks for a full one, and only an organiser could change a roster name (the Roster sheet).

## Kill criterion

- A rename leaves a member unable to cancel their spot or shows them as not signed up when they are (this week's rows not following the name).
- An e-transfer from a renamed member lands in "Needs a look" because an alias still points at the old name.

Either one means the carry (`lib/rosterRename.ts`) missed a place the name lives as text.

## Non-goals

- **No second name.** No username, handle or separate display name. A club keeps one name per person; this lets the person set it.
- **Not the person's account name.** `Member.name` is written only for BPM (its rollback copy), as the organiser's rename does.
- **No history rewrite.** Past sessions, game results and kudos notes keep the name they were written under, as a receipt would.

## Decisions

- **One name, set by the person** (Grant chose this over a username, 2026-11-08). Reasons given to him: the organiser approving the door needs a real name, a second name forces every screen to pick one, and the e-transfer memo is matched on the roster name.
- **Unique in the club, as every roster name is**: the club's name reservation is the clash check (`name_taken`), the same rule as the organiser's rename. Another club's same name is no clash.
- **The rows that hold the name as text follow it** (`carryRosterRename`): the member's own rows in the active session (by `memberId`; a guest row keeps its `Jenny (Josh)` form) and the club's e-transfer aliases (by `memberId`, or an exact old-name match on an alias with none). The organiser's rename in `PATCH /api/members` now calls the same function; before, renaming someone who had signed up left Home reading them as not signed up.
- **A page, not a sheet**, beside Stats & privacy, after Cash App's "What name do you prefer to go by?" (Mobbin). Saving reloads: the page gate reads the name from the roster, and every tab holds the old one.
- **The cookie is re-minted** with the new name, because a few reads still key on the cookie's name.

## Shape

| Piece | Where |
|---|---|
| The route | `PATCH /api/members/me/name` (member cookie, live; 10/hour per IP; 1–40 characters) |
| What follows the name | `lib/rosterRename.ts` (`carryRosterRename`), also called by the organiser's rename |
| The page | `components/profile/NicknamePage.tsx`, from Profile → Account → "Your name in the club" |
| Tests | `__tests__/group-self-rename.test.ts`; the organiser's carry in `__tests__/group-admin-scope.test.ts` |

Checked on the mock store, 2026-11-08, at 430 wide: Lin opened the page from Profile, "viktor" was refused as taken in BPM Core, "Lin Dan" saved and the identity card read "Lin Dan" after the reload.
