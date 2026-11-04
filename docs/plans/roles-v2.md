# Roles v2: organisers, badges, and the operator

**Track:** multi-group critical path, "a SECOND club created and run through one session end to end" (CLAUDE.md, Groups). A second club needs more than one person in charge, and needs a rule for who can hand out admin.
**Status:** shipped 2026-11-03 — PR 1 in #756; PRs 2–4 in the follow-up PR the same day. The Review-on question stays: has any club other than BPM Core used it?
**Review on:** 2026-12-02 — has PR 1 (organisers) shipped, and does any club other than BPM Core have a second organiser or a promoted admin?

## Problem

Grant, 2026-10-30: *"What if I only want myself and the club admin to have a higher level permission to promote someone to be admin?"*

Today any admin can make anyone else an admin (`PATCH /api/members`, the `role` branch). Each new admin can then make more. A club has exactly one owner (`Group.ownerMemberId`), so a club that two friends run together has no way to say so. Six Feathers (`six-feathers-onboarding.md`) is the first outside club in view, and its organiser would want a second one.

Nobody outside BPM has reported this yet. It is Grant's read ahead of a second club.

## Kill criterion

- Organiser-only promotion ships regardless; the kill applies only to multiple organisers.
- If no club other than BPM Core has a second organiser by the review date, stop after PR 1. Do not build anything further on multiple organisers.

## Non-goals

- **A co-organiser rank.** Rejected 2026-11-01 (Grant: "They should just be organizers").
- **Tester accounts, a beta channel, a staging copy on mock data, a per-club beta.** Rejected 2026-11-01 (Grant: "This app is already huge in implementation and features").
- **Per-capability switches inside a rank** (an admin without money access). Presets only, until a club asks.
- **An operator screen.** The override is a key-gated route, like the group backfill.
- **Organiser-only club settings, keys and a close-club action.** The settings route, the payments-key and reports-key mints and invites stay admin-gated, and no close-club route exists today (`closedAt` is only ever set by succession). The rank table marks these "stay admin for now"; they join the model when a club asks.
- **A reviewer demo account.** Deferred to the next store submission that asks for one.

## Decisions

All made by Grant in conversation, 2026-10-30 to 2026-11-01.

**Three layers, each answering a different question.**

| Layer | Values | Stored on | Granted by |
|---|---|---|---|
| Rank: what can you do in this club? | Organiser (one or more) · Admin · Player | Membership | Organisers |
| Badge: what job do you do? | Stringer · Gifter | Membership | Stringer: admin and up. Gifter: organisers only |
| Account type: do you count? | Staff (no usage beacons) | The `OPERATOR_MEMBER_IDS` setting, no field | The operator only |

**Ranks.**

| | Organiser | Admin | Player |
|---|---|---|---|
| Run the night: sessions, list, payments, announcements | ✓ | ✓ | |
| Grant or remove Stringer | ✓ | ✓ | |
| Grant or remove Gifter | ✓ | | |
| Make or remove admins | ✓ | | |
| Make organisers | ✓ | | |
| Club settings, keys (stay admin for now, see Non-goals) | ✓ | ✓ | |

- **Names stay plain in code** (`owner` / `admin` / `member`). The badminton feel lives in `messages/*.json`, where `owner` already reads "Organiser" and `member` reads "Player". Renaming a stored role value would break rollback.
- **Several organisers per club.** The membership role `owner` may sit on more than one membership. `Group.ownerMemberId` stays (fields are never removed) and now names the **founder**. The one-owner invariant is bolted into six places, not one, and PR 1 unbolts every one: `setMembershipRole` and `removeFromRoster` refuse `owner` (`lib/groups.ts`), both role routes answer `owner_immutable` (`PATCH /api/members` and `PATCH`/`DELETE /api/groups/members/[memberId]`, whose docblock promises "never two owners or none"), the dev seed demotes any extra BPM owner (`lib/cosmos.ts`, `seedDevGroupMembership`), and `MAX_OWNED_GROUPS` counts organiser memberships, which would block someone invited to co-run three clubs from founding their own. It counts FOUNDED clubs (`ownerMemberId`) instead. `GET /api/groups/current` answers `isOwner` from the membership role, not `ownerMemberId`.
- **Nobody removes an organiser.** Not another organiser, not an admin. This beat "founder protected" and "all equal": it closes the falling-out case where whoever acts first keeps the club.
- **An organiser can step down** to admin or player. This is a NEW route and sheet, not a rule change: `PATCH /api/groups/members/[memberId]` refuses self-targeting on purpose (`cannot_target_self`, "leaving is a different intent with a different confirmation") and nothing under `app/api/groups/` lets a person leave or demote themselves today.
- **When the last organiser steps down or leaves, the club passes on**: the longest-serving admin, else the longest-serving player, becomes organiser; a club with nobody left closes. That is the order `reassignOwnership` already uses on account deletion, but the function is REWRITTEN, not reused: it is keyed on `ownerMemberId === the person leaving`, so a non-founder organiser deleting their account gets `not_owner` and nothing runs (harmless by accident), and the founder leaving while co-organisers exist would promote an admin over the organisers already there. The new rule is "succession runs only when the last ACTIVE organiser goes". Grant's answer was "Last player becomes organiser"; the succession covers that case, and the review should confirm the admin-first order is what he meant.
- **The privacy policy sentence is corrected in PR 1, both locales.** `messages/en.json` says "if you're the only organiser of a group, that group closes with it" (the policy and the delete-account sheet, quoted twice in `legal-copy-multi-group.md`). The code has not done that since succession shipped — the club passes to the longest-serving admin or player and closes only when nobody is left — and several organisers add a second mismatch.
- **Stringer can be held at any rank.** It stays independent of `role` (`lib/types.ts`, `canString`) and moves from the Member onto the Membership, as `canGift` did on 2026-10-09. **This reverses the 2026-10-24 decision** in CLAUDE.md ("`canString` … stays person-level by decision … move it the same way if that ever changes"); PR 2 rewrites that line, `docs/roles.md` and `__tests__/group-admin-scope.test.ts`. There are ten read sites: `stringing/jobs`, `stringing/jobs/[id]`, `stringing/stringers`, `giftcards`, `members`, and `StringingJobDetail`, `RosterPage`, `StringerJobsCard`, `StringingTab` (the components read it off the roster, which already overlays membership fields).

