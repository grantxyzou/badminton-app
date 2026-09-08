# Racket fit engine — design

**Intent:** `docs/plans/racket-fit-engine.md`
**Date:** 2026-09-07
**Status:** approved shape, ready for an implementation plan
**Flags:** `NEXT_PUBLIC_FLAG_GEAR_RECOMMENDER` (existing, on) gates Phase 1's
fields; new `NEXT_PUBLIC_FLAG_RACKET_FIT` gates the engine from Phase 2 until
Phase 4 retires both.

Supersedes the racket half of `2026-08-19-racket-recommender-design.md`. The
string half (`2026-08-20-string-pairing-design.md`) stands.

## Why

The audit recorded in the intent doc: the engine scores skill self-ratings, not
fit; it invents values for unrated skills; nothing measures whether a pick was
right; and six structural defects in the scorers. The accuracy ceiling is the
inputs, so the design starts by asking what a fitting asks.

## Decisions

| # | Decision | Rationale |
|---|---|---|
| D1 | Distance model against a target spec, not rule scorers | One place per axis, weights that sum visibly, reasons derived from the smallest distances instead of from whichever scorer fired first. The rule scorers were the defect. |
| D2 | Current racket is the ANCHOR; the goal is a delta from it | "Happy with it, want more power" is the most predictive fitting question and it uses the kit the member already logged. |
| D3 | Comfort and swing are CEILINGS, not target moves | A sore arm is a constraint. Rows above a ceiling stay ranked, penalised and warned — a 0-score frame is legible, an excluded one is not. |
| D4 | Skills demoted: tier from RATED skills only, fallback flex ceiling | No more fourteen 3s. `level` is `null` below 3 rated skills; the target then uses a neutral row and says so. |
| D5 | Exclude ALL owned rackets, not the active one — by `catalogId` OR by normalised label | The rail masked the old behaviour with an "In your kit" badge. And a bag row added as free text (the stringing sheet's typed racket, and the `fresh-thursday` seed) has no `catalogId`, so id-only exclusion recommended Lin her own Astrox 88D Pro on 2026-09-07 with "Recommended based on your playing style" — the exact defect the register was built to remove, back through a side door. `canon(brand + ' ' + model)` closes it; the ownership badge in `GearPickRail` must use the same match. |
| D6 | Budget never hard-filters (unchanged from 2026-08-19 D6) | Prices are USD-derived and stale. |
| D7 | Reasons are i18n keys + params | English-only reasons were a defect. `FIT_REASON_KEYS` is exported and a test asserts every key exists in both locales, because `check-i18n-keys.mjs` cannot see `t(reason.key)`. |
| D8 | Route stays cookie-gated (2026-08-19 D8) | Reasons still quote the member's data. |
| D9 | Top pick + two alternatives, diversity-selected | A shortlist the golden set can rate. |
| D10 | Fit questionnaire is its own sheet | See intent doc. |
| D11 | Comfort is stripped from the public gear GET | `GET /api/equipment/gear?name=` is public by name today. A health-adjacent answer must not be. |
| D12 | `pick_served` is written server-side, owner-only | Gives the feedback read a denominator without letting the client mint it, and never on admin view. |

## Data

### `PlayerGear` (additive, optional, never on `Member`)

```ts
fitGoal?: 'happy' | 'more_power' | 'more_control' | 'faster' | 'less_fatigue';
fitSwing?: 'slow' | 'medium' | 'fast';
/** HEALTH-ADJACENT. Optional, deletable via PATCH null, disclosed in
 *  legal.privacy, stripped from the public GET, purged with the doc. */
fitArmComfort?: 'fine' | 'sometimes_sore' | 'often_sore';
fitGrip?: 'G4' | 'G5' | 'G6';
/** Upper bound for a STRING in CAD. Advisory in stringPair's value scorer. */
stringBudgetMaxCad?: number;
/** ISO — stamped on any fit-field write. */
fitUpdatedAt?: string;
```

`app/api/equipment/gear/route.ts`:

- PATCH validates each enum (400 `invalid_fit`), accepts `null` as delete,
  bounds `stringBudgetMaxCad` to a finite 0–5000, stamps `fitUpdatedAt`, and
  widens the "some preference present" guard.
- **`writeGearDoc` rebuilds the doc from an explicit field list.** Every new
  field is added there or the next POST/DELETE bag write silently drops it.
  Pinned: PATCH fit → POST a racket → GET still carries fit.
- GET strips `fitArmComfort` unless the caller's `member_session` owns the
  member or is admin. Pinned: anonymous GET never contains it.

### Disclosure and deletion

`legal.privacy` "What we hold about you" gains one paragraph in both locales,
`updated` is bumped, and `__tests__/legal-pages.test.ts` gains an
`'arm or shoulder'` needle beside `'Anthropic'`. `lib/memberPurge.ts` already
owns `playerGear`; one assertion is added that a doc carrying `fitArmComfort` is
gone after purge.

## Engine — `lib/racketFit.ts` (pure)

```ts
export const FIT_ENGINE_VERSION = 'fit-1';
export interface FitInput {
  anchor: CatalogItem | null;      // active racket, only if its catalogId is a scorable row
  ownedIds: ReadonlySet<string>;   // every non-retired racket catalogId — excluded
  ownedLabels: ReadonlySet<string>; // canon(label) of every non-retired racket, for free-text rows
  goal?: FitGoal; swing?: FitSwing; armComfort?: FitArmComfort; grip?: FitGrip;
  format: 'singles' | 'doubles' | 'both';
  budgetMaxCad?: number;
  level: 'Beginner' | 'Intermediate' | 'Advanced' | null;   // rated skills only
  techniqueCeiling?: 1 | 2 | 3 | 4 | 5;                     // old maxFlexDemand, rated only
}
export interface FitReason { key: string; params?: Record<string, string | number> }
export interface FitPick { item: CatalogItem; score: number; reasons: FitReason[]; warnings: FitReason[]; differsBy?: FitReason[] }
export interface FitResult { fitState: FitState; top: FitPick | null; alternatives: FitPick[]; target: TargetSpec }
export function recommendFit(input: FitInput, catalog: CatalogItem[]): FitResult
```

`isScorable`, `canon`, `overall`, `skillLevel`, `maxFlexDemand` MOVE here from
`lib/racketRecommend.ts`; `lib/stringPair.ts` re-imports. `buildProfile` gains
`ratedKeys` so `overall` averages rated skills only.

### Axes (one exported table)

| axis | encoding | source |
|---|---|---|
| balance | Head-light 1 · Even 2 · Head-heavy 3 | `attributes.balance` via `canon()` |
| flex | Flexible 1 · Medium 2 · Medium-Stiff 3 · Stiff 4 · Extra Stiff 5 | `attributes.flex` |
| weight | `(weightMinG + weightMaxG) / 2` g; absent → axis dropped for that row + `reason.weightUnknown`, never 85 | both fields |
| tier | Entry 1 · Mid 2 · Premium 3 | `attributes.tier` |
| grip | set from `gripSize` ("G4/G5" → {G4, G5}); absent → unknown | `attributes.gripSize` |
| style | Power / Speed / Control / All-round | `attributes.playStyle` |

### Target spec

1. **Base** — anchored: `axes(anchor)`. Unanchored, by level:

| level | balance | flex | weight g | tier |
|---|---|---|---|---|
| Beginner | 2 | 2 | 82 | 1 |
| Intermediate | 2 | 3 | 85 | 2 |
| Advanced | 2 | 4 | 86 | 3 |
| null | 2 | 2.5 | 84 | 2 |

2. **Goal delta** (`toward2` = one balance step toward Even):

| goal | balance | flex | weight g | preferred style |
|---|---|---|---|---|
| happy | 0 | 0 | 0 | anchor's |
| more_power | +1 | 0 | +2 | Power |
| more_control | toward2 | +1 | 0 | Control |
| faster | −1 | 0 | −3 | Speed |
| less_fatigue | −1 | −1 | −4 | — |

Clamp balance [1, 3], flex [1, 5], weight [75, 89].

3. **Swing → flex ceiling**: slow `flexCeil = 2`, `target.flex = min(·, 2)`;
   medium 4; fast 5, `target.flex = max(·, 3)`. Absent → `techniqueCeiling ?? 4`.
4. **Comfort → ceilings**: sometimes_sore `flexCeil = min(·, 3)`, `weightCeil = 85`;
   often_sore `flexCeil = min(·, 2)`, `weightCeil = 83`, `balanceCeil = 2`.
5. **Tolerance** `sigma = anchored ? 1.0 : level ? 1.3 : 1.6`.

### Scoring

```
penalty   = (22·|Δbalance| + 12·|Δflex| + 2.5·min(|Δweight|, 10) + 6·|Δtier|) / sigma
caps      = 10·max(0, flex − flexCeil) + 4·max(0, weight − weightCeil) + 10·[balance > balanceCeil]
secondary = format (+4 subType match; +3 all-round when 'both')
          + style (+3 preferred)
          + grip (−6 only when BOTH sides known and no overlap)
          + budget (−20 when msrp > budgetMaxCad; never excluded)
score     = clamp(100 − penalty − caps + secondary, 0, 100), rounded to 0.1
```

Max secondary is +7: a two-step balance miss (44) cannot be bought back; a
one-step flex miss (12) can — intended. Every cap violation emits a warning key
(`warn.flexAboveCeiling {flex}`, `warn.weightAboveCeiling {g}`,
`warn.headHeavyWithSoreArm`).

**Order**: score desc → penalty asc → msrp asc (unknown last) → id asc. The
comparator is exported and tested on two identical synthetic rows.

### Reasons (`stats.gear.reason.*`, max four, fixed order, only when true)

1. Anchor: `likeYours {model}` (Δ ≤ 1 on every axis) or the goal-specific
   `powerStep` / `controlStep` / `speedStep` / `fatigueStep` when this row moves
   the axis the goal moved.
2. Flex: `flexFitsSwing {flex}` (Δflex = 0, swing given) or `flexHeadroom {flex}`.
3. Balance/format: `doublesBuilt` / `singlesRear` / `evenVersatile`.
4. `withinBudget {cad}` / `gripMatch {grip}`.

`unanchored` / `levelOnly` / `anchoredDefault {model}` lead when applicable. The
club line in `lib/pickReasons.ts` becomes `{ key: 'reason.clubPlays', params:
{ count } }` with a next-intl plural.

### Alternatives and "differs by"

Alternative 1 = first ranked row whose (balance, flex, tier) triple differs from
the top on ≥1 axis; alternative 2 = first whose triple differs from both. Fall
back to next-by-rank within the top 10 so the diversity rule never yields fewer
than two. `differsBy` vs the TOP, at most two fragments, priority: flex
(`diff.stiffer` / `diff.softer`) → balance (`diff.headHeavier` /
`diff.headLighter`) → weight if |Δ| ≥ 2 g (`diff.lighter {g}` / `diff.heavier`)
→ price if both known and |Δ| ≥ 20 (`diff.cheaper {cad}` / `diff.pricier`) →
tier (`diff.tierUp` / `diff.tierDown`). Zero fragments → `diff.sameSpecOtherBrand`.
The client joins with `t('diffJoin')`.

### `fitState`

| state | condition | behaviour |
|---|---|---|
| `anchored` | scorable active racket + `fitGoal` | full model |
| `anchored_default` | scorable active racket, no goal | goal = happy; `reason.anchoredDefault` leads |
| `unanchored` | no scorable racket; goal AND swing set | level base (or null row), sigma widened, `reason.unanchored` |
| `level_only` | no scorable racket; no goal+swing; ratings exist | level base + `techniqueCeiling`; `reason.levelOnly` |
| `needsFit` | none of the above | `{ item: null, needsFit: true }`; card parks TAPPABLE → fit sheet |

`needsCheckIn` survives unchanged for strings (the string engine reads skill
dimensions). The string branch's rung 2 (pair against the recommended racket)
switches to `recommendFit(...).top`.

## Route — `GET /api/recommend`

With `RACKET_FIT` on, the racket branch returns (additive):

```
{ item, reason, reasons,               // English strings via transitional lib/fitReasonText.ts
  reasonKeys, warningKeys,
  alternatives: [{ item, reasonKeys, differsBy }],
  engineVersion, fitState }
```

plus the `needsFit` variant. Flag off → today's shape byte-for-byte. Rate limit,
D8 cookie gate and strip-canary unchanged. When a racket item is returned AND the
caller owns the name, the route appends a `pick_served` event.

Member resolution stays on `resolveActiveSubject` / `resolveMemberId` and nothing
else, so the multi-group sweep meets one seam.

## UI

- **`GearFitSheet`** (new): `<BottomSheet>` with header/body/footer, takes the
  register's single `UseGear`. Rows: What would you change? (vertical `ListRow`
  radio list — five segment tabs overflow a phone); Your swing (3-tab segment);
  Arm or shoulder (3-tab + `Clear` ghost link only when set + one muted line
  "Optional. Only softens the pick; clear it any time."); Grip size (3-tab +
  "Not sure" = null); String budget (racket budget's bands). Format and budget
  stay in `GearPickSheet`, shown read-only here. Each write is one
  `gear.setPrefs()`, rendered through `ErrorState`, gated on `useOnline()`.
- **Entry points**: `GearPickSheet`'s summary line gains a second link "Fit"
  (summary grows to "For doubles · no budget limit · wants more power"); the
  `needsFit` rail card. `GearPickRail` owns `openFit` like `openCategory`.
- **Refetch**: `recKey` includes the fit fields; the effect is debounced 500 ms
  and skips the string refetch when only a fit field changed. The route's
  10/min limit renders a throttled 200 as an error card, so five new controls
  need this.
- **`GearPickSheet`**: "Or consider" section under warnings with two `ListRow`s
  (model / joined `differsBy` / price); tapping swaps the sheet's subject (local
  state, resets on close like `specsOpen`); the Add action follows the displayed
  item. Thumbs row under the headline (`pick_rated`); "I tried it" ghost button in
  the footer for an owned or added pick (`pick_tried`); Add fires `pick_added`.
