# String pairing — design

**Date:** 2026-08-20
**Status:** approved, ready to plan
**Depends on:** `feat/gear-register-v2` (unmerged). This work extends
`GearPickRail`, `GearPickCard`, `GearPickSheet` and `StringTensionCard`, all of
which that branch either created or rewrote. Branch `feat/string-pairing` is
based on `feat/gear-register-v2`; rebase onto `main` once the gear branch
merges. **Do not merge this first.**

**Reference implementation:** `docs/superpowers/reference/pair_racket_string.py`
(533 lines, no third-party dependencies, deterministic). This spec records the
port's deviations from it. Where this document and the Python disagree, this
document wins — but every disagreement is named here, not left implicit.

---

## Why

The Gear register's four-category rail renders Racket as a scored pick and
Strings as a parked "coming soon" card. That is not a data gap: **all 46 strings
are already in the catalog with normalized attributes**, and each of the twelve
fields the reference engine reads off a string is present on all 46, with no
nulls. The gap is that
`ENGINE_CATEGORIES` in `app/api/recommend/route.ts` is `['racket']`, so
`/api/recommend?category=string` answers `unavailable: 'no_engine'` and the rail
honestly reports that it cannot answer.

Strings are also the category where a recommendation is most *needed* and least
served. The frame is ~80% of felt performance and the string ~15–20%, which is
exactly why players guess at it: the lever is small enough that nobody
researches it and large enough that the wrong choice is felt every session.
The club tally already shows the guessing — Yonex BG65, the global default, is
the most-logged string in the seed.

### Why this engine is not the racket engine

The racket recommender amplifies: it fits the frame to the player. String
pairing **inverts** that, because the frame is already fixed and the string's
job is to bring the system back into balance:

- head-heavy power frame → the system already has power; the string should give
  back durability and control
- head-light speed frame → the system is power-deficient; the string should give
  back repulsion

This is why the port is a new module rather than a `category` branch inside
`recommendRackets`. The two engines share a player profile and a skill-level
definition; they share no scoring logic.

---

## What we're building

Five weighted scorers totalling 100, plus a skill multiplier and a hard gate:

| Scorer | Weight | Question |
|---|---:|---|
| `tension_fit` | 20 | Do the racket's and string's rated tension windows overlap usefully? |
| `system_power` | 30 | Does frame-power + string-power land near this player's target? |
| `feel_balance` | 20 | Stiff shaft + hard string = harsh. Inverse-match the feel. |
| `durability_demand` | 20 | Will this player break this string on this frame? |
| `value_fit` | 10 | Is the string spend proportionate to the frame's tier? |

The **skill gate multiplies** the total (floor 0.25) rather than adding to it, so
a string rated well above the player's level cannot win on the other four.

The **hard gate** rejects a pair outright when the two tension windows do not
overlap at all, rather than scoring it low. Measured against the real catalog,
this never empties the pool: all 71 frames returned a ranked pick.

---

## Decisions

Two questions were settled before design; both shape the surface.

### D1 — Which racket do we pair against?

**Owned → recommended → parked**, resolved server-side in that order:

1. `profile.currentRacketId`, which `buildProfile` already sets from
   `activeRacket(gear).catalogId` and only when a `catalogId` exists. Rung one
   is therefore already built and already null-safe.
2. Failing that, the top `recommendRackets` pick, surfaced with an explicit
   label so the assumption is never hidden — *"Astrox 88D Pro · our pick for
   you"* rather than a bare string recommendation.
3. Failing that (no check-in, so no racket to recommend), `needsCheckIn`, which
   the rail already renders as parked.

