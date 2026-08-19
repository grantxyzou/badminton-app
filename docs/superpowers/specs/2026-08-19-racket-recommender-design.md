# Racket recommender — design

**Status:** approved shape, ready for an implementation plan
**Date:** 2026-08-19
**Flag:** `NEXT_PUBLIC_FLAG_RACKET_RECOMMENDER` (off in both workflows)

## Why

`lib/recommend.ts` scores rackets on `Member.stage` — optional, rarely set — plus
a `gamesPlayed` tiebreak. With no stage it returns the widest `skillRange` item,
so in practice every player sees the same racket. It also never excludes what
the player already owns, which is how it came to recommend a member their own
racket, and how it recommends confidently to someone who owns nothing at all.

Meanwhile the check-in already collects **fourteen 1–5 skill ratings** that the
recommender never reads.

Two supplied files close that gap:

- `racket_database.json` — 60 rackets with a **normalized** schema.
- `recommend_racket.py` — a 7-dimension weighted scorer whose `PlayerProfile`
  maps **1:1, in order** onto the app's fourteen assessment keys.

The database also fixes a problem that blocked spec filters earlier: the current
catalog's `balance` holds 6 distinct strings for 3 real values, `flex` 9 for ~5,
and `playStyle` **32 free-text values across 50 rackets**. The new data is clean
(`balance` 3, `flex` 5, `category` 4, `tier` 3).

**Outcome:** a recommendation grounded in signals the player actually gave,
that explains itself, that never suggests a racket they own, and that says
nothing when it knows nothing.

## Decisions

| # | Decision | Rationale |
|---|---|---|
| D1 | Ask **format and budget** in the Equipment tab | The engine's author flagged both as *"NOT inferable from skill scores — must be asked."* All 7 scorers fire. |
| D2 | Build **behind a flag**; do not close #248 | Owner's call. Compare both recommenders on `bpm-next` before choosing. |
| D3 | **Top pick + expandable reasons**, not a ranked list | Keeps the card shape the tab already has and matches `RacketRecCard`'s existing expand interaction. |
| D4 | The 11 legacy rackets are **ownable but not recommendable** | They lack normalized `tier`/`flex`/`category`, so the engine cannot score them honestly. Owning one still works — `current_racket_id` is used only for exclusion, which is id-based. |
| D5 | **No assessment → no recommendation** | With no ratings the engine runs on fourteen 3s and emits a confident, meaningless pick — the failure mode already visible in production. The card instead points at the check-in. |
| D6 | Price is **advisory, never a hard filter** | Prices are USD, stamped `lastVerified: 2026-08-19`, and go stale. A stale price must never silently remove a racket from consideration. Diverges from the Python, which hard-filters on budget. |
| D7 | Budget is expressed in **CAD**, converted at import | The app is Vancouver-based and settles in CAD e-transfers; `CatalogItem.msrp` is already CAD. Asking a Canadian friend for a USD budget is a papercut. |
| D8 | The engine path **requires a member cookie or admin** | See below. This is a privacy gate, not a preference. |

### D8 — why the route's auth must change

`GET /api/recommend` is currently **unauthenticated**: rate-limited by IP,
probing by `?name=`. Its own comment records why that is safe today — it reads
only `canonical.stage` and returns `{ item, reason }`, so "nothing from the
private `CanonicalLevel` leaks through this public route."

The new engine breaks that guarantee. Its reasons **quote the player's
individual skill ratings**:

```
"Head-heavy suits your power game (smash 3/5, clears 3/5)"
"Extra Stiff shaft is demanding for your current consistency (3/5)"
```

Member names are enumerable via `GET /api/members`. Shipping those strings on
an unauthenticated route would expose every player's private per-skill
assessment to anyone who can guess a name — the same defect shape as #249 and
#250, arriving through a third door.

So the flag-on branch adopts the gate `/api/stats/level` already uses:

```ts
const member = verifyMemberAuth(req);
const ownsName = member?.name?.trim().toLowerCase() === name.toLowerCase();
if (!ownsName && !isAdminAuthed(req)) {
  return NextResponse.json({ error: 'forbidden' }, { status: 403 });
}
```

The flag-**off** branch keeps today's unauthenticated behaviour unchanged, since
it still leaks nothing. `RacketRecCard` must therefore handle 403 as a distinct
state, not as "no recommendation" — unknown ≠ known-false.

## Data

### Catalog merge — migration-free

Source ids differ from the app's by exactly a prefix:

```
app:    racket-yonex-astrox-100zz
source: yonex-astrox-100zz
```

Re-prefixing with `racket-` makes **39 of 60** land on existing ids, so
`ensureCatalogSeeded`'s id-idempotent upsert turns the import into a free union:

| | count |
|---|---|
| merge onto an existing id | 39 |
| new rows added | 21 |
| legacy rows untouched | 11 |
| final catalog size | **71** |
| **stored `catalogId` values broken** | **0** |

Verified against both files: of the 39 rows sharing a brand+model, **every one**
also matches by prefixed id — there are no slug mismatches that would silently
create a duplicate row instead of merging.

`scripts/import-racket-db-v2.mjs` performs the mapping, mirroring the existing
`scripts/import-racket-database.mjs`.

### Field mapping

Two traps, both previously hit:

- **Drop the source `partitionKey: "Yonex"`.** The app's partition key is
  `category`, which must remain the literal `'racket'`.
- **Source `category: "Power"` is play style, not the app's `category`.** It
  maps into `attributes.playStyle` — the key the existing importer already uses.

