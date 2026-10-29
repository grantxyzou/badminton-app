# Plus-one — a member brings a guest

**Track:** admin cost-automation (North Star pillar 3) — today a guest is added by the admin by hand, becomes a roster member, and is chased for their share separately.
**Status:** in-flight
**Review on:** 2026-12-16 — how many sessions since ship had a guest row, and how many guest shares were paid on the host's balance? None = nobody brings guests through the app; drop the feature rather than grow it.

## Problem

Grant, 2026-10-28: "Do we have logic to include let someone to bring a plus 1?"

The answer is no. A player can only sign themselves up: `POST /api/players`
takes the name from the signed-in account and ignores the body's `name`
(members-only, CLAUDE.md security rule 13). The only path for a guest is an
admin adding them by name, which creates a `Member` and a roster membership
for someone who may come once — and their share then sits on a balance nobody
will open.

No player has asked for it in the app yet. This is the organiser's request.

## Kill criterion

If by the review date no session has had a guest row, or the guest shares sit
unpaid on hosts' balances noticeably longer than the hosts' own, the feature is
not earning its place: remove the button and keep the admin path.

## Non-goals

- A guest has no account, no sign-in, no stats, no kudos, no push. They are a
  seat and a share, nothing more.
- No more than ONE guest per host per session. "Plus two" can be a later
  question if anyone asks.
- No guest-specific pricing. A guest pays the same share as anyone.
- No change to how the admin adds a named player today.

## Proposal (confirmed by Grant, 2026-10-28)

1. **A guest takes a spot.** The guest is a row of their own in `players`, so
   the cap, the cost split, the waitlist and its auto-promote all count them
   without learning a new rule. If the session is full, the guest goes on the
   waitlist and is promoted in sign-up order like anyone else — never ahead of
   people already waiting.
2. **The host pays the guest's share.** The guest's settled line shows on the
   host's Home balance as its own line ("Alex — your guest"), and the
   e-transfer inbox, reminders and pay-with-credit see it as the host's.
3. **If the host cancels, the guest goes too.** The host can also cancel just
   the guest. A cancel of either frees a spot and triggers the waitlist
   auto-promote.
4. **The guest needs a first name**, shown on the roster as "Alex (Lin's
   guest)", so the admin and the court know who to expect.

5. **A guest can become a club member.** On the roster, the admin's menu on a
   guest row offers "Invite to the club", which mints a one-time invite
   (`lib/invites.ts`) for that name. Joining is the normal invite sign-up; the
   guest's past shares stay on the host's balance, where they were paid.

<!--
Everything above is written BEFORE the work and is the gate for starting it.
Everything below is appended AS the work proceeds.
-->

## Decisions

- **A club switch, off by default** (Grant, 2026-10-28, over "always on"). A
  club with a waitlist every week may not want guests competing for spots.
- **An invite list binds guests too** (Grant, 2026-10-28, over "the host
  vouches") — and is moot today: nothing writes `session.approvedNames` and
  `POST /api/players` no longer reads it (members-only replaced it), so there
  is no list for a guest to be on. If the list ever returns, the guest's name
  is checked against it like anyone's.
- **A guest can be promoted to a club member** (Grant, 2026-10-28). It goes
  through the existing one-time invite rather than turning the guest row into
  an account: the row has no credential, and an invite is the only way into a
  club (security rule 13).
- **A guest follows the late-cancel rule like anyone** (Grant, 2026-10-29). A
  guest cancelled inside the club's window, alone or with the host, is tagged
  Late on the guest's own row (`lib/cancelPolicy.ts`), and a guest promoted
  inside the window is exempt, as members are.
- **A guest is its own `players` row, not a `guests: 1` count on the host's
  row**. A count would have to be taught to every place that counts
  rows — capacity, `costSplit`, `planPromotions`, the roster, settle, the
  receipt — and each copy is a chance to disagree. A row is already understood
  by all of them.
- **The guest row carries `guestOf: <host memberId>` and NO `memberId`**. A `memberId` would make the guest the host everywhere a row is
  read by member — kudos eligibility, stats, the "already signed up" check, the
  ledger partition — and the host could not sign up beside their own guest.
  The money half is the one place that must read `guestOf`: `loadOwedInputs`
  and `computeOwedForRoster` (`lib/owedRows.ts`, `lib/owedBalance.ts`) fold a
  host's guest rows into the host's lines, and the ledger mirror charges a
  guest row under the host's partition.
- **`guestOf` reads go by their own parameter name** (`@guestOf`), added to the
  mock store's recognised names in the same change — an unrecognised parameter
  is NO filter in the mock (CLAUDE.md, the mock store gotcha), so a test would
  see every row as a guest.

- **The row's `name` is a display form that cannot be a roster name**, "Alex
  (Lin's guest)" (`lib/plusOne.ts`), with the plain name in `guestName`.
  Several reads still tie a row to a person by name — the sign-up duplicate
  check, the self-cancel lookup, older code after a rollback — and a guest
  called Lin must never be member Lin. `matchesIdentity` adds the rule
  structurally: a row with `guestOf` matches its host and nobody else, never by
  name. Brackets are refused in a guest name so one cannot imitate the form.
- **No guest beside a host held for unpaid sessions** (409 `host_held`).
  Auto-promote skips a held row, so a waitlisted guest of a held host would be
  moved up while the person who brought them waits.
- **A guest leaves with the host, whoever removes the host** — the host's own
  cancel, an admin's remove, PATCH `removed`, purge-one. A guest left behind
  would hold a spot billed to someone who is not coming. Each guest row gets
  its own late verdict; one warning covers both.
- **A guest is cancelled through the host's cookie** (`DELETE { guest: true }`),
  never by name, and has no `deleteToken`. A member cannot reach another
  host's guest; an admin removes any row.
- **No kudos to a guest** (no account to receive them) and **no push when a
  waitlisted guest is promoted** (no account to push to; the host is not told
  either — a follow-up if anyone asks).
- **Account deletion anonymizes the guests a host brought**: their rows name
  the host in `guestOf` and in the display name.

## Shape

| Piece | File |
| --- | --- |
| `Player.guestOf`, `Player.guestName` (additive) | `lib/types.ts` |
| Add / cancel a guest | `app/api/players/route.ts` `POST` / `DELETE` (host cancel removes the guest) |
| Guest share on the host's balance | `lib/owedRows.ts`, `lib/owedBalance.ts` |
| Rules and display name | `lib/plusOne.ts` |
| Who a row belongs to | `lib/playerIdentity.ts` `matchesIdentity` |
| Ledger charge under the host | `lib/ledgerMirror.ts` `memberOf` (the backfill uses the same builders) |
| Account deletion | `lib/memberPurge.ts` `anonymizePlayerRows` |
| "Invite to the club" on a guest row | `components/admin/CommandCenter/PaymentsCard.tsx` → `InviteCard` |
| Club switch | `groups.settings.guestsAllowed`, `lib/groups.ts` `setGuestsAllowed`, `/api/admin/settings`, `components/admin/CommandCenter/GuestsEditor.tsx`; reported to Home on `GET /api/session` |
| "Bring a guest" on the sign-up card; roster label | `components/home/PlusOneRow.tsx`, `components/HomeTab.tsx`, `components/home/WhoElseIsIn.tsx` |
| The guest's line on the balance | `components/UnpaidSessionsCard.tsx` |
| Mock store `@guestOf` | `lib/cosmos.ts` |
| Tests | `__tests__/plus-one.test.ts` |
