# Roles v2: organisers, badges, and the operator

**Track:** multi-group critical path, "a SECOND club created and run through one session end to end" (CLAUDE.md, Groups). A second club needs more than one person in charge, and needs a rule for who can hand out admin.
**Status:** intent
**Review on:** 2026-12-02 — has PR 1 (organisers) shipped, and does any club other than BPM Core have a second organiser or a promoted admin?

## Problem

Grant, 2026-10-30: *"What if I only want myself and the club admin to have a higher level permission to promote someone to be admin?"*

Today any admin can make anyone else an admin (`PATCH /api/members`, the `role` branch). Each new admin can then make more. A club has exactly one owner (`Group.ownerMemberId`), so a club that two friends run together has no way to say so. Six Feathers (`six-feathers-onboarding.md`) is the first outside club in view, and its organiser would want a second one.

Nobody outside BPM has reported this yet. It is Grant's read ahead of a second club.

## Kill criterion

- The organiser-only promotion rule stands on its own and is not killed by this.
- If no club other than BPM Core has a second organiser by the review date, stop after PR 1. Do not build anything further on multiple organisers.

## Non-goals

- **A co-organiser rank.** Rejected 2026-11-01 (Grant: "They should just be organizers").
- **Tester accounts, a beta channel, a staging copy on mock data, a per-club beta.** Rejected 2026-11-01 (Grant: "This app is already huge in implementation and features").
- **Per-capability switches inside a rank** (an admin without money access). Presets only, until a club asks.
- **An operator screen.** The override is a key-gated route, like the group backfill.
- **A reviewer demo account.** Deferred to the next store submission that asks for one.

## Decisions

All made by Grant in conversation, 2026-10-30 to 2026-11-01.

**Three layers, each answering a different question.**

| Layer | Values | Stored on | Granted by |
|---|---|---|---|
| Rank: what can you do in this club? | Organiser (one or more) · Admin · Player | Membership | Organisers |
| Badge: what job do you do? | Stringer · Gifter | Membership | Stringer: admin and up. Gifter: organisers only |
| Account type: do you count? | Staff (no usage beacons) | Member (the person) | The operator only |

**Ranks.**

| | Organiser | Admin | Player |
|---|---|---|---|
| Run the night: sessions, list, payments, announcements | ✓ | ✓ | |
| Grant or remove Stringer | ✓ | ✓ | |
| Grant or remove Gifter | ✓ | | |
| Make or remove admins | ✓ | | |
| Make organisers | ✓ | | |
| Club settings, keys, close the club | ✓ | | |

- **Names stay plain in code** (`owner` / `admin` / `member`). The badminton feel lives in `messages/*.json`, where `owner` already reads "Organiser" and `member` reads "Player". Renaming a stored role value would break rollback.
- **Several organisers per club.** The membership role `owner` may sit on more than one membership. `Group.ownerMemberId` stays (fields are never removed) and now names the **founder**.
- **Nobody removes an organiser.** Not another organiser, not an admin. This beat "founder protected" and "all equal": it closes the falling-out case where whoever acts first keeps the club.
- **An organiser can step down** to admin or player.
- **When the last organiser steps down or leaves, the club passes on** through the succession `reassignOwnership` already runs on account deletion: the longest-serving admin, else the longest-serving player. A club with nobody left closes. Grant's answer was "Last player becomes organiser"; the succession covers that case, and the review should confirm the admin-first order is what he meant.
- **Stringer can be held at any rank.** It stays independent of `role` (`lib/types.ts`, `canString`) and moves from the Member onto the Membership, as `canGift` did on 2026-10-09.

**The operator override.** One person (Grant) can change any club's ranks, including an organiser's, as break-glass for abuse or an orphaned club. "The operator" is today "any admin of BPM" (`app/api/admin/migrate-groups/route.ts`). With several BPM organisers and admins that would hand cross-club power to all of them, so the operator becomes a named list instead (see Shape).

**Staff.** The `app_open`, `tab_view` and `sign_in` usage records skip a staff account. Sign-ups, payments, kudos and stringing still count, because they are real club records counted from their own containers.

## Shape

Four PRs, in order. Sizes are estimates.

| PR | What | Where | Size |
|---|---|---|---|
| 1 | Several organisers, organiser-only promotion and Gifter, nobody removes an organiser, step down with succession, roster sheet controls | `lib/groups.ts`, `app/api/members/route.ts`, `components/admin/CommandCenter/RosterPage.tsx`, `docs/roles.md` | Medium-large: the real work |
| 2 | Stringer onto the Membership, admins grant it | `app/api/members/route.ts`, stringing auth reads | Small |
| 3 | Operator identity and override | see below | Small-medium: about a day of work, one PR |
| 4 | Staff mark | `POST /api/events` (`app/api/events/route.ts`), `recordSignIn` in `lib/usage.ts` | Tiny |

**PR 3 in detail.**

1. **Who the operator is.** An `OPERATOR_MEMBER_IDS` App Setting (member ids, not names: names change and repeat across clubs) and one `isOperator(req)` helper beside the auth checks, re-reading the member like `isAdminAuthedWithMember`. `migrate-groups` switches to it, which tightens that route too.
2. **The route.** `POST /api/operator/membership { groupId, memberId, role }`. Rate limit, then the admin cookie AND an operator id AND the `x-migration-key` header (the backfill's gate), so a stolen cookie alone is not enough. It may demote an organiser; if that leaves the club with none, the succession runs.
3. **A record of every use.** One `kind: 'operatorAction'` doc per change in the GLOBAL `groups` container (who, when, which club, before and after), the way `lib/groupLeaks.ts` records leaks. An override nobody can see afterwards is not break-glass.
4. **Tests.** Non-operator 403, a BPM admin who is not the operator 403, missing key 403, demoting another club's organiser, succession when the last organiser goes, the record written. A `__tests__/group-*.test.ts` file imports the route (the sweep-coverage canary).
5. **No screen.** It is called the way the backfill is.

Dependency: PR 3 needs PR 1, since an organiser that nobody can remove is what makes an override necessary.