Rejected: pairing only for members with a logged racket (strands most members,
since logging is new); and always pairing against the recommended racket
(recommends strings for a frame the member does not own — the "recommends back
gear you already have" class of bug the register exists to remove).

A gear item with `catalogId: null` — a legacy row, or the `fresh-thursday`
fixture's free-text "Astrox 88D Pro" — falls to rung 2. `useGear.addFromCatalog`
always writes `catalogId`, and the UI has no free-text add path, so this case
does not grow.

### D2 — Who owns the tension number?

**The pair engine wins where it can answer; `StringTensionCard` is the
fallback.**

Two tension recommenders would otherwise ship in one register:
`lib/tension.ts` computes `round(21 + level)` (+2 for singles, clamped 20–30),
which is racket- and string-agnostic; the reference's `recommend_tension` places
`(grip + movement) / 2` inside the racket ∩ string overlap window, so it varies
per string — on the Astrox 88D, 27.0 lb for the Li-Ning N69 but 24.0 lb for the
Yonex Nanogy 95.

`StringTensionCard` steps aside when a pairing produced a number, and renders
unchanged otherwise. This keeps one number on screen at a time, and makes it the
most specific one we can honestly give. `lib/tension.ts` is **not** deleted: it
still serves the two cases where the pair engine returns no number — no racket
on file at all, and the 11 frames with an unpublished tension ceiling (see *API
changes*).

---

## Deviations from the reference

### V1 — Scale bridge, not re-derived constants

App ratings are 1–5 (`lib/assessment.ts`); the reference assumes the ACE matrix's
1–6. Five constants depend on the scale: `(overall - 3.5) * 0.07`,
`(offense - 1) / 5.0`, `consistency = ((grip + movement) / 2 - 1) / 5.0`, and the
neutral-3 terms in `target_system_power`.

Convert at the boundary — `1 + (v - 1) * 1.25` — and keep every ported constant
verbatim. Re-deriving them would produce the same numbers by a different route
while destroying the property that matters most for a 533-line port: that a
reviewer can diff the constants against the reference file and see they match.

### V2 — Reuse `skillLevel()` and `overall()`; do not port `SKILL_RANK`

The reference derives `overall` from six ACE dimensions and thresholds it at
2.5 / 4.5. `lib/racketRecommend.ts` already defines `overall()` across all
fourteen app skills and `skillLevel()` at 2.5 / 3.75.

Reuse both. Deriving six dimensions from fourteen skills would silently drop
`net_play`, `stamina` and `consistency` from the average, and would leave the
app with two disagreeing definitions of who counts as Advanced — one deciding
racket tier, the other deciding string tier, in the same register.

Only the four dimensions the scorers use *individually* are mapped:

| Reference field | App skills |
|---|---|
| `offense` | mean(`smashes`, `drives`) |
| `grip` | `grip` |
| `movement` | mean(`footwork`, `court_coverage`) |
| `strategy` | mean(`game_reading`, `rules`, `mindset`) |

`defence` and `serve` are referenced by the engine only through `overall`, which
V2 replaces, so they are not mapped.

### V3 — Guard `feel`

`score_feel_balance` calls `s.get('feel').lower()` with no fallback — the only
unguarded read in a file whose own header states that unknown values "fall back
to the middle rather than raising, so a new racket with an unseen flex label
degrades gracefully instead of crashing the feed." It is a latent crash, found
by running the reference against the real catalog. The port degrades to
`feelScale`, then to the mid value.

### V4 — Drop the "weeks at your play rate" clause

The breakage warning reads *"roughly N hours per restring (about X weeks at your
play rate)"*. `hours_per_week` has no source in this app, so at its default that
parenthetical states a fabricated fact about the member — the auth-side twin of
the lying-empty-state rule: unknown must not render as known.

*"Roughly N hours per restring"* is kept. That is a property of the string under
a computed demand, not a claim about the member.

### V5 — Fields that run at defaults

`budget_sensitivity` (`normal`), `restring_tolerance` (`normal`),
`known_string_breaker` (`false`), `sessions_per_week` / `hours_per_session`
(1.0 / 2.0) have no source. This is measured, not assumed: sessions/week 1.0 vs
3.0 returned an identical top pick, so the 20-point durability scorer still
discriminates on frame power and attacking intent, which we do have.

The only real source for play rate is attendance, which Stage 8 deliberately
removed from Stats and which `/api/stats/insight` is explicitly not given. A
reason string derived from it would be attendance re-entering Stats copy through
a side door. Not worth 20 points that already work.

