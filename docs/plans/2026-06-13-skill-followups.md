# Skill-accuracy follow-ups — gear rewiring, drills, kudos

## Context

The skill-accuracy **spine** (canonical level → game calibration → progression
stability, Phases 1–3) is merged to `main` and soaking on `bpm-next`. It exposes
one server-only entry point — `getCanonicalLevel({ memberId, name })` in
`lib/levelStore.ts:127` → `CanonicalLevel { level 1–5, stage 1–6, phase,
confidence, basis, blindSpot, pendingPromotion }`.

Three follow-ups were deliberately deferred out of the spine. This plan designs
them as independently-shippable, flag-gated phases that build on that entry
point. Locked decisions carried over: numeric peer rating is **cut** (kudos
replaces it, positive-only); levels/blind-spots/kudos are **private**
(member-or-admin); deterministic engines + separate Claude narration (Decision
B2); additive-only schema (stable & next share one DB).

**Build order (dependency-driven):** gear rewiring → drills → kudos. Only gear
touches the spine's output contract; drills and kudos are independent of each
other. Net new flags: **2** (`SKILL_DRILLS`, `KUDOS`); gear reuses
`VALUE_HUB_SLICE` (flag debt 10 → 12).

---

## Phase A — Gear rewiring (reuse `NEXT_PUBLIC_FLAG_VALUE_HUB_SLICE`)

**Goal:** gear recommendations ride the accurate canonical level instead of the
rarely-set `Member.stage`. Smallest, no new container, no new flag — ship first
as a confidence-builder that makes the spine pay off in an already-live surface.

**The change is one file:** `app/api/recommend/route.ts` (today lines 41–52 read
`Member.stage` via a `SELECT c.stage … WHERE LOWER(c.name)=…`). Replace with:

```ts
let stage: number | undefined;
if (name) {
  const subject = await resolveSubject(name);          // members → id, else name:<lower>
  const canonical = await getCanonicalLevel(subject);  // folds assessments + Member.stage (+cal if flagged)
  stage = typeof canonical.stage === 'number' ? canonical.stage : undefined; // null → all-rounder
}
```

- **Reuse** `recommendRacket({ stage, gamesPlayed, catalog })` (`lib/recommend.ts:13`)
  unchanged — it already treats `stage: undefined` as the all-rounder fallback,
  so a `null` canonical stage maps cleanly. `reasonFor(item, stage)` already
  branches on `typeof stage === 'number'`.
- **Reuse** `resolveSubject(name)` (duplicate the ~12-line pattern from
  `app/api/stats/level/route.ts:26–41`; the assessments and level routes each
  already keep their own copy — matches convention).
- **No data-model change.** `Member.stage` stays a fallback *input* inside the
  fold (`fetchLegacyStage`, `lib/levelStore.ts:52`) — never written, never removed.
- **Privacy: confirmed safe.** The route reads only `.stage` (a coarser, derived
  view than the `Member.stage` it replaces) and returns only `{ item, reason }` —
  `basis`/`explanation`/`blindSpot` are never serialized. Recommend stays
  name-keyed/public; rate-limit (`recommend:${ip}`, 10/min) already blocks
  enumeration. Add a code comment; no other action.
- **Play-style inference (smash-heavy → head-heavy): DEFER.** `CatalogItem` has
  no `playStyle` column (it would live in the loose `attributes?` map, unseeded),
  and `getCanonicalLevel` returns only the folded scalar, not per-skill detail.
  Separate slice.

**Tests** (extend `__tests__/recommend-route.test.ts`): member with assessments
but no `Member.stage` → recommends per canonical stage; neither → `stage:null` →
all-rounder; `Member.stage` only → back-compat via `stageToLevel→levelToStage`;
`SKILL_CALIBRATION` on + games → stage reflects calibration. Call
`_resetCalibrationCache()` (`lib/levelStore.ts:121`) between cases; unique
`X-Client-IP`.

---

## Phase B — Drills (`NEXT_PUBLIC_FLAG_SKILL_DRILLS`)

**Goal:** the weakest skills (already computed by `workOnNext`) point at concrete
drills; the AI focus names a real drill.

**Data:** `scripts/data/drill-library.json` — **statically imported, no
container** (read-only reference, no admin editing). Seed *fewer, higher-quality,
`pair`/`group`-biased* drills from a credited public source (e.g. BWF), starting
with the most-common work-on skills rather than all 14 — keep the CI coverage
test scoped to whatever keys ship. Entry shape:
```json
{ "id": "net_play-b2-shadow-kills", "skillKey": "net_play", "band": [2,3],
  "title": "…", "description": "…", "minutes": 10, "setting": "pair",
  "equipment": ["shuttles"], "source": "BWF coaching drills" }
```

**Lib** (`lib/drills.ts`, pure):
```ts
export function recommendDrills(input: {
  workOn: { key: string; label: string; value: number }[];  // === AssessmentTrend.workOn (LabelledRating[])
  level: number | null;
  rotationSeed: string;   // sessionId → same picks all week, fresh next week
  count?: number;         // default 3
}): DrillPick[];
```
`workOn` is structurally identical to `LabelledRating[]` (`lib/assessment.ts:295`)
so callers pass `AssessmentTrend.workOn` straight through. Band = the band
containing the **skill's own `value`** (a 2-rated net player drills net at `[2,3]`,
not their overall). Rotation = cheap hash of `rotationSeed + skillKey`. Empty
`workOn` ⇒ `[]`.

