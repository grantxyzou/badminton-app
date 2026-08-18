# AI equipment insight — racket advice grounded in skill signals

**Date:** 2026-08-17
**Status:** design approved, not implemented
**Flag:** `NEXT_PUBLIC_FLAG_EQUIPMENT_INSIGHT` (new)

## Problem

The Equipment tab's recommendation is generic. `lib/recommend.ts` says so in its
own docstring — *"No AI here (plan Decision B2)"* — and it takes `stage`,
`gamesPlayed` and `catalog`. **The player's own racket is not a parameter.** The
"Why this?" text is a templated sentence from `reasonFor()`.

So the card recommends without knowing what you already own, and the one place
your racket appears (`Lighter than yours`) is computed *after* the pick, purely
for display. The card describes a relationship it did not use to decide.

This was goal 3 of the Value-Hub work, deferred in May as *"when we get there."*

## Goals

1. Diagnose how the racket a player **owns** relates to how they are **playing**.
2. Recommend a different racket **only when the diagnosis implies a direction**.
3. Say nothing when there is nothing worth saying.
4. Never be worse than today: no signal → today's exact behaviour.

## Non-goals

- Replacing `recommendRacket()`. It remains the picker; signals only redirect
  *which axis* it picks along, and only when a diagnosis fires.
- Any new Claude call. This rides the existing per-member, per-session cached
  call in `/api/stats/insight`.
- Recommending non-racket equipment. Strings and shoes are not modelled.

## Context that shapes the design

**The engine's contract** (`lib/insightSignals.ts`): deterministic code computes
signals; the AI only narrates the strongest one. Signals carry `facts` the
narrator "must stay within — never invent beyond these." A card with no signal
above threshold gets nothing: *"Silence beats obvious."* The product bar is
*"value BEYOND the obvious — never a restatement of a number they can see."*

**Adoption is the real constraint.** Measured 2026-08-17 against production:
**1 of 53 members has a racket set.** An equipment diagnosis needs
`(skill signal) × (their racket)`, so today it would render for one person.

That number describes the past, not the feature: the Equipment register was
unreachable for ~9 weeks and the usable version (hero card, search over 50
rackets, spec lines) shipped hours earlier the same day. But it is why this ships
**behind a flag, off**, and why the flag must not be flipped on adoption
optimism — it is flipped when enough members have rackets for the feature to
fire. Slice-0's kill criterion spent nine weeks measuring engagement on a dark
card; this is the same shape and must not repeat.

## Design

### 1. `lib/equipmentSignals.ts` — pure, testable, mirrors `insightSignals.ts`

```
computeEquipmentSignals({
  snapshots,        // StoredAssessment[]  — same input as insightSignals
  canonicalLevel,   // CanonicalLevel | null
  racket,           // CatalogItem | null  — the player's ACTIVE racket
  catalog,          // CatalogItem[]
}): EquipmentSignal[]
```

`EquipmentSignal` mirrors `InsightSignal`: `kind`, `score` (0..1), `facts`
(grounded values the narrator may not exceed), `hint` (plain-English seed, never
shown raw), plus `suggests?: string` — a catalog id, present **only** when the
diagnosis implies a specific direction.

Returns `[]` when `racket` is null. No racket, no diagnosis.

#### Signal A — `phase-mismatch` (arithmetic, no domain judgement)

The player's stage sits outside their racket's `skillRange`.

- stage **below** range → the racket is built for players ahead of them
- stage **above** range → they have outgrown it

`score` scales with distance: 1 phase out = 0.5, 2+ = 0.8. `suggests` = the
`recommendRacket()` pick constrained to rackets whose range contains their stage.

#### Signal B — `weakness-conflict` (the diagnosis; domain knowledge)

The skill they are stuck on is one their racket's build makes harder. Requires
an existing `sticky-weak` signal (a skill flat across check-ins), so it can only
fire on a real, repeated pattern.

The mapping ships as an exported data table at the top of the module — **edit a
row without touching logic**, because this encodes badminton judgement the owner
may want to correct:

```ts
// Keys are the real SKILLS keys from lib/assessment.ts:
//   serves net clears drops drives smashes grip footwork court speed game
//   consistency rules training
export const SKILL_SPEC_CONFLICTS = [
  // Touch and placement are hardest on a head-heavy, very stiff frame.
  { skills: ['drops', 'net'],            fights: { balance: 'head-heavy', flex: 'extra stiff' } },
  // Power from the rear court is hardest on a head-light, flexible frame.
  { skills: ['smashes', 'clears'],       fights: { balance: 'head-light', flex: 'flexible' } },
  // Getting around the court is hardest on a heavy, head-heavy frame.
  { skills: ['footwork', 'speed', 'court'], fights: { balance: 'head-heavy', weight: '3U' } },
];
```