**The operator override.** One person (Grant) can change any club's ranks, including an organiser's, as break-glass for abuse or an orphaned club. "The operator" is today "any admin of BPM" (`app/api/admin/migrate-groups/route.ts`). With several BPM organisers and admins that would hand cross-club power to all of them, so the operator becomes a named list instead (see Shape).

**Staff.** The `app_open`, `tab_view` and `sign_in` usage records skip a staff account. Sign-ups, payments, kudos and stringing still count, because they are real club records counted from their own containers. **The operator list IS the staff list**: no `Member.staff` field and no setter — `POST /api/events` and `recordSignIn` skip any id in `OPERATOR_MEMBER_IDS`. Only those three kinds are skipped: a `client_error` from the operator's phone is still an error.

## Shape

Four PRs, in order. Sizes are estimates. PR 1 landed with two decisions made in the code:

- **`ownerMemberId` always names an ACTIVE organiser.** Succession repoints it to the longest-serving remaining organiser when the one it named leaves, so code from before v2 (a rollback reads it as THE owner) still finds a real person there. It is the founder only while the founder stays.
- **The dev seed still makes `SEED_DEV_ADMIN` the sole owner of BPM** (`lib/cosmos.ts`). Left alone on purpose: the seed's job is "the dev admin owns the dev club", which several organisers do not change, and the second organiser is seeded by the tests that need one.
- **`isAdminAuthedWithMember` answers `organiser`** (flag off: `true`, every admin keeps the power it always had), and both role routes answer `organiser_only`. The sheet sends the rank on every save, so a REAL change is what needs an organiser; an admin saving a name edit passes.

| PR | What | Where | Size |
|---|---|---|---|
| 1 | Several organisers, organiser-only promotion and Gifter, nobody removes an organiser, a step-down route and sheet, succession rewritten, roster sheet controls, the policy sentence | `lib/groups.ts` (`setMembershipRole`, `removeFromRoster`, `reassignOwnership`), `app/api/members/route.ts`, `app/api/groups/members/[memberId]/route.ts`, `app/api/groups/route.ts` (`MAX_OWNED_GROUPS`), `app/api/groups/current/route.ts`, a new leave/step-down route, `lib/cosmos.ts` seed, `components/admin/CommandCenter/RosterPage.tsx`, `components/profile/GroupsPage.tsx`, `messages/*.json`, `docs/roles.md` | Large: the real work |
| 2 | Stringer onto the Membership, admins grant it | `app/api/members/route.ts`, the ten `canString` read sites, CLAUDE.md line, `docs/roles.md` | Small |
| 3 | Operator identity and override | see below | Small-medium: about a day of work, one PR |
| 4 | Staff mark, read off `OPERATOR_MEMBER_IDS` | `POST /api/events` (`app/api/events/route.ts`), `recordSignIn` in `lib/usage.ts` | Tiny; needs only the setting, so it can ship first |

**PR 3 in detail.**

1. **Who the operator is.** An `OPERATOR_MEMBER_IDS` App Setting (member ids, not names: names change and repeat across clubs) and one `isOperator(req)` helper beside the auth checks, re-reading the member like `isAdminAuthedWithMember`. `migrate-groups` switches to it, which tightens that route too.
2. **The route.** `POST /api/operator/membership { groupId, memberId, role }`. Rate limit, then the admin cookie AND an operator id AND the `x-migration-key` header (the backfill's gate), so a stolen cookie alone is not enough. It may demote an organiser; if that leaves the club with none, the succession runs.
3. **A record of every use.** One `kind: 'operatorAction'` doc per change in the GLOBAL `groups` container (who, when, which club, before and after), the way `lib/groupLeaks.ts` records leaks. An override nobody can see afterwards is not break-glass.
4. **Tests.** Non-operator 403, a BPM admin who is not the operator 403, missing key 403, demoting another club's organiser, succession when the last organiser goes, the record written. A `__tests__/group-*.test.ts` file imports the route (the sweep-coverage canary).
5. **No screen.** It is called the way the backfill is.

Dependencies: PR 3 needs PR 1, since an organiser that nobody can remove is what makes an override necessary. PR 4 needs only the `OPERATOR_MEMBER_IDS` setting and can go first.

**As built (PRs 2–4, 2026-11-03).** PR 2: `canStringIn` / `stringerIn` / `listStringers` in `lib/roster.ts` are the one rule for the bench, the stringer view and the picker, and a BPM membership never set reads `Member.canString` (so the existing stringers stayed on; another club's unset row is no). PR 3: `lib/operator.ts`; while `OPERATOR_MEMBER_IDS` is unset the operator is still an admin of BPM, so the deploy locks nothing and the setting is the operator's to add; the override reuses `stepDown` for an organiser, so it refuses the only person in a club rather than closing it; records are read back on `GET /api/admin/migrate-groups` as `operatorActions`. PR 4: `skipsUsageRecord` reads the same list; the client's beacon is answered `{ skipped: 'staff' }` rather than refused. **Operator action for Grant:** add `OPERATOR_MEMBER_IDS=<his member id>` to App Settings; until then nothing is skipped and "operator" means any BPM admin.