**Route** `app/api/stats/drills/route.ts` — copy the level route's ordering +
gate verbatim: rate-limit (`stats-drills:${ip}`, 60/min) → flag 404 →
`verifyMemberAuth` name-match OR `isAdminAuthed` 403 → `resolveSubject` →
`summarizeAssessmentTrend(docs).workOn` + `getCanonicalLevel().level` +
`rotationSeed = getActiveSessionId()` → `recommendDrills(...)`.

**UI** `components/stats/DrillsCard.tsx` below `SkillTrendCard`: title, minutes +
`setting` chip, why-line ("For your net play, rated 2/5"). Legible-fail error
pill. Optional one-tap 👍/👎 that nudges **local** rotation only (localStorage, no
infra). New setting glyph → add to the icon URL in `app/layout.tsx`.

**AI-insight** `app/api/stats/insight/route.ts`: `buildSnapshot` already has
`trend.workOn` + `canonicalLevel.level` + active session — compute
`recommendDrills`, add `drills` to `Snapshot`, append one line in `buildSkillLine`
and one focus instruction ("anchor the focus on one of these drills by name;
narrate, never select").

**Tests** `__tests__/drills.test.ts` + `__tests__/stats-drills-route.test.ts`:
coverage matrix vs `SKILLS` (typo'd key fails CI); band selection from the
skill's own value; rotation determinism + week-over-week change; empty → `[]`;
route flag/cookie/admin/name-fallback branches.

---

## Phase C — Kudos (`NEXT_PUBLIC_FLAG_KUDOS`) — replaces numeric peer rating

**Goal:** positive-only, post-game peer recognition. Largest (one container, one
flag, write-path anti-abuse) — ship last; it's the only one with social risk +
schema change.

**Data: one new container** `kudos`, PK `/recipientMemberId`, via
`ensureContainer('kudos', '/recipientMemberId')` (lazy, like `ensureGames` in
`app/api/games/route.ts:11`). **Not** the `assessments` container and **not** the
reserved `source:'peer'` field (would break stable's self-trend math). Doc:
```ts
{ id, recipientMemberId /* PK */, recipientName, raterMemberId, raterName,
  sessionId, tag: KudosTag, createdAt }
```
`raterName`/`raterMemberId` are **strip-canaries** like `pinHash` — never in any
GET. Fixed 5-tag set: `great_defense | clutch | most_improved | good_sport | nice_shot`.

**POST** `app/api/kudos/route.ts` — rate-limit (`kudos:${ip}`, 20/min) → flag 404
→ `verifyMemberAuth` **required** (401; rater identity from cookie, never body;
no admin-on-behalf in v1) → validate (`tag ∈ KUDOS_TAGS`, resolve recipient) →
anti-abuse → create:
- no self-kudos (403);
- **co-play proof**: rater + recipient both non-removed in that session's
  `players`, OR together in a `gameResults` doc for the session (403 otherwise) —
  reuses existing co-attendance data, no new tracking;
- one of each tag per (rater, recipient, session) → 409 (single-partition read on
  the PK).

**GET** `app/api/kudos/route.ts` — aggregate, **member-or-admin gated (not
public)**: `{ kudos: [{ tag, count }] }`, rater identities stripped. Single-
partition query by `recipientMemberId`.

**Level coupling: NONE in v1.** Kudos stays purely social — positive-only +
reciprocity-prone in a friend group means any weight is noise bought at social
cost (the reason numeric peer rating was cut). Ship `kudosLevelNudge(total) → 0`
as a reserved seam; leave `deriveLevel`'s `peerLevel` term null/untouched. Any
future wiring must be a tiny capped *confidence* bump gated on distinct raters
across distinct sessions — designed separately.

**UI:** in `components/stats/GameLoggerSheet.tsx`, after the success state
(line 82–83), an optional skippable kudos step — tonight's co-players (names
already in component state) × tag chips, POST per tap, reusing the `<BottomSheet>`
it's already in. Plus a private "Kudos you've received" surface on `ProfileTab`
(per-tag counts, member-or-admin only).

**Tests** `__tests__/kudos.test.ts` + `__tests__/kudos-route.test.ts`:
`aggregateKudos` counts/order, `kudosLevelNudge` returns 0; POST flag-off 404,
name-only 401, self-kudos 403, no-co-play 403, duplicate 409, happy 201, bad tag
400, non-admin sessionId override ignored; GET own/admin 200 with counts, other
403, **strip-canary** (no rater identity in any response); both flag branches.

---

## Social / privacy risks (kudos)

- **Counts private to recipient + admin** — a public kudos leaderboard recreates
  the ranking dynamic the spine's privacy stance forbids.
- **Reciprocity pressure** — skippable, positive-only, no numeric score
  (Strava-kudos model); never surface "X didn't reciprocate".
- **Rater anonymity is weak at N≈6–10** — never expose per-tag rater lists; counts
  only (why `raterName` is a strip-canary).
- **No level coupling in v1** keeps kudos from becoming a covert rating.

## Verification (every phase)

`npm test` (pure-lib + route tests, mock store, unique `X-Client-IP`, both flag
branches) → offline `run-badminton-app` with `SEED_DEV_SCENARIO=fresh-thursday` +
the phase flag (gear: confirm racket shifts vs the stage-only pick; drills: card
names the lowest-rated skill's drill; kudos: send to a co-player, confirm it's
private to them and co-play-gated) → flag-off smoke (surface absent, route 404,
zero stable change) → soak ≥1 session week on `bpm-next` before promotion.

## Flag hygiene

Each new flag = three edits in `lib/flags.ts` (union / record / switch) **plus**
`.github/workflows/deploy-next.yml` (the `check-flag-sync.mjs` hook enforces).
Honor `plannedRemoval`: `SKILL_DRILLS` + `KUDOS` retire two weeks after stable
promotion + `off`-branch deletion.
