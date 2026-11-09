---
paths:
  - "lib/memberPurge.ts"
  - "lib/appleRevoke.ts"
  - "lib/clearDeviceTraces.ts"
  - "app/api/members/me/**"
  - "app/api/auth/apple/**"
  - "components/auth/DeleteAccountSheet.tsx"
  - "app/legal/delete-account/**"
  - "__tests__/member-purge*.test.ts"
  - "__tests__/group-account-delete.test.ts"
  - "__tests__/apple-token-canary.test.ts"
  - "__tests__/players-purge-one-miss.test.ts"
---

# Account deletion

<!-- Moved word for word from the root CLAUDE.md on 2026-11-09 (step 2 of the trim), to keep the always-loaded file short. -->

`DELETE /api/members/me` — App Store Guideline 5.1.1(v) requires it, and PIPEDA does independently. Distinct from the admin `DELETE /api/members`, which is admin-gated and only sets `active: false`.

**The rule: remove the person, keep everyone else's records correct.** A naive purge deletes every row the member wrote, which is wrong here because the records are SHARED — a `players` row is one line of a cost split, and a `gameResults` row holds four names. So member-scoped data is DELETED and shared history is ANONYMIZED to `TOMBSTONE_NAME` ('Former member'): arithmetic preserved, person not identifiable. The ACTIVE session is the exception — that row is soft-removed rather than anonymized, because a ghost holding a seat keeps a real person on the waitlist.

`lib/memberPurge.ts` owns it, table-driven across three lists (`OWNED`, `CLASSIFIED_ELSEWHERE`, `NOT_MEMBER_SCOPED`) with partition keys recorded as DATA — the mock ignores the PK argument, so a wrong value passes CI and no-ops in production. `__tests__/member-purge-coverage.test.ts` fails the build when a container appears in none of the three lists, and **it resolves single-level `const` aliases**: `authHandoff`/`authMigration` write `const CONTAINER = '…'`, were invisible to a literal-only scan, and `authhandoff` (which parks a `memberId`) therefore survived a deletion request in the first cut.

**Sign in with Apple is revoked at Apple first** (2026-09-15, Apple's rule for apps offering it): `purgeMember` reads the member's `apple:<sub>` identity BEFORE its loop deletes `identities`, and `revokeAppleIdentity` (`lib/appleRevoke.ts`) sends the stored refresh token to Apple, then forgets it whether or not Apple accepted — a failure lands in `failed` as `apple:revoke` and never blocks the deletion. Disconnecting Apple does the same. The token lives in its own `apple-refresh:<sub>` doc with NO `memberId` (for a new account the identity row does not exist yet at the callback), and `__tests__/apple-token-canary.test.ts` pins it to its files. The client-secret JWT is hand-signed there because arctic keeps its own private — `dsaEncoding: 'ieee-p1363'` is load-bearing and asserted.

**A name is matched only in the club where it was theirs** (audit, 2026-11-05, `__tests__/group-account-delete.test.ts`). `purgeNamesFor` reads the person's roster name in each club BEFORE the purge deletes the memberships, and every by-name match — legacy `players` rows, `gameResults`, `skills`, unowned aliases — keeps a row only when its club's name for them is the row's name; a row carrying another member's id is never theirs. Before, a deletion with groups on anonymized (and, for `skills`, deleted) another club's Lin. The seat is freed in EVERY club's active session, not only the one the request came from; the pay-to of a club they organised is cleared (`clearGroupPayTo`); their name leaves jobs they strung for others, payment suggestions in the review queue and uncollected join requests; reports are signed with `memberId` so a deletion finds them by id; and the delete sheet clears the badge, shortcuts and widget pass (`clearDeviceTraces`), as sign-out does.

Two consequences worth knowing: the anonymized `players` row has its `deleteToken`, `pinHash` and `memberId` stripped (an anonymized row keeping a live credential is the strip-canary rule at rest), and purging `events` LOWERS the Value-Hub Slice-0 metric — the caveat is repeated at the point the number is read in `app/api/admin/slice0/route.ts`.