Match is on the *normalised* attribute values already used by
`lib/racketSpecs.ts` (`classifyBalance`, the weight/flex rank tables) so
`"Slightly head-heavy"` and casing variants behave. `score` = the underlying
`sticky-weak` score, capped at 0.9. `suggests` = best `recommendRacket()` pick
among rackets that do **not** carry the conflicting attribute.

#### Signal C — `outgrowing` (readiness, not a problem)

An `improving-streak` on power skills while on an `Entry-level` tier racket.
`score` 0.4 — deliberately below A and B, so a real problem always wins.

**Threshold:** 0.35, matching the existing engine. Below it, nothing.

### 2. `/api/stats/insight` — a fourth card

- `buildSnapshot` gains the player's active racket (resolved via
  `activeRacket(gear)` from `lib/activeRacket.ts`) and its catalog row.
- `generateCards` returns `equipment: CardInsight | null` alongside
  `greeting`/`level`/`trend`. Same prompt call — **no extra Claude request.**
- `InsightDoc` gains `equipment?: CardInsight | null` and `racketId?: string`.
  Both optional: existing cached docs lack them and regenerate once, the same
  read-tolerant pattern as `activeRacketId`.

**Cache invalidation is load-bearing.** The insight is cached per
`(member, activeSessionId)`. If a player changes racket mid-week, cached advice
would describe a racket they no longer use — actively wrong, not merely stale.
So the freshness check gains a racket comparison alongside the existing
`lastAssessmentAt` check: cached `racketId !== current active racket id`
invalidates. Nullish-normalised on both sides, matching how `lastAssessmentAt`
already handles pre-assessment docs.

When the flag is off, none of this runs and the payload is unchanged.

### 3. `RacketRecCard` — the AI takes over the existing card

No new card. With the flag on and an equipment insight present:

- the **pick** becomes `signal.suggests` when set, else today's `recommendRacket()`
- the **"Why this?" body** becomes the generated `CardInsight.support`
- the **headline** becomes `CardInsight.headline`

With the flag off, or no signal above threshold, or the insight fetch failing:
**exactly today's behaviour** — deterministic pick, templated reason, comparison
line. This is the fallback, not an error state; the card never regresses.

The card starts consuming `useInsight`, so the Equipment tab makes one fetch it
does not make today. The response is already cached per member per session.

### 4. Failure behaviour

Every path degrades to today's card, never to an error surface or an empty card:

| Failure | Result |
|---|---|
| Flag off | today's card |
| No racket set | today's card (and the hero card already prompts) |
| No assessments / no level | today's card |
| No signal ≥ threshold | today's card |
| Insight fetch fails | today's card |
| Claude returns null for `equipment` | today's card |

The one thing that must never happen is a confident diagnosis about a racket the
player does not own — hence the cache-invalidation rule above.

## Testing

| Area | Cases |
|---|---|
| `computeEquipmentSignals` | null racket → `[]`; stage below/above range → `phase-mismatch` with correct direction and distance-scaled score; sticky-weak on drops + head-heavy → `weakness-conflict`; sticky-weak on drops + head-light → **no** conflict; improving power + entry tier → `outgrowing`; well-matched racket → all below threshold. |
| Spec normalisation | `"Slightly head-heavy"` classifies as head-heavy (reuses `racketSpecs`); `"4U/5U"` ranks as 4U; unknown values never match a conflict. |
| `suggests` | phase-mismatch suggests a racket whose range contains the stage; weakness-conflict suggests one lacking the conflicting attribute; never suggests the racket already owned. |
| Cache | changing the active racket invalidates a cached insight; unchanged racket + unchanged assessment serves the cache; a legacy doc with no `racketId` regenerates once. |
| `RacketRecCard` | flag off → templated reason; flag on + signal → generated headline/support and the suggested pick; flag on + no signal → templated reason; insight fetch 500 → templated reason, no error pill. |
| Flag | both branches, per the repo's flag test convention. |

## Open question for the owner

`SKILL_SPEC_CONFLICTS` encodes badminton judgement (head-heavy favours power,
head-light favours net and defence, stiff shafts demand faster swings). The
direction is standard, but it is worth the owner's eye before the flag is
flipped — a wrong row makes the app state something false, confidently, to
friends. It ships as editable data specifically so that review is cheap.