```
id            -> `racket-${source.id}`
category      -> 'racket'                       (partition key — never the source value)
brand, model  -> as-is
skillRange    -> TIER_RANGE, reused from the existing importer:
                   Entry-level [1,3] · Mid-range [2,5] · Premium [4,6]
msrp          -> round(priceMinUSD * USD_TO_CAD)   (CAD, per D7)
attributes    -> balance, flex, weightClass, weightMinG, weightMaxG,
                 playStyle, subType, tier, series, gripSize,
                 tensionMinLbs, tensionMaxLbs, priceMinUSD, priceMaxUSD,
                 lastVerified
sources       -> []                             (no retailer links in source data)
seeded        -> true
```

`USD_TO_CAD = 1.38` — **reused verbatim from `scripts/import-racket-database.mjs`**
rather than introduced fresh, so the two importers can't drift into pricing the
same racket differently. It is approximate by construction; D6 keeps that from
being load-bearing.

### Storage

`PlayerGear` gains two optional fields (additive-only, per the shared-Cosmos
schema rule — `bpm-stable` and `bpm-next` read one database):

```ts
/** "I mostly play" — drives the format scorer. Absent = 'both'. */
playFormat?: 'singles' | 'doubles' | 'both';
/** Upper bound in CAD. Absent = no budget preference (scorer stays neutral). */
budgetMaxCad?: number;
```

## Components

### `lib/racketProfile.ts`

```ts
export interface PlayerProfile { /* 14 skills + format + budget + currentRacketId */ }
export function buildProfile(input: {
  ratings: Rating[];                       // from the latest assessment
  gear: PlayerGear | null;
}): PlayerProfile | null;                  // null when ratings is empty (D5)
```

Owns the 14-key rename table:

```
serves_returns→serves      net_play→net_play        clears_lifts→clears
drops→drops                drives→drives            smashes→smashes
grip_deception→grip        footwork_split_step→footwork
court_coverage→court_coverage                       speed_stamina→stamina
game_reading→game_reading  consistency→consistency
rules_strategy→rules       training_mindset→mindset
```

**Ratings are partial by design** — `validateRatings` accepts any subset of ≥1
skill — so absent skills default to `3`, matching the Python defaults. Returns
`null` only when there are no ratings at all, which is what D5 keys on.

### `lib/racketRecommend.ts`

A direct port of the Python scorers. Pure: no fetch, no catalog read, no clock.

```ts
export interface Recommendation {
  item: CatalogItem; score: number;        // 0–100
  reasons: string[]; warnings: string[];
}
export function recommendRackets(
  profile: PlayerProfile, catalog: CatalogItem[], topN?: number,
): Recommendation[];
```

Seven scorers and weights carried over verbatim — `flex` 1.4, `balance` 1.3,
`category` 1.2, `format` 1.2, `skill_tier` 1.1, `weight` 1.0, `budget` 0.9.
Flex is weighted highest because the wrong flex causes injury and frustration,
not merely a poor match.

Two deliberate divergences from the Python:

1. **Budget never hard-filters** (D6). Over-budget rackets score negatively and
   sink; they are not removed.
2. **Rackets lacking normalized `tier`/`flex`/`balance` are skipped** (D4) —
   the 11 legacy rows. Scoring them would invent values the data does not have.

Excluding the player's current racket is retained, and is the fix for the
"recommends a racket you already own" defect.

### `app/api/recommend/route.ts`

Flag-gated. On: fetch the latest assessment + gear + catalog, build the profile,
return the top pick with reasons and warnings. Off: today's `recommendRacket`,
unchanged. Returns `{ item: null, reason: null, needsCheckIn: true }` when
`buildProfile` yields `null` (D5).

### UI

`RacketRow` gains two controls above the recommendation card, persisted to
`PlayerGear` via the existing `useGear` hook (`PATCH`):

```
I MOSTLY PLAY        (Doubles) (Singles) (Both)
BUDGET               (Under $100) ($100–200) ($200–350) (No limit)
```

Every band sets an **upper** bound, so the mapping is unambiguous — no band
means "at least this much":

| Band | `budgetMaxCad` |
|---|---|
| Under $100 | `100` |
| $100–200 | `200` |
| $200–350 | `350` |
| No limit | *field absent* — scorer neutral |

`RacketRecCard` renders reasons and warnings inside its existing expand, and
the check-in prompt in the `needsCheckIn` state. **It is PR #248's file** — if
#248 is still open, coordinate or rebase rather than editing both in parallel.

## Error handling

Follows the repo's legible-fail posture:

- A failed catalog or assessment read renders `ErrorState`, never an empty
  recommendation. A silent fallback here is the lying-empty-state the codebase
  forbids — the same shape as the v1.3 Cosmos incident.
- `needsCheckIn` is a distinct state from "load failed" and from "no match".
- The two new controls gate on `useOnline()`, disabled rather than
  execute-then-break.

## Testing

- `lib/racketRecommend.ts` — pure, so tested directly. One case per scorer
  including both negative branches (over-demanding flex, over-budget), plus the
  demo profile from the Python as a golden case, plus current-racket exclusion,
  plus legacy-row skipping.
- `lib/racketProfile.ts` — full 14-key mapping, partial ratings defaulting to 3,
  `null` on empty ratings.
- Route — flag on/off, `needsCheckIn`, read-failure surfaces an error.
- Import script — id prefixing produces 39 merges / 21 additions / 0 dangling
  `catalogId`s, and `partitionKey` is dropped.

## Not doing

- Not closing #248 (D2).
- Not migrating `gameResults` to member ids — a separate, larger piece of work
  documented at `lib/levelStore.ts:fetchSeeds`.
- Not adding spec filters to the picker. The clean schema now makes them
  possible, but the picker's job is lookup, not browse.
- Not hand-curating the 11 legacy rows into the new vocabulary.