- Rail card stays one pick.

## Feedback loop

`EngagementKind` and the route allowlist gain `pick_added | pick_tried |
pick_rated | pick_served`. Payload (additive, validated, extras dropped):
`{ catalogId? (≤80), engineVersion? (≤20), rating?: 'up' | 'down', category?:
'racket' | 'string' }`. `recordEngagement(kind, meta?)` stays fire-and-forget and
cookie-bound. `pick_served` is rejected from `POST /api/events`.

Read: `GET /api/admin/slice0` gains `picks: { engineVersion, served, added,
tried, ratedUp, ratedDown, byCatalogId[] }`. `GET /api/admin/fit-preview?memberId=`
(admin, rate-limited) returns top-3 ids + fitState for one member with no reason
text — how the golden set is checked against real data.

## Golden set

`__tests__/fixtures/fit-golden.json` — `{ engineVersion, cases: [{ id: 'gNN',
note, ratedBy, ratedAt, gear: { items, activeCatalogId, playFormat,
budgetMaxCad, fit* }, ratings: Rating[], acceptable: [ids], unacceptable: [ids]
}] }`. Raw ratings and a gear shape, never a derived level, so the test runs the
real `buildProfile → recommendFit` path. No names, no memberIds.

`__tests__/fit-golden.test.ts` asserts `top3 ∩ acceptable ≠ ∅`, `top3 ∩
unacceptable = ∅`, and that every listed id exists in the catalog (a typo must
not pass vacuously). `describe.skipIf(cases.length === 0)` with a printed notice
until Phase 4 flips it to a hard `≥ 5`. `scripts/dump-fit-cases.mjs` (read-only)
prints case skeletons with `acceptable: []` for the owner and stringer to fill.
Hypothetical cases are labelled `ratedBy: 'stringer-hypothetical'`.

