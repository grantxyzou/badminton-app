# Multi-group — several clubs in the one deployment

**Track:** Reach (ROADMAP track 4). This is the *explicit choice* the LOCKED
block reserved for Stage-2 (#81): multi-GROUP inside the one deployment, not the
SaaS the April memo costed — no billing, no marketing site, no super-admin plane.
**Status:** in-flight (Phases 0–4 landed and the production backfill ran on 2026-09-10 — BPM is group #1, 72/72 memberships, `mismatched: 0`. The flag went ON in production on 2026-10-22 (#700), the same day the backfill re-run read `mismatched: 0` (Decisions, 2026-10-22); what remains is the clean-week review below. Phases 5–6 in `docs/superpowers/plans/2026-09-07-multi-group.md`)
**Review on:** 2026-11-25 — has a SECOND club been created and run one session end to end (created, invited someone, they signed up, the session settled)? If not, move this date a month on and do NOT ask Grant about leaks. If so, read `leaks` on `GET /api/admin/migrate-groups`: zero means set `TOLERATE_UNSTAMPED` to false and stop dual-writing `Member.role`; anything else names the container and the club that asked.

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
- **Removal does not revoke the cookie, and the Phase 5 gate has to say so**
  (raised in review of #373, 2026-09-11; CLOSED 2026-10-21 — members-only
  took the first of the three candidates below without this plan noticing:
  every club read now goes through `requireMember`, which with the flag on
  re-reads the membership in the cookie's claimed group on every request and
  refuses anything but `status: 'active'`, and `isAdminAuthedWithMember` does
  the same for every admin write. A removed member's cookie stops working at
  once. The hot-path round trip the architecture rejected was paid for a
  different reason — a removed person's 30-day cookie reading the roster was
  the members-only bug of 2026-09-13 — and it closes this one for free). `DELETE /api/groups/members/
  [memberId]` flips a membership to `removed` and frees the roster name, but the
  session cookie it was removed from keeps its `groupId` claim. `resolveGroupId`
  reads that claim without a database check — deliberately, and the reasoning in
  `lib/groupContext.ts` is sound: the claim was verified against a membership
  when it was MINTED, and re-reading on every request buys a Cosmos round trip
  on every hot path for a check already made. `requireGroupMember` is the only
  thing that re-checks, and it has one caller (`GET /api/groups/current`). So a
  removed player's app keeps serving that club's session, roster, announcements
  and costs for up to the 30-day cookie TTL.

  This is not a defect in #373. It is a documented trade-off meeting a
  capability that did not exist when it was made: before Phase 3 there was no
  way to leave a roster, so "verified at mint" and "verified now" could not
  diverge. Phase 3 is what makes membership revocable, and revoking a stateless
  signed cookie needs state on the read path — exactly what that comment
  refuses.

  **Not fixed here, because the fix is a design choice with real cost**, and the
  three candidates trade differently: a membership read on the hot path (honest,
  and the thing the architecture rejected); an epoch stamped into the cookie and
  bumped on removal (one read, but of what, and where); or routing only the
  genuinely sensitive group reads through `requireGroupMember` (cheap, narrower
  blast radius, a judgement call per route). **It belongs on the Phase 5 gate
  next to the clean week of `[group-leak]`** — the flag is off, so nothing is
  exposed today, and it must be answered before the flip rather than after.
- **An app string and a club string are different things, and the test for
  which is who the sentence is about** (Phase 4). "Add X to your home screen"
  is about the software; "you owe X $12" and the memo on an e-transfer are
  about the people you play with. The product resolves from `lib/brand.ts`, the
  club from `Group.name`, and where a caller cannot say which club it is, the
  fallback is the PRODUCT name rather than any particular club's — naming a
  club we are not sure of is a guess, while naming the app is simply true.
  The exempt sites are club DATA, a format or the mark itself, not brand:
  the dev seed and the backfill both write group #1's own name into a durable
  document, the OG card renders the club whose public URL it is, the gift-code
  prefix and the default racket colourway carry the letters, and the design
  preview shows the mark. `__tests__/i18n/brand-canary.test.ts` holds the
  line — scanning string LITERALS for the name as a whole word since the name
  became three letters that are also the group id.
- **The name itself is still Grant's, and Phase 4 did not invent one** (Phase
  4). `APP_NAME` read `'BPM Badminton'` until 2026-10-22 because that was the
  honest status quo; a placeholder chosen here would have shipped a name nobody
  picked. Everything else in the phase is what made the rename a one-line edit
  rather than a sweep — which is what it was, below.
- **2026-10-22 — the app is "BPM" and the club is "BPM Core" (Grant: "to
  avoid confusion I think we should change the group name to BPM core. The
  APP would be BPM (short for Badminton Per Management)").** `APP_NAME` is
  `'BPM'`; the manifest, the document title, the native display names and
  every `%APP%` token follow it. Group #1's record is the club's name and is
  NOT rewritten by the rename: the dev seed and the backfill's creation now
  write `BPM Core`, and the LIVE record is renamed from a new Admin → Club
  name card (`PATCH /api/admin/settings { groupName }` → `Group.name`), which
  Grant does once. Flag off, nothing in the app reads `Group.name` yet, so
  members keep seeing the app's name where the club's will go at the flip.
  Three stray literals that named the product (the chunk-error screen, the
  migrate page title, the wordmark's label) now read the constant.
- **The legal copy's "one group" claims are NOT a brand edit and were left
  alone** (Phase 4). `messages/*.json` tells a reader the app "is a sign-up
  sheet for one casual badminton group in Vancouver, BC", "run by the group's
  organiser, Grant Zou, as an individual — not a company", and "a free tool one
  group uses". Those are factual claims in a privacy policy and terms of use,
  and each becomes false at the cutover. Rewriting who the data controller is
  once strangers' clubs share one deployment is a decision for Grant and
  possibly a lawyer, not a string substitution — so Phase 4 swapped the product
  NAME through the sentinel and changed no claim. **It belongs on the Phase 5
  gate**, next to the "what does a person in no club see" question: the flag is
  off, so every claim is still true today, and both stop being true on the same
  day.
- **2026-10-06 review: the store listing is still the driver** (Grant: "Yes it
  is"). The other half of the question had answered itself: Phases 0–4 landed
  and the production backfill ran, so the sequencing worry about the Stats
  rebuild is moot. The next read is about the Phase 5 flip and its gates.
- **2026-10-07: the order is multi-group, then pricing — native is already
  done.** Grant asked whether the native app should come first so he could
  "start looking into pricing model or earning methods", or multi-group first
  "so public can use my app then earning". The native app had shipped the same
  morning (`docs/plans/native-shell.md`, live on both stores), which answers the
  first half: today the listing is a public sign on a locked door — a stranger
  who installs reaches Welcome and is asked for an invite code to a club they
  are not in. So the remaining work is Phase 3's onboarding screens, the two
  Phase 5 decisions (the legal copy's "one group, run by an individual" claims;
  what a person in no club sees), the flip, then Phase 6's Demo Club. Pricing
  waits for an outside club to exist — the kill criterion above reads on or
  about 2026-12-02, eight weeks after the listing — and is recorded as intent
  only in `docs/plans/pricing.md`; Decision D in
  `docs/plans/value-hub-slice-0.md` still stands.
- **2026-10-07: the stranger's door is a LINK on the Sign up page, and a
  removed member with other clubs gets a LIST** (both Grant's choices). Phase
  3's screens had been built in September; members-only shipped after them and
  closed the door: a signed-out visitor gets `SignedOutShell`, which took only
  an invite, and the create flow lived in `HomeShell`, which never mounts for
  anyone the server refused — so the live store listing led every stranger to
  "enter an invite code" for a club they were not in. And even with a door, the
  account the create flow makes is on no roster, so the reload after it was
  refused again and the organiser never reached the form. `decidePage`
  (`lib/pageGate.ts`) now tells a stranger from a signed-in member in no club,
  and the shell has a `noClub` mode: three doors for a new organiser (a
  `create` resume skips them and lands on the form), or the person's other
  clubs as a list, over an automatic switch to the oldest — the list costs a
  reused `GroupsPage` and lets them see where they are. Welcome keeps its two
  buttons; "No invite? Start your own group" sits under the invite field. This
  is the members-only half of the Phase 5 question "what does a person
  in no club see": the doors or their own club list, and no club data (every
  club read still refuses them). The members-only-OFF half — a BPM-claiming
  no-club cookie reads BPM through `resolveGroupId`'s default — is untouched
  and still wants Grant's call before the flip.
- **2026-10-09 — Grant confirmed the members-only half.** Asked "if they have
  no group how do they have other groups?", the answer was that "no group" means
  no membership in the group THIS DEVICE's cookie names: a member removed from
  one group who is still in another. Offered the automatic switch to their
  oldest group instead, he kept the list ("Yes"). The doors for a person in no
  group at all were his choice on 2026-10-07. Both are now decided, not
  proposed; the members-only-OFF half above is still open.
- **2026-10-21 review — "why isn't it live?" (Grant). Nothing in the code
  blocks the flip; what is left is operational, and the first step is his.**
  Read against the Phase 5 gate, item by item:
  - *The two decisions the gate waited on are both closed.* The legal copy
    was rewritten for two roles on 2026-10-07 and scrubbed of the operator's
    person and city on 2026-10-21 (`docs/plans/legal-copy-multi-group.md`);
    "what a person in no club sees" closed when members-only became
    permanent on 2026-10-17. And the cookie-revocation item above closed with
    it: members-only re-reads the membership on every request.
  - *The backfill is six weeks stale.* It ran clean on 2026-09-10, but the
    whole window since has run flag-off, and flag-off `POST`/`DELETE
    /api/members` move `Member.active` without touching memberships — the
    exact drift `GET /api/admin/migrate-groups` reports as
    `members.mismatched`. Turning the flag on over a stale backfill is the
    "every roster empty, every admin a 401" failure the dev seeds were
    changed to prevent. So the flip is a RE-RUN first: `GET` → `POST { dryRun
    }` → `POST` → `GET` until every count is zero and `mismatched: 0`. The
    route needs the admin cookie AND the `MIGRATION_KEY` header, so it is run
    from Grant's own signed-in browser, as the first run was; nothing in a
    session here can do it.
  - *Then the flag*, `NEXT_PUBLIC_FLAG_MULTI_GROUP: 'true'` in
    `deploy-next.yml` — a one-line PR, baked at build, server-read. Production
    then watches the App Service log stream for `[group-leak]` for a week; a
    clean week is what lets `TOLERATE_UNSTAMPED` go to `false`, and the
    `Member.role` dual write (kept for rollback) goes with it. The
    `members.find(role === 'admin')` client path the Phase 5 line names is
    already gone — `SetupPage` reads `/api/admin/settings`.
  - *Not a gate for the flip:* the sweep ratchet (`UNSWEPT` 48, shrinking),
    Phase 4's screenshots, and Phase 6's Demo Club, which the STORE needs but
    the flip does not — the first outside club can come through a link.
  So the honest answer is that it is not live because nobody has asked for
  the flag PR, and the re-run that has to precede it is a step only Grant
  can take. The review date above is set two weeks out to ask whether he has.
- **2026-10-22 — the re-run, then the flag.** Grant ran the backfill from his
  signed-in admin browser the next day. Status before: 78 members, 72 with a
  membership, 6 without, **22 mismatched**, every unstamped count zero.
  Dry run and real run agreed exactly: 3 memberships created (active people
  who joined flag-off), 3 created already `removed` (inactive people with
  none), 22 `deactivated` (accounts Grant had turned off since September
  whose membership was still active), 0 rejoined, no collisions, no errors,
  nothing `remaining`. Status after: `withMembership: 78`,
  `withoutMembership: 0`, `mismatched: 0`. The 22 changed nothing anyone
  could see — `requireMember` already refused an inactive account — it made
  the roster agree with the accounts, which is what the flag reads. The flag
  PR followed the same day; the week of `[group-leak]` starts at its deploy.
- **2026-10-24 — leaks are written down, and nobody watches for them until a
  second club has run a session (Grant: "dont ask me to monitor group leak
  until there is a second group created and completed one end to end. Also
  trake what got leaksed").** Two changes. The gate moves: with BPM the only
  club there is no other club's row for a query to let through, so a quiet
  week of logs proved little and cost a person watching a log stream. Strict
  mode now waits for a second club to be created and run one session end to
  end, then for the status read. And every drop is KEPT: `groupScope()`'s JS
  re-check, which already dropped a foreign row and logged `[group-leak]`,
  now also writes one `kind: 'groupLeak'` record per distinct (container,
  asking club, row id) to the GLOBAL `groups` container (`lib/groupLeaks.ts`)
  — the row's id and both clubs, never its contents — and
  `GET /api/admin/migrate-groups` reports them as `leaks` (total, newest 25).
  A failed read of them says `read_failed`, never zero, because zero is the
  answer the switch waits for. Reading the route for this found it admitted
  ANY club's admin once groups were on, and its status is deployment-wide
  (every club's counts, and leaks naming two clubs), so `GET` and `POST` are
  operator-only now — an admin of BPM, as `GET /api/reports/feedback` is.

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
