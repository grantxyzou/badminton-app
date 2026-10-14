# Container fold — three cheap merges to get the shared database off its cap

**Track:** infrastructure baseline (`docs/plans/infra-baseline.md`, `docs/azure.md` §10) — the multi-group launch needs a database that can still take a container when a feature genuinely needs one, and a bill that is one Cosmos minimum, not two.
**Status:** in-flight
**Review on:** 2026-10-28 — have the `aliases`, `feedback` and `authmigration` containers been deleted in the portal, does the Cosmos total read 400 RU/s, and has `GET /api/admin/migrate-containers` reported zero remaining before each deletion?

## Problem

Grant read the Cosmos portal on 2026-10-14 (`docs/azure.md` §9): the `badminton`
database holds the 27 containers the code defines; 26 share its 400 RU/s and
`aliases` carries its own 400 RU/s, so the account bills **800 RU/s** for
3.7 MB of data. The shared database is at Microsoft's 25-container cap — the
2026-10-10 `stringStock` create was refused (`docs/plans/string-inventory.md`),
and the next feature that needs a container will be too.

Grant, 2026-10-14, on being shown which merges are cheap: *"do the three
cheap ones, write the plan doc first."* The three:

1. `authmigration` into `authhandoff` — both five-to-ten-minute auth stashes,
   both `/id`, both PERSON scoped. Nothing to backfill: a doc lives minutes.
2. `feedback` into `releases` — both GLOBAL, both `/id`, a few dozen rows each.
3. `aliases` into `clubSettings` — both GROUP scoped, both `/id`. The only one
   of the three that moves the bill: `aliases` is the dedicated container.

A filing cabinet costs rent and has one lock design (its partition key) and
one shredding schedule (its TTL); a folder inside it is free. These three
rent a cabinet each for a folder's worth of paper.

## Kill criterion

If a copy run reports `remaining > 0` that a second run does not clear, or if
any alias, report or release is unreadable after the switch, the readers'
fallback to the old container is kept and the old containers are NOT deleted
— the fold stops at "two homes, one authoritative" and this file says so. The
fold has failed if, by the review date, the portal still bills 800 RU/s.

## Non-goals

- The `/memberId` and `/sessionId` merges (six and four slots). They are
  where the backfill risk lives, nothing today needs the slots, and the
  shared pool costs the same at 8 containers as at 25. Listed in
  `docs/azure.md` as the next step IF a slot is ever needed.
- Renaming a container. Cosmos has no rename; `releases` keeps its name and
  grows a `kind`, which is cheaper than a new container plus a copy.
- A TTL on `authhandoff`. Both stashes expire by `expiresAt` in code; a
  container TTL would be belt to that brace and is a portal setting Grant can
  add later, recorded in `docs/azure.md` §9 if he does.
- Touching `Player.paid`, the ledger, or any money row. Aliases are a lookup
  table the payments inbox reads; the fold changes where it is read from and
  nothing about what a match means.

<!-- Everything above is the gate for starting. Everything below is appended as
     the work proceeds. -->

## Decisions

- **`feedback` goes into `releases`, not `clubSettings`.** The first sketch
  said `clubSettings` and was wrong on scope: a report goes to the OPERATOR,
  not a club admin (`lib/containers.ts`), and `clubSettings` is GROUP scoped —
  `groupScope()` would stamp and filter by club, and the raw read the
  operator report uses is a build error on a group container. `releases` is
  the GLOBAL `/id` container that already exists, so it becomes the
  operator's cabinet: the changelog and the problem reports, both app-level,
  both written by whoever runs the deployment. `groups` (also GLOBAL `/id`)
  was the alternative and lost: it is the club registry with `IfMatch`-raced
  invite docs, and should stay single-purpose. This frees one shared slot,
  not the two the sketch counted.
