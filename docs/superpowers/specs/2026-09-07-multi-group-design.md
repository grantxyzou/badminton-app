# Multi-group: several clubs in one deployment

**Intent:** `docs/plans/multi-group.md`
**Date:** 2026-09-07
**Status:** Design approved 2026-09-07; Phase 0 implemented
**Flag:** `NEXT_PUBLIC_FLAG_MULTI_GROUP` (server-read; planned removal 2026-12-15)

## Goal

A stranger who installs the store app can create their own group or join one
from a link, and every group's sessions, roster, payments and inventory are
invisible to every other group — while BPM, the one club in production today,
notices nothing until it is asked to.

## Decisions this design rests on

Five, all Grant's (2026-09-07), recorded with alternatives in the intent doc:
one account many groups; invite link or code with no approval queue; a new
product name with BPM as group #1 (`groupId: 'bpm'`); resolution from a cookie
claim plus a membership check; Stats racket-fit rebuild first.

## Data model

### Container classification (`lib/groupScope.ts`, canary-enforced)

| Kind | Containers | Rule |
|---|---|---|
| GROUP_SCOPED | `sessions`, `players`, `announcements`, `skills`, `gameResults`, `birds`, `aliases`, `kudos`, `stringingJobs`, `clubSettings`, `events`, `insights`, and (Phase 2) `memberships` | Every read through the scoped accessor; every write stamped `groupId`. |
| PERSON_SCOPED | `members`, `identities`, `playerGear`, `assessments`, `drillCompletions`, `pushSubscriptions`, `authhandoff`, `authmigration` | Raw access allowed. Any club AGGREGATE over one of these must be narrowed to the group's roster first. |
| GLOBAL | `equipmentCatalog`, `releases`, `feedback`, and (Phase 2) `groups` | Raw access allowed. |

`kudos` is GROUP because eligibility is co-play on a roster and `raterName` is
a roster name. `events` is GROUP so the Slice-0 readout is per group. `insights`
is GROUP with one cache doc per group per member — it narrates partners, and
the Anthropic disclosure in the privacy policy says partner names travel, so
scoping the snapshot's session queries is a privacy boundary as well as an
isolation one. `assessments`, `drillCompletions`, `playerGear` are PERSON per
the one-account decision.

### Ids

- `groupId` is an additive optional FIELD. Cosmos partition keys are immutable,
  so it is filtered in queries, never made a key. Absent means BPM while
  `TOLERATE_UNSTAMPED` is `true`; the Phase 2 backfill stamps every existing
  row `'bpm'`; Phase 5 flips to strict.
- `groupDocId(groupId, id)`: BPM keeps the legacy id, any other group gets
  `${groupId}:${id}`. Applies to the session pointer, the `clubSettings`
  singletons, and session ids (`sessions` has `id === sessionId === PK`, so two
  groups on the same date would otherwise 409).
- `getActiveSessionId(groupId)` returns `null` for a group with no pointer; the
  `'current-session'` fallback fires only for BPM.

### `groups` (PK `/id`) and `memberships` (PK `/groupId`) — Phase 2

```
Group      { id, name, sport: 'badminton', ownerMemberId, createdAt, createdBy,
             settings: { eTransferRecipient?, skipDates, maxPlayers, receiptMemo?, demo? } }
Invite     { id: `invite:${sha256(token)}`, groupId }     // sibling point-read doc
Code       { id: `code:${sha256(code)}`,   groupId }      // 6–8 chars, per-IP rate limit
Membership { id: `${groupId}:${memberId}`, groupId, memberId, name, nameLower,
             role: owner|admin|member, status: active|removed|left, joinedAt, joinedVia }
NameRes    { id: `${groupId}:name:${nameLower}`, groupId, kind: 'name', memberId }
```

Roster names are unique PER GROUP via the reservation doc created with
`items.create` (409 = taken) — the `identities` pattern, atomic without a
unique index. `Member.name` becomes the person's default display name.