## Retirements (Phase 4)

Delete the `/api/recommend` flag-off branch, `lib/recommend.ts`'s
`recommendRacket` + `reasonFor` (move `topPartners` to `lib/partners.ts` first),
`lib/racketRecommend.ts`'s scorers / `WEIGHTS` / `REASON_PRIORITY` /
`recommendRackets`, `lib/fitReasonText.ts`, and their tests. Retire `RACKET_FIT`
and pull `GEAR_RECOMMENDER` forward. `recommend_racket.py` stays on disk with a
superseded header. **`components/stats/CLAUDE.md` is a governing doc under
`__tests__/docs-canary.test.ts` and names the deleted files — it is rewritten in
the same PR, and no `DELIBERATELY_ABSENT` exemption is added for anything this
work removes.**

## Error handling

Legible-fail throughout: a failed gear or catalog read renders `ErrorState`;
`needsFit` is distinct from load-failed and from no-match; the fit controls gate
on `useOnline()`; the fit sheet stays reachable when the gear read fails (it is
what writes the doc).

## Testing

- `__tests__/racket-fit.test.ts`: target table per goal; swing and comfort
  ceilings; distance arithmetic on hand-built rows; each cap warns; budget never
  excludes; grip unknown is neutral; deterministic tie-break; all-owned
  exclusion; alternatives diversity + fallback; `differsBy` fragments; every
  emitted key exists in both locales.
