# Roles and what each can do

There are three kinds of people in the app, and they are not a ladder.
**Admin** and **stringer** are separate switches on the same account. A
member can be either, both, or neither. (A third switch, **gifter**, ran
from 2026-10-09 to 2026-11-10; giving gift cards is an organiser's now, below.)

| | Player (member) | Stringer | Admin |
|---|---|---|---|
| How you get it | Sign up / be added to the roster | An admin ticks "Can string" on your roster entry — per club (`Membership.canString`; `Member.canString` with groups off) | `Member.role === 'admin'` (or a name in `ADMIN_NAMES`); with groups on, an `owner`/`admin` membership, handed out by an organiser |
| Proven by | `member_session` cookie (or the row's `deleteToken`) | the same `member_session`, plus the flag re-read on every request | a separate `admin_session` cookie, minted by `POST /api/admin` with the admin's own PIN |
| Sign up / join waitlist | Themselves | Themselves | Anyone, past the invite list, deadline and `signupOpen` |
| Cancel a spot | Their own | Their own | Anyone's, plus purge / clear all |
| See the roster, announcements, costs | Yes (members-only: signed in) | Yes | Yes, including removed rows and `recoveryEvents` |
| Pay | Self-report "I paid" on their own row | Same | Mark anyone paid, cover (absorb / resplit), settle |
| Stringing | Request a job, accept/decline a price change, see their own job and what they owe | See **only jobs assigned to them**, with no prices; move a job's **status** along | The whole bench: claim, assign (only to a `canString` member), price, propose, mark paid, archive |
| Gift cards | Redeem one into their own credit | — | An **organiser** only (2026-11-10; with groups off, every admin): mint from the console or Profile → "Give a gift card" (10 a day there), and read every card's record: who made it, who redeemed it, when, how much is used and left. An admin who is not an organiser gets `organiser_only`. |
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
everyone's data. `canString` is deliberately separate from `role`; see its
docblock in `lib/types.ts`. **It is held per club** (roles v2 PR 2,
2026-11-03): `Membership.canString` is what the bench reads through
`canStringIn` in `lib/roster.ts`, so Zach stringing for BPM is not on
club-x's bench until club-x's admin ticks the box. Any admin grants it; the
organiser rule is for ranks and gift cards. A BPM row never set reads
`Member.canString`, so the stringers from before the move stayed on.

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

### Organiser (multi-group only)

With `NEXT_PUBLIC_FLAG_MULTI_GROUP` on, roles live on a per-group
`Membership`: `owner | admin | member` (`lib/groups.ts`), shown as Organiser /
Admin / Player. `owner` counts as an admin (`GROUP_ADMIN_ROLES`). Since roles
v2 (`docs/plans/roles-v2.md`, 2026-11-03):

- **A club may have several organisers.** `Group.ownerMemberId` names one of
  them (the founder, until they go) and always an ACTIVE one — succession
  repoints it.
- **Only an organiser hands out a rank** — admin or organiser — and only an
  organiser gives gift cards (2026-11-10; the `canGift` switch that let an
  organiser hand that to a helper is retired, and nothing reads it). `isAdminAuthedWithMember` answers `organiser`; both role
  routes (`PATCH /api/members`, `PATCH /api/groups/members/[id]`) answer
  `organiser_only` to an admin changing either. An admin runs the night and
  grants Stringer.
- **Nobody removes an organiser**: not another organiser, not an admin
  (`owner_immutable` on demote, deactivate and remove). They step down
  themselves — `POST /api/groups/step-down`, Profile → Your groups — and when
  the LAST organiser steps down or deletes their account the club passes to
  the longest-serving admin, else the longest-serving player
  (`reassignOwnership`); a club with nobody left closes. The only person in a
  club cannot step down (`last_member`).
- **The operator** (`lib/operator.ts`; the ids in `OPERATOR_MEMBER_IDS`, or
  an admin of BPM while that is unset) is the one exception:
  `POST /api/operator/membership` sets any rank in any club, an organiser's
  included, behind a listed operator's admin cookie AND the migration key,
  and every use is written down and read back on
  `GET /api/admin/migrate-groups`. Taking an organiser down passes the club
  on the way stepping down does. The operator's own app opens, tab views and
  sign-ins are not counted as usage (staff).

With the flag off, `Member.role` is the role, there is no organiser, and every
admin keeps the full power the role always had.

## Why "works for me" is a warning sign

The admin has the widest credentials, so the admin is the worst person to test
a player path. The admin cookie short-circuits every ownership check. A flow
that works for the admin shows only that the admin can do it. Test player
flows as a seeded non-admin member (`SEED_DEV_SCENARIO=fresh-thursday`: Lin,
PIN 2468) on a device that did not do the sign-up.