**Consequence to accept:** `GearPickRail` refetches on `budgetMaxCad` change, and
for strings that refetch cannot change the answer. One wasted call per budget
edit, against a 10/min limit. Cheaper than a special case.

### V6 — Cut from the port

`top_n`, `brand_match`, `load()` and `pretty()` have no consumer — the rail
renders one card per category, not a ranked list. Port the scorers; return the
top pick. Build the list surface when something displays a list.

---

## API changes

`ENGINE_CATEGORIES` gains `'string'`. No new endpoint: the string branch lives
inside `GET /api/recommend`, which already owns the rate limit, the D8 privacy
gate, and `ensureCatalogSeeded`. A sibling endpoint would fork the rail's fetch
loop and duplicate all three.

The response gains two **optional** fields, so the shared-Cosmos schema rule
holds and the rail's four-state ladder needs no change:

```ts
pairedWith?: { label: string; source: 'owned' | 'recommended' };
tensionLbs?: number | null;
```

`tensionLbs` is `null` for the **11 of 71 frames** whose `tensionMaxLbs` is
unpublished. Those frames still rank: `score_tension` returns 0.6 with *"Racket
tension ceiling unpublished — verify before stringing"* rather than rejecting.
The sheet renders that reason instead of a number.

**Rate limit.** `string` stops being skipped by the rail's parked-category
refresh optimisation, so each play-format or budget change fires two
`/api/recommend` calls instead of one, against `checkRateLimit(recommend:${ip},
10, 60_000)`. That is five preference changes per minute before the throttle,
whose response — a bare `{item: null}` with a 200 — the rail's ladder renders as
an error card. Acceptable for one member; **re-check before any third engine
category lands.**

---

## Component shape

- **`GearPickCard`** shows the assumed frame above the pick: *"Astrox 88D Pro ·
  yours"* or *"Astrox 88D Pro · our pick for you"*, driven by `pairedWith.source`.
  Never a bare string pick with an invisible frame assumption behind it.
- **`GearPickSheet`** renders the engine's reasons and warnings, plus the
  club-tally line via `lib/pickReasons.ts`, inheriting its three-person cohort
  guard. The tally is stronger evidence for strings than it ever was for
  rackets — strings are what the club actually logs.
- **`StringTensionCard`** gains one conditional (D2). No other change.
- New copy under `stats.gear` in **both** `messages/en.json` and
  `messages/zh-CN.json`; `__tests__/i18n/locale-parity.test.ts` enforces it.

---

## Testing

- **Engine units:** hard gate on non-overlapping windows; the missing-ceiling
  degrade (0.6, not a rejection); the V1 scale bridge; the V3 `feel` guard;
  skill multiplier flooring at 0.25.
- **Route:** one test per D1 rung, including `needsCheckIn`; the 403 privacy
  gate; `invalid_category` still 400s.
- **Component:** both `pairedWith` labels; the D2 tension handover.
- **Catalog-shape canary.** The port reads sixteen fields off `attributes`. This
  repo has already shipped a catalog whose shape drifted from the code reading
  it — `isScorable` silently skipped **50 of 71 rackets in production** while
  every local test passed, because in dev the JSON file *is* the catalog. A
  pairing engine has sixteen ways to repeat that, with the same tell: quietly
  fewer scorable strings and no error anywhere. Assert the fields exist on the
  seed with the expected types.

Gates between every task: full `npm test` **and** `npm run lint` (baseline 0
errors), `npx tsc --noEmit` before any push. A task-scoped check cannot see
cross-file breakage.

---

## Scope

**In:** `lib/stringPair.ts`; the `'string'` branch in `/api/recommend`; the
`pairedWith` / `tensionLbs` fields; the three component changes; i18n; tests.

**Out:** shoes and shuttles (no catalog rows — a sourcing problem, not an
engine one); a ranked string list; brand-restricted pairing; any attendance-fed
input; changing `lib/tension.ts`'s formula.

---

## Open questions

None blocking. Two to revisit after it ships:

1. Whether `pairedWith.source === 'recommended'` should link to the racket pick,
   so the two cards visibly agree rather than each asserting a frame.
2. Whether the rate-limit headroom above survives a third engine category.
