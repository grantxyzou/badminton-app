# Roles and what each can do

There are three kinds of people in the app, and they are not a ladder.
**Admin** and **stringer** are separate switches on the same account, and
since 2026-10-09 so is **gifter** (`Member.canGift`, "Can give out gift
cards" on the roster sheet). A member can be any of them, all of them, or
none.

| | Player (member) | Stringer | Admin |
|---|---|---|---|
| How you get it | Sign up / be added to the roster | An admin ticks "Can string" on your roster entry (`Member.canString`) | `Member.role === 'admin'` (or a name in `ADMIN_NAMES`); with groups on, an `owner`/`admin` membership |
| Proven by | `member_session` cookie (or the row's `deleteToken`) | the same `member_session`, plus the flag re-read on every request | a separate `admin_session` cookie, minted by `POST /api/admin` with the admin's own PIN |
| Sign up / join waitlist | Themselves | Themselves | Anyone, past the invite list, deadline and `signupOpen` |
| Cancel a spot | Their own | Their own | Anyone's, plus purge / clear all |
| See the roster, announcements, costs | Yes (members-only: signed in) | Yes | Yes, including removed rows and `recoveryEvents` |
| Pay | Self-report "I paid" on their own row | Same | Mark anyone paid, cover (absorb / resplit), settle |
| Stringing | Request a job, accept/decline a price change, see their own job and what they owe | See **only jobs assigned to them**, with no prices; move a job's **status** along | The whole bench: claim, assign (only to a `canString` member), price, propose, mark paid, archive |
| Gift cards | Redeem one into their own credit | — (a stringer is not a gifter) | Mint from the console; every card's record: who made it, who redeemed it, when, how much is used and left. A member with `canGift` mints from Profile → "Give a gift card" (10 a day), sees their own cards redeemed-or-not and never who. |
| Sessions, birds, settings, members | — | — | Everything under `/api/admin/*`, `session/*`, `birds*`, `members` writes |

## Player

The default. A player can only act on **their own** records, and the server
decides "their own" from a credential, never from a name in the body. Names
are enumerable through the roster.

- **Cancel their spot** (`DELETE /api/players`) with either:
  - the `deleteToken` handed back once at sign-up. It is stored in that one
    browser's `localStorage`.
  - their own `member_session`. The membership is re-read, and the match is on
    the row's `memberId` (the verified name only for a legacy row without one).

  The second path is new as of 2026-09-29. Before that, a player who signed up
  in Chrome and cancelled from the installed app, changed phones, cleared
  storage, or was added by an admin had no token on that device and could not
  cancel. Admins never hit it because their cookie skips the check.
- Write their own gear, check-ins, kudos, PIN and avatar. Each needs
  `member_session` for that member (security rule 12 in `CLAUDE.md`).

## Stringer

Someone who strings rackets **without** being handed payments, the roster and
everyone's data. `Member.canString` is deliberately separate from `role`; see
its docblock in `lib/types.ts`.

- `GET /api/stringing/jobs?view=stringer` returns only jobs whose `stringerId`
  is the caller, projected through `toStringerJob`. That projection has **no
  price and no paid date**, so there is no money on the stringer's screen to
  leak. Without the flag, the stringer view returns an empty list, not an error.
- `PATCH /api/stringing/jobs/[id]` from a stringer accepts **only**
  `{ memberId, status }`, and only on a job assigned to them. Any other key
  gets `403 forbidden_field` instead of being quietly dropped.
- UI: `components/stringing/StringerJobsCard.tsx`.
- Being a stringer grants **no** admin capability. Being an admin does not make
  you a stringer either: assigning a job re-checks `canString` on the assignee
  (`400 not_a_stringer`).

## Admin

Full control of the club. Two things are easy to get wrong:

- **Admin is a separate login.** `POST /api/admin` (name + the admin's own PIN)
  mints an `admin_session`. A member cookie alone does not make you an admin to
  any route, even if your account has the role.
- **Mutating admin routes re-read the role on every request**
  (`isAdminAuthedWithMember`), so a demotion takes effect immediately.
  Read-only admin routes check only the cookie's signature (`isAdminAuthed`).
  See "Auth" in `CLAUDE.md`.

An admin is also a player. Screens that could show either view ask for one
explicitly (e.g. `?view=player` on the stringing jobs list), so an admin's Home
shows their own racket and not the bench.

### Owner (multi-group only)

With `NEXT_PUBLIC_FLAG_MULTI_GROUP` on, roles live on a per-group
`Membership`: `owner | admin | member` (`lib/groups.ts`). `owner` counts as an
admin (`GROUP_ADMIN_ROLES`), cannot be demoted, and is only handed on when the
owner deletes their account. With the flag off (today), `Member.role` is the
role and there is no owner.

## Why "works for me" is a warning sign

The admin has the widest credentials, so the admin is the worst person to test
a player path. The admin cookie short-circuits every ownership check. A flow
that works for the admin shows only that the admin can do it. Test player
flows as a seeded non-admin member (`SEED_DEV_SCENARIO=fresh-thursday`: Lin,
PIN 2468) on a device that did not do the sign-up.
