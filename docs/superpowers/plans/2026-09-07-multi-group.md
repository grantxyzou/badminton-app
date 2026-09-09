# Multi-Group Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Intent:** `docs/plans/multi-group.md` · **Design:** `docs/superpowers/specs/2026-09-07-multi-group-design.md`

**Goal:** Several independent clubs in the one deployment, each invisible to the others, so a stranger who installs the store app can create or join a group — with BPM, the one club in production, unaffected until the flag flips.

**Every phase:** a PR (or two) behind server-read `NEXT_PUBLIC_FLAG_MULTI_GROUP`; `npm test` (read the file COUNT), `npm run lint` (0 errors), `npx tsc --noEmit` green; schema additive-and-optional; BPM's ids never rewritten. Before each phase branch: `git pull`, `gh pr list --state merged --limit 5`, `ListAgents`, work in a worktree. Wait for `claude-review` on each PR. **Sequencing:** the Stats racket-fit rebuild lands first; Phase 1 starts only after its PRs merge.

## Phase 0 — intent, flag, classification, mock (no behaviour change) — DONE 2026-09-07

- [x] `docs/plans/multi-group.md`, this plan, the design spec
- [x] `lib/groupScope.ts`: `GROUP_SCOPED` / `PERSON_SCOPED` / `GLOBAL`, `groupDocId`, `sessionPrefix`, `matchesGroup`, `TOLERATE_UNSTAMPED`
- [x] `__tests__/group-scope-coverage.test.ts` (every container classified once; agrees with `lib/memberPurge.ts`), `__tests__/group-scope.test.ts`
- [x] Mock store honours `@groupId` via `matchesGroup`; `__tests__/mock-store-groupid.test.ts`
- [x] Flag in `lib/flags.ts`, both workflows, `dev:next`, `.env.local.example`; `__tests__/flags.test.ts`
- [x] Types: `Group`, `GroupSettings`, `Membership`, `MembershipRole`; additive `groupId?` on the group-scoped doc types
- [x] `ROADMAP.md` LOCKED line rewritten (deliberate strategy edit); `CLAUDE.md` Groups section; comment on #81

## Phase 1 — data layer, bpm-only (after the Stats PRs merge)

Goal: every GROUP_SCOPED read/write goes through `groupScope(groupId)` with `resolveGroupId(req)` stubbed to `'bpm'`. Two PRs.