- **Two PRs, one copy run, no gap.** PR 1 (this one) adds a `kind` to each
  moved doc, writes NEW rows only to the new home, and reads the new home
  UNION the old one — deduplicated by id — so nothing is unreadable between
  deploy and copy. The same PR ships `GET`/`POST /api/admin/migrate-containers`
  (admin cookie + `x-migration-key`, the `migrate-groups` gate, shared through
  `lib/migrationKey.ts`): `POST { dryRun }` copies every old row into its new
  home under its OLD id (a second copy 409s and is counted `existing`) and
  stamps `kind: 'release'` on the bare release rows; `GET` reports, per move,
  how many old rows have no copy yet. PR 2, after `GET` reads zero: delete the
  union reads, the route, the old registry and purge entries; then Grant
  deletes the three containers in the portal. Beat a single PR with a feature
  flag (two code paths to test for a one-day window) and beat "copy first,
  switch later" (two deploys with a window in which a new alias lands in a
  container nobody reads).
- **Touching a legacy row moves it.** During the window an admin's PATCH or
  DELETE on an alias that exists only in the old container finds it through
  the fallback read, writes the result to the new home and removes the old
  row. So the copy route has less to do each time it runs and a row can never
  be edited in a home that is about to be deleted.
- **A `kind` on every row in a shared cabinet, checked on every read.**
  `alias` in `clubSettings` (beside `stringPurchase`, the gift cards and the
  three singletons), `feedback` and `release` in `releases`, `handoff` /
  `link` / `short` in `authhandoff`. A point read verifies the kind too, so
  the alias route cannot PATCH a gift card by id and a handoff ref cannot
  redeem a migration doc. The query filter is a LITERAL (`c.kind = 'alias'`),
  as `readStringPurchases` does it: the mock store filters by parameter name
  and knows no `@kind`, so a parameter would read as "no filter" in tests.
  Each reader re-checks the kind in JS for the same reason.
- **`beginHandoff` refuses a ref that names a foreign kind.** Its
  "first write wins while live" rule would otherwise treat a migration doc at
  that ref as not-live and overwrite it. Only the holder of a migration link
  can compute that ref, so the harm was self-inflicted, but a refusal costs
  one comparison.
- **`clubSettings` and `releases` move to `CLASSIFIED_ELSEWHERE`.** They were
  `NOT_MEMBER_SCOPED`; an alias names a member's bank legal name and a report
  carries a name and an IP, so that label would now be false. `purgeAliases`
  and `anonymizeFeedback` handle the kinds, over both homes until PR 2.
- **Alias ids.** New rows are `alias-<24 hex>` so a `clubSettings` listing
  reads; copied rows keep their old 24-hex id, because the admin screen holds
  ids in flight and a rename would 404 an edit mid-copy. No id shape in
  `clubSettings` collides with either.

## Shape

| Piece | Where |
|---|---|
| Alias reads, writes and the union fallback | `lib/aliases.ts` (`readAliases`, `readAlias`, `createAlias`, `updateAlias`, `removeAlias`) — the seven `scope.query('aliases')` sites call it |
| Feedback writes, the report read, anonymisation | `lib/feedback.ts` |
| Migration stash in the handoff container | `lib/authMigration.ts` (`CONTAINER = 'authhandoff'`, kind-checked reads); `lib/authHandoff.ts` (`kind: 'handoff'`, foreign-kind refusal) |
| The copy and its status | `lib/containerFold.ts` (raw access; on `RAW_ACCESS_ALLOWLIST`), `app/api/admin/migrate-containers/route.ts` |
| The key gate, shared | `lib/migrationKey.ts` (from `migrate-groups`) |
| Registry and purge | `lib/containers.ts` (old containers marked legacy until PR 2), `lib/memberPurge.ts` |
| Tests | `__tests__/container-fold.test.ts` (copy, status, union, kind checks), the existing alias / feedback / migration tests pointed at the new homes |
| Record | `docs/azure.md` §3 and §9, `CLAUDE.md` container list, `CHANGELOG.md` |

**Prod order:** deploy PR 1 → `GET /api/admin/migrate-containers` → `POST { dryRun: true }` → `POST { dryRun: false }` → `GET` reads zero remaining → PR 2 → deploy → delete `aliases`, `feedback`, `authmigration` in the portal → portal total reads 400 RU/s → record in `docs/azure.md` §9.
