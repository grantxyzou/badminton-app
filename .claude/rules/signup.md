---
paths:
  - "lib/waitlist*.ts"
  - "lib/membersFirst.ts"
  - "lib/plusOne.ts"
  - "lib/clubRun.ts"
  - "lib/owedRows.ts"
  - "lib/playerIdentity.ts"
  - "app/api/players/**"
  - "app/api/session/**"
  - "components/home/**"
  - "components/HomeTab.tsx"
  - "components/admin/CommandCenter/NextSessionCard.tsx"
  - "components/admin/CommandCenter/AddGuestSheet.tsx"
  - "__tests__/waitlist*.test.ts"
  - "__tests__/plus-one.test.ts"
  - "__tests__/group-guests.test.ts"
  - "__tests__/*members-first.test.ts"
---

# Sign-ups: the waitlist and plus-ones

<!-- Moved word for word from the root CLAUDE.md on 2026-11-09 (step 2 of the trim), to keep the always-loaded file short. -->

## Waitlist

Full session + `POST { waitlist: true }` → `waitlisted: true`. An admin promotes by hand via `PATCH { waitlisted: false }` — capacity-checked, **unless the organiser chooses to go over it** (`overCapacity: true`, 2026-11-12, `docs/plans/promote-over-capacity.md`: the Session list sheet's "Move into the session anyway" and the Payments card's confirm after a 409). The session then reads over its cap, and the automatic promotion below fills free spots only, so it waits until the count is back under the cap. **A freed spot is filled automatically since 2026-10-28** (`lib/waitlistPromote.ts`, `docs/plans/waitlist-auto-promote.md`): a cancel of a confirmed spot, an admin removal (`DELETE`, purge-one, `PATCH removed: true`) or a RAISED `maxPlayers` promotes waitlisters in sign-up order (`compareBySignup`) into every free spot and pushes each one — never a `heldForUnpaid` row, never once the session has started, never on a settled session, and never on an admin's move BACK to the waitlist (the first in line is often that same person). Adding a COURT moves nobody: `courts` and `maxPlayers` are separate fields. **How close the waitlist is to another court** shows on the sign-up card and the admin's Next session card (`courtLine` in `lib/clubRun.ts`, `docs/plans/waitlist-court-line.md`): players per court is the club's `playersPerCourt`, else `maxPlayers ÷ courts` when it divides evenly (BPM: 6), else nothing; held-for-unpaid rows don't count. Every promotion stamps `Player.promotedAt`; a cancel by a row promoted inside the club's late-cancel window is not tagged late, and a rejoin or an admin restore clears the stamp. **A club may keep its spots for members first** (`ClubRun.membersFirst`, `lib/membersFirst.ts`, `docs/plans/members-first-window.md`): advance copies the rule onto the session, and until it ends a sign-up from anyone not marked member (`Membership.regular`), and every guest, starts waitlisted with `waitingForMembers: true`, which promotion skips while the window runs. Nothing runs on a timer, so the first visit after the end (the session read, the roster read, a sign-up) stamps `membersFirstReleasedAt` under the session's etag and promotes in sign-up order; the organiser can do it early from the session card.

## Plus-one

A club may let members bring guests (`ClubRun.guests`, 0–2 a session, a rule of How your club runs; a club that never set it reads the old `groups.settings.guestsAllowed` switch as 1, and every save writes that switch beside it; `docs/plans/plus-one.md`, `docs/plans/six-feathers-guests.md`, `lib/plusOne.ts`). The guest is a `players` row of their own with `guestOf: <host memberId>` and NO `memberId`, so the cap, the split and the waitlist count them unchanged; the row's `name` is the club's own form, `Jenny (Josh)` (rows from before say `Jenny (Josh's guest)`; nothing finds a guest by name), and a guest name already on the club's roster is refused (`guest_on_roster`). An organiser may add one for a member on the week's list (`hostMemberId`, the session card's "Add a guest"). **A guest row is its HOST's money**: `matchesIdentity` matches it to the host and never by name, `loadOwedInputs` reads it by `@guestOf`, and the ledger charges it to the host. It leaves with the host, is cancelled only through the host's cookie (`DELETE { guest: true }`), and is anonymized when the host's account is deleted.