- [x] 1a-i (PR #347) `lib/containers.ts` registry (the "decide first" item: partition key, scope, reason, provisioned in one place; `ensureContainer` derives its path from it); `lib/groupContext.ts` (`resolveGroupId`, `resolveGroupIdFromCookieHeader`, `noActiveSession`); `getActiveSessionId(groupId) → string | null`, `setActiveSessionId(groupId, id)`, `sessionIdFromDate(iso, groupId)`, pointer id via `groupDocId`; the 25-file pointer sweep with per-site null policy (404 `no_active_session` for reads/writes that need a session; empty for lists; `''` for exclusion comparands and best-effort mirrors; the advance route is the one caller that WANTS null)
- [x] 1a-ii (PR 3) the accessor `groupScope(groupId)` — `query` (a builder: with-WHERE, no-WHERE, ORDER BY, LIMIT, projections gain `c.groupId`, `sessions` reads exclude the group's own pointer doc), `count`, `read`, `create`, `upsert`, `remove`; every row JS-verified, `[group-leak]` sentinel; the ratchet in `__tests__/group-scope-coverage.test.ts` (`MIGRATION_BACKLOG` only shrinks). The whole session family swept (49 → 18 backlog files, all remaining for 1b); `lib/kudosEligibility.ts` takes the group and uses `sessionPrefix`; the six `@sid` bindings are `@sessionId`; three `>=` cutoffs are built per group; the insight cache doc is `groupDocId(groupId, memberId)`; the level fold is per group with a per-group cache
- [ ] 1a **two-group route-level isolation sweep** — needs a real second group, which needs `resolveGroupId` to read a claim (Phase 2). Until then the accessor's own two-group tests are the proof.
- [x] 1b (PR 4, 2026-09-09) the rest — `MIGRATION_BACKLOG` is EMPTY: `birds` (`resolveBirdUsages(raw, scope)`, both birds routes, `session/bird-usage`), `aliases` (`resolveIdentity(arg, groupId)`, the aliases route, member history), `kudos` (the route's dedupe read, create and GET; `@recipientMemberId` / `@raterMemberId`, names the mock knows), `stringingJobs` (the bench's three reads, the per-group job-number count, PATCH/DELETE/accept through `read` + `upsert` + `remove`, requests, `players/unpaid`'s charges), `clubSettings` (`shopDocId` / `stringsDocId` / `pricingDocId`; the three readers take the group), `events` (`writeEvent(evt, groupId)`, `slice0`'s read). Gate: `__tests__/group-isolation-1b.test.ts` seeds a `groupId: 'other'` row per container and reads as BPM
- [ ] 1b→2 `stats/club/bands`, `stats/club/gear` and the level fold's self-seeds narrowed via `rosterMemberIds()` — needs `memberships`, so it lands in Phase 2 with them
- [ ] Ratchet list EMPTY; existing suite unchanged; `verify-ui` on Home / Sign-Ups / Admin with `SEED_DEV_SCENARIO=fresh-thursday`

## Phase 2 — identity: groups, memberships, cookie claim, roles, backfill

- [ ] `lib/groups.ts`: `ensureContainer` for `groups` `/id` and `memberships` `/groupId`; `createGroup`, `addMembership`, `reserveRosterName`, `readMembership`, `listMemberships`, `reassignOwnership`
- [ ] SAME PR: `lib/memberPurge.ts` rows (`memberships` + reservations OWNED with `pk: '/groupId'`; `groups` CLASSIFIED_ELSEWHERE) AND `CLAUDE.md`'s Cosmos bullet ("There are 25 containers", `groups` under `/id`, a `/groupId` line) — `docs-canary` fails otherwise; `lib/groupScope.ts` tables gain both
- [ ] `lib/auth.ts`: `SessionPayload.groupId?`; mint functions take `groupId`; `verifyMemberAuth` returns it; `isAdminAuthedWithMember` → membership read when the flag is on; async `requireGroupMember(req)`; `lib/authSession.ts` `completeSignIn(res, member, groupId)`; the four direct mint sites
- [ ] `lib/memberResolve.ts` `(groupId, name)`; `members` roster = memberships; `members/me` + `lib/useHasPin.ts` probe scoped; `players` invite gate = membership; `admin/route.ts` `ADMIN_NAMES` only for `'bpm'`; `admin/settings` → `groups.settings` with legacy fallback; `SetupPage.tsx` reads the endpoint
- [ ] No-context PIN sign-in across memberships (exactly-one rule); owner deletion reassigns
- [ ] `app/api/admin/migrate-groups/route.ts` (`GET` status, `POST {dryRun}`, `MIGRATION_KEY`), `__tests__/migrate-groups.test.ts` (idempotence, etag conflict)
- [ ] Helpers: `seedGroup`, `seedMembership`, `adminCookieValue({ groupId })`, `memberCookieValue(name, memberId, groupId)` defaulting to `'bpm'`; `__tests__/group-isolation-sweep.test.ts` first entries
- [ ] Dev seeds stamp `'bpm'` and seed the group + memberships; `lib/authHandoff.ts` / `lib/authMigration.ts` stash `groupId`
- [ ] Prod: deploy flag-off → `GET` → dry run → run → `GET` zeros. Flag stays OFF.

## Phase 3 — group lifecycle API, onboarding, invites (flag on in dev/CI)

- [ ] `app/api/groups/{route,join,preview,switch,mine,invite,current}`, `app/api/groups/members/[memberId]`
- [ ] `components/onboarding/{WelcomeDoors,CreateGroupSheet,JoinGroupSheet}.tsx`; `components/profile/GroupsSheet.tsx`; `components/admin/CommandCenter/InviteCard.tsx`; `lib/useInviteLink.ts`, `lib/useCurrentGroup.ts`; i18n `onboarding`, `groups` (restart dev server)
- [ ] `HomeShell` `?join=` in the URL-param block; doors when flag on and no identity; `Identity.groupId?`; Profile row; `AdvanceSessionForm` + `NextSessionCard` link via `useInviteLink()`; `HomeTab` no-session state; sign-ups-open push → `rosterMemberIds()` (test: never unnarrowed); `lib/sheetStack.ts`; `NativeBridge` `?join=` test
- [ ] Isolation sweep extended to kudos, stringing, birds, aliases, games, stats/club/*, anomalies, owed-audit, slice0
- [ ] `verify-ui`: create → first session → advance → share → join in a second profile → switch

## Phase 4 — brand

- [ ] `lib/brand.ts`; `brandMessages()` in `i18n/request.ts`; `__tests__/i18n/brand-canary.test.ts`
- [ ] `app/layout.tsx`, `app/manifest.ts`, `app/opengraph-image.tsx`, `capacitor.config.ts` `appName`, the email senders, `lib/pushMessages.ts`, `lib/aiPersona.ts` (from `APP_NAME`; group name as call-time context; no new Claude callers), `lib/receiptTemplate.ts` memo → `groups.settings.receiptMemo`
- [ ] Legal arrays rewritten in both locales; keep every needle `__tests__/legal-pages.test.ts` pins; read `PRODUCT.md`, `README.md`, `docs/OWNER-KB.md` for "one group" CLAIMS
- [ ] Screenshots: splash, Home, Profile, `/legal/privacy` both locales; OG image

## Phase 5 — hardening, cutover, docs

- [ ] `TOLERATE_UNSTAMPED = false` after a week of prod zeros; stop dual-writing `Member.role`; delete the `members.find(role==='admin')` client path; flag `'true'` in `deploy-next.yml`
- [ ] Sweep-coverage canary (every route touching a GROUP container is in the sweep); suite-wide `[group-leak]` spy
- [ ] `CLAUDE.md` Auth + Session Pointer + Groups sections; `ROADMAP.md` §4; `CHANGELOG.md`; intent doc Decisions + Shape, `Status: shipped`; `scripts/smoke-prod.mjs` two-group read

## Phase 6 — store

- [ ] Demo Club in prod through the real UI (`settings.demo: true`, permanent invite, reviewer PIN, one open session, fixture roster)
- [ ] `native/README.md` listing copy + review notes; store metadata; `NEXT_PUBLIC_FLAG_NATIVE_MIGRATE` on once the listing exists
- [ ] On device: install → doors → join Demo → sign up → Stats; PWA→shell migration lands in the same group
