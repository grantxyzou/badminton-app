# Multi-group — several clubs in the one deployment

**Track:** Reach (ROADMAP track 4). This is the *explicit choice* the LOCKED
block reserved for Stage-2 (#81): multi-GROUP inside the one deployment, not the
SaaS the April memo costed — no billing, no marketing site, no super-admin plane.
**Status:** in-flight (Phase 0 landed; phases 1–6 in `docs/superpowers/plans/2026-09-07-multi-group.md`)
**Review on:** 2026-10-05 — Has the Stats racket-fit rebuild merged and Phase 1 (the sweep) started, or is the sequencing decision stale? And is the store listing still the driver?

## Problem

Grant, 2026-09-07, asked what the app needs "to be able to go live on mobile
application stores", and answered it himself in the same message: "it needs to be
able to have multiple groups."

Nobody outside has asked for this, and that is worth stating plainly — the same
posture as `native-shell.md`. The reason is structural rather than reported: a
public App Store / Play listing means strangers install the app, and today a
stranger who opens it lands in BPM's roster with nowhere to go. The only way in
is an organiser pre-seeding your name, which cannot happen when the organiser
has never heard of you. The driver he gave is two-fold: strangers will download
it, AND this is step one toward `../saas-productization-findings.md`.

What the code assumed on 2026-09-07 (verified by two exploration passes): 23
containers, none carrying a scope beyond `sessionId`; every identity path keyed
by display name in one flat namespace; one active-session pointer; a date-only
session id that would 409 when two clubs play the same date; three fixed
`clubSettings` ids; a global admin flag on `Member`; and a mock store that
silently ignores an unrecognised query parameter, so an isolation test written
against it would have passed vacuously.

## Kill criterion

Either of these, and the doors go back behind the flag while the schema stays
(it is additive and the backfill is harmless):

- A confirmed cross-group data leak in production. One. There is no acceptable
  count.
- Eight weeks after the store listing goes live, no group other than BPM and the
  App Review demo group has held a second session. Then the store was a listing,
  not a product, and the PWA plus BPM as a single club was the right shape.

## Non-goals

- Billing, a marketing site, a super-admin plane, per-tenant subdomains — the
  April memo's SaaS. Deferred, not rejected; the data model is built so they can
  arrive without another migration.
- An approval queue for joins. Anyone with the link is in; the link is the gate.
- Group discovery or browsing. Groups are private.
- Ownership transfer UI. Owner deletion reassigns ownership deterministically;
  a voluntary hand-over waits for someone to ask.
- Multi-sport. `sport` is stored so the door exists, and it only ever reads
  `'badminton'`.

<!--
Everything above is the gate for starting. Everything below is appended as the
work proceeds. Architecture, env vars and conventions live in CLAUDE.md — link,
don't copy.
-->

## Decisions

- **One account, many groups** (2026-09-07) over one-account-per-group.
  `Member` stays the person — one email, one PIN, one gear bag, one skill
  history — and a `memberships` row carries the per-group role. The alternative
  was the simpler migration (stamp `groupId` on `Member`) and it lost because it
  breaks the `identities` container's one-email-one-member atomicity and
  duplicates gear and stats for anyone who plays at two clubs.
- **Invite link or code, no approval queue** (2026-09-07). First launch offers
  "Create a group" and "Join with a link or code". Preserving today's
  "organiser pre-vets the roster" feel via a pending-request queue was offered
  and declined: it adds a waiting state for the joiner and a queue UI for the
  organiser, and the link already IS the vetting.
- **A new product name; BPM is a group inside it** (2026-09-07) over keeping
  BPM as the app brand. Name is Grant's, set in one constant. Bundle id, `/bpm`
  basePath, the `bpm://` scheme and the `.bpm-*` CSS classes stay — they are
  infrastructure, not brand, and the first Play upload fixed the package name.
- **Group resolved from a cookie claim plus a membership check** (2026-09-07)
  over a path segment or a subdomain. No URL structure change: the native shell
  loads one origin, and the PWA deliberately keeps state out of the URL because
  iOS restores the last URL on cold start. Invite links carry `?join=<token>`,
  consumed and stripped exactly like `?tab=`.
- **Stats racket-fit rebuild goes first; only Phase 0 lands alongside it**
  (2026-09-07). The Phase 1 sweep touches ~100 call sites and would rebase over
  every Stats merge. Two workstreams at once overrides the WIP cap; Grant's call.
- **`groupId` is a filtered FIELD, never a partition key; BPM's ids are never
  rewritten** (Phase 0). Cosmos keys are immutable, and a rollback runs older
  code against the same database. Only a NEW group gets a `${groupId}:` prefix.
- **Tolerate-then-flip over stamp-first** (Phase 0, questioned in review). The
  alternative — backfill `groupId: 'bpm'` onto every row BEFORE Phase 1 and use
  plain equality from day one — needs no dual mode at all. It lost on the
  rollback window: a rollback runs OLDER code, which writes rows with no
  `groupId`, and under plain equality every one of those rows vanishes from
  BPM's history until somebody notices and re-runs the backfill. Tolerance
  keeps them readable through any rollback, and the idempotent backfill is
  re-run after one. The cost is real and accepted: the Phase 5 flip changes
  the meaning of every scoped query in one deploy, so its gate is the status
  read showing ZERO unstamped rows for a week, not a calendar date.
- **A ratchet test, not ESLint, guards raw container access** (Phase 0
  decision, Phase 1 mechanism). A second `no-restricted-syntax` block for the
  same files silently replaces the design-token rules — the documented trap.
- **PIN-only sign-in with no group context searches memberships across groups**
  and succeeds only on exactly one PIN match (Phase 2). Most BPM members arrive
  on a new device via the shared sign-up link, which now carries the join token,
  so this path is the exception rather than the door.

## Shape

| Piece | Where |
|---|---|
| Container classification (GROUP / PERSON / GLOBAL) + id helpers | `lib/groupScope.ts` |
| Coverage canary (every container classified once; agrees with `lib/memberPurge.ts`) | `__tests__/group-scope-coverage.test.ts` |
| Mock store honours `@groupId` | `lib/cosmos.ts` · `__tests__/mock-store-groupid.test.ts` |
| Flag | `lib/flags.ts` `NEXT_PUBLIC_FLAG_MULTI_GROUP` (server-read; off = today) |
| Types (`Group`, `Membership`, `MembershipRole`, additive `groupId?`) | `lib/types.ts` · `lib/kudos.ts` |
| Design | `docs/superpowers/specs/2026-09-07-multi-group-design.md` |
| Phase plan | `docs/superpowers/plans/2026-09-07-multi-group.md` |