- Route: each `fitState` row; `needsFit`; alternatives; flag-off shape unchanged;
  403; strip-canary; `pick_served` only for the owner.
- Gear route: each fit field persists, `null` deletes, invalid → 400, fit
  survives a POST, anonymous GET strips comfort.
- Components (jsdom, `afterEach(cleanup)`, `NextIntlClientProvider`):
  `GearFitSheet` one write per tap and Clear only when set; `GearPickSheet`
  alternatives render, swap, beacons carry catalogId + engineVersion, tried fires
  once; `GearPickRail` `needsFit` tappable, refetch on fit change, string refetch
  skipped, zh-CN reasons via keys.
- Events route: new kinds, payload validation, `pick_served` rejected from
  client. Admin slice0: `picks` block. Legal pages: both locales, new needle.
  Purge: comfort field gone.
- Every phase: full `npm test`, `npm run lint`, `npx tsc --noEmit`; verify-ui on
  the fit sheet, the pick sheet with two alternatives and a warning (en + zh-CN),
  the `needsFit` card and `/bpm/legal/privacy`.

## Not doing

See the intent doc's Non-goals. Additionally: not raising the recommend rate
limit in Phase 1 (debounce first; revisit at 20/min in Phase 3 if the throttle
is hit in practice); not migrating `gameResults` to member ids.