## Scoped accessor (Phase 1)

```ts
groupScope(groupId)
  .query(container, { select?, where?, params?, orderBy?, limit? })  // a builder, not SQL rewriting
  .read(container, id, pk)                                            // point read + verify groupId
  .create / .upsert / .replace / .remove                              // stamp or verify
  .rosterMemberIds()
```

Three independent layers against a cross-group leak: the builder always emits
the group clause; the accessor JS-verifies `groupId` on every returned row and
logs `[group-leak]` on a mismatch; and a two-group marker sweep asserts every
group-scoped route returns nothing of group B's under cookie A (and does under
cookie B — the vacuity guard). Raw `getContainer` on a GROUP container outside
an allowlist is a build error via a ratchet list that only shrinks.

## Resolution and auth (Phase 2)

Both session cookies gain an optional `groupId` claim. `verifyMemberAuth`
returns it; `isAdminAuthedWithMember` becomes a membership point read
(`owner|admin`); `admin_session` is minted only when that holds; the sync
`isAdminAuthed` keeps its signature-and-expiry contract because the claim was
role-checked at mint. Switching groups goes through `completeSignIn`, which
already drops admin for non-admins. `ADMIN_NAMES` bootstrap is honoured only
for BPM. Admin settings move from the admin's own `Member` doc to
`groups.settings`, with the member fields left in place for rollback.

PIN sign-in resolves `(groupId, nameLower)` → membership → member when a group
context exists (cookie or `?join=` in flight). With no context, Google / Apple
/ email resolve via `identities`; name + PIN searches memberships across groups
and signs in only on exactly one PIN match (≤5 candidates, existing rate limit).

Owner account deletion reassigns ownership (longest-standing admin → member →
delete the group) so App Store 5.1.1(v) deletion never blocks.

## Onboarding and invites (Phase 3)

First launch with no identity: **Create a group** / **Join with a link or code**
/ **I already have an account**. `?join=<token>` is consumed and stripped in
`HomeShell`'s URL-param block like `?tab=`. "Your groups" on Profile switches
by re-minting cookies and remounting tabs via the existing `refreshNonce`. An
admin `InviteCard` owns link, code, copy/share, regenerate; the shared sign-up
link carries the token. The sign-ups-open push broadcasts to the roster only.

## Brand (Phase 4)

`lib/brand.ts` holds `APP_NAME` etc.; a `{appName}` token in `messages/*.json`
is substituted at message-load time; the legal pages are rewritten for "a tool
casual badminton groups use, each run by its own organiser" while keeping every
needle `__tests__/legal-pages.test.ts` pins (the Anthropic paragraph included);
`VOICE_PERSONA` is built from `APP_NAME` and receives the group name as
call-time context. No new Claude callers.

## Backfill (Phase 2) and cutover (Phase 5)

`POST /api/admin/migrate-groups` (+ `GET` status), idempotent, `dryRun` first,
`MIGRATION_KEY` gated: create `groups/bpm`; a membership + name reservation per
member; stamp `groupId: 'bpm'` on every unstamped row under `IfMatch`; copy
admin settings into `groups.settings`. Prod order: deploy flag-off → status →
dry run → run → status zeros → flag on → a week of logs without `[group-leak]`
→ `TOLERATE_UNSTAMPED = false`.

## Testing

Per phase: full suite (watch the file COUNT), lint (0 errors), `tsc --noEmit`,
the `verify-ui` skill for anything visible. Both flag branches for every gated
path. The isolation sweep grows each phase and, from Phase 5, a canary asserts
it names every route that touches a GROUP container.

## Risks

Cross-group leak (three layers above); the mock `@groupId` trap (closed in
Phase 0); rollback (additive only, member fields kept, prefixed ids invisible to
old code); sweep size (~100 call sites, tsc-driven); the review bot is not a
required check — wait for it; concurrent sessions — pull and check merged PRs
before each phase branch.
