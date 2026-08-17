# Equipment tab — racket bag view

**Date:** 2026-08-17
**Status:** design approved, not implemented
**Flag:** `NEXT_PUBLIC_FLAG_VALUE_HUB_SLICE` (existing — no new flag)

## Problem

The Equipment register asks a question it half-answers. Today `RacketRow` renders
two cards side by side at equal weight — your racket on the left, the
recommendation on the right — so the thing the tab is *about* carries no more
visual weight than the nudge beside it. And picking a racket silently discards
the previous one: `PUT /api/equipment/gear` replaces any item of the same
category, so a player who owns three rackets can only ever record the last one
they tapped.

Separately, the catalog holds 15 rackets. Real players do not find their racket
in 15 rows.

## Goals

1. Your racket leads the tab, at hero weight, asking "What is the racket you are
   using today?"
2. The recommendation drops to a second line, secondary weight.
3. A player can hold **multiple rackets in a bag** with exactly one marked active.
4. A player can **search** the catalog, not just browse brand tabs.
5. The catalog grows from 15 to 50 rackets without orphaning existing picks.

## Non-goals

- **Per-session racket logging.** "Using today" reads session-scoped, but nothing
  else in this feature is, and `/api/recommend` reads a single current racket.
  `activeRacketId` is the player's *current* racket and changes only when they
  change it. Answering "which racket did I use last Thursday" is a different data
  model (an event per session) and a separate slice.
- Non-racket categories (strings, shoes, shuttles). The schema already has
  `EquipmentCategory`; this slice touches rackets only.
- Retailer/affiliate links for the 35 new rackets. `sources` ships empty for them;
  Decision D (affiliate tags null in Slice-0) is unchanged.

## Design

### 1. Catalog import — union, never replace

Source: `racket_database.json`, 39 records, 3 brands (Li-Ning 14 / Yonex 13 /
Victor 12), all fields populated, 39 unique ids.

**The trap.** The source file's `category` field means *play-style* (`"Power"`,
`"Speed (entry)"`). The app's `category` is the Cosmos **partition key** and must
be the literal `'racket'`. Importing the field as-is scatters rows across
`"Power"` / `"Speed"` partitions, and `GET /api/equipment/catalog?category=racket`
returns nothing — reproducing the empty-catalog outage fixed in `de2505e` last
week. The source file's own `partitionKey: "Yonex"` partitions by brand and must
be dropped for the same reason.

**Field mapping:**

| Source field | Target | Rule |
|---|---|---|
| — | `category` | hardcode `'racket'` (partition key) |
| `id` | `id` | prefix `racket-` → `racket-yonex-astrox-100zz` |
| `brand`, `model` | `brand`, `model` | verbatim |
| `series` | `attributes.series` | display only |
| `category` | `attributes.playStyle` | free text, display only — **never** logic |
| `balance` | `attributes.balance` | verbatim |
| `flex` | `attributes.flex` | verbatim |
| `weightClass` | `attributes.weight` | verbatim |
| `weightGrams`, `frameMaterial`, `stringTensionLbs`, `gripSize`, `notes` | `attributes.*` | verbatim |
| `priceUSD` | `msrp` | parse low end of `"$220-250"` → 220, ×1.38 → CAD, round. Unparseable → omit (`msrp` is optional). |
| `tier` | `skillRange` | `Entry-level → [1,3]`, `Mid-range → [2,5]`, `Premium → [4,6]` |
| `partitionKey` | — | drop |
| — | `seeded` | `true` |

`skillRange` is required by `lib/recommend.ts` (it filters and ranks on
`skillRange[0]`/`[1]`), so it cannot be omitted. `tier` is the only clean
three-way split in the source data — `category` has 20 distinct free-text values
("Power (beginner step-up)", "Speed/Control") and is unusable for logic.

**Why prefixing ids is load-bearing.** Only **4** of the current 15 rackets appear
in the source file; 11 are current-only. Replacing the catalog would orphan those
11, and the 4 overlaps carry different id formats (`racket-yonex-astrox-88d-pro`
vs `yonex-astrox-88d-pro`), so their `catalogId` references would dangle too.
Prefixing makes the 4 collide *exactly* with their existing ids. Since
`ensureCatalogSeeded` reads existing ids and upserts only the missing ones, the
union then happens with **no change to `lib/catalogSeed.ts`**: the 15 stay as-is,
the 35 new ones are added.

Result: **50 rackets**, zero orphans.

For the 4 overlapping rackets, **existing data wins** — they keep their curated
`msrp` (CAD), `sources` (retailer links), and hand-set `skillRange`, and do not
gain the source file's deeper `attributes`. This falls out of the id-idempotent
upsert for free. Enriching those 4 is deliberately deferred; it is a data edit,
not a code change.

Deliverable: an import script writes the merged 50-item
`scripts/data/equipment-catalog.json`. The script runs once at author time and
its output is committed — it is not part of the runtime path.

### 2. Hierarchy — stacked, racket leads

`RacketRow` replaces its 2-column grid with a vertical stack:

```
┌────────────────────────────────────┐
│ What is the racket you are         │  card label
│ using today?                       │
│                                    │
│   Astrox 88D Pro              ✎    │  hero — display font, --fs-stat
│   Yonex                            │  brand, --fs-sm
│                                    │
│   Built for power · Head-heavy     │  plain-language line, --fs-md
│   4U (83–88g) · Extra Stiff        │  spec line, --fs-sm --text-muted
└────────────────────────────────────┘
┌────────────────────────────────────┐
│ WE RECOMMEND                       │  section label, --fs-2xs
│ Thruster Ryuga II                  │
│ Victor · Lighter than yours        │  the comparison, --fs-sm
│ Why this?                       ⌄  │
└────────────────────────────────────┘
```

The question is the card's permanent label in both states; the empty state
replaces the hero with a "Tap to pick your racket" prompt. Nothing reflows when
the player answers.

Per the inner-content reference in CLAUDE.md: `.glass-card` at 16px radius, 20px
padding (`p-5`) for the content card. The hero uses `--fs-stat` (20px) — this is
the Stats tab, which already owns that larger data scale.

#### Making the specs legible

`specLine()` (`GearSheet.tsx:25`) renders `"4U · head-heavy · stiff"`. That is
precise and, to anyone who does not already know rackets, opaque — which fails
the friend-voice bar this app is built to. Two source fields fix it without
inventing copy:

- **`weightGrams`** disambiguates the weight class inline: `4U (83–88g)`. A
  player who has never heard of "4U" still learns their racket is 83–88 grams.
  Rendered as an en-dash range.
- **`notes`** is already plain English ("Flagship smash racket, pro-level feel").
  It is the only field written for a human rather than a spec sheet.

Card content is therefore **two tiers**, most-human first:

| Tier | Content | Source | Type |
|---|---|---|---|
| Plain language | `Built for power · Head-heavy` | `attributes.playStyle` (normalized) + `balance` | `--fs-md`, `--text-primary` |
| Specs | `4U (83–88g) · Extra Stiff` | `weight` + `weightGrams` + `flex` | `--fs-sm`, `--text-muted` |

`playStyle` normalizes for display only: the source's 20 free-text values collapse
to their leading word (`"Power (beginner step-up)"` → `Power`,
`"All-round / Speed"` → `All-round`) and render as `Built for {power}`. Slashed
values keep the first term. This is a display transform — the raw string stays in
`attributes.playStyle` untouched, and nothing branches on it.

`notes` is **not** on the card face. At up to ~40 characters it competes with the
model name for the eye, and it repeats what the two tiers already say. It belongs
in the picker rows, where a player is comparing models and the extra sentence
earns its space.

Any field may be absent on the 15 legacy items (they have no `weightGrams`,
`series`, or `notes`). Every line degrades by omission — a missing `weightGrams`
renders bare `4U`, a missing `playStyle` drops the plain-language line entirely
and the spec line moves up. No placeholder dashes, no empty rows.

#### The recommendation card

`RacketRecCard` keeps its compact treatment, minus the `minHeight: 112` that
existed only to match the left card's height in the grid. It gains one line: **how
the pick differs from what the player already has.**

A recommendation with no relationship to your current racket is a name you have
no reason to trust. The comparison is computed client-side from the two
`CatalogItem`s already in hand — no API change:

| Dimension | Compare | Renders |
|---|---|---|
| Weight | `weight` class (5U < 4U < 3U) | `Lighter than yours` / `Heavier than yours` |
| Balance | `balance` | `More head-light` / `More head-heavy` |
| Flex | `flex` (Flexible < Medium < Medium-Stiff < Stiff < Extra Stiff) | `More flexible` / `Stiffer` |

The **first** dimension that differs wins, in that order — weight is the most
felt difference, flex the least. Identical on all three, or the player has no
racket set, renders the brand alone, as today. One phrase only: a card that lists
three deltas is a spec diff, not a nudge.

The existing tap-to-expand `reason` from `/api/recommend` is unchanged, and stays
the card's engagement affordance (Slice-0 kill-criterion).

### 3. Search in `GearSheet`

Search sits **above** the brand tabs; tabs remain. Browsing ("what does Victor
make") and finding ("it's called 88-something") are different intents and the
sheet serves both. Removing the tabs would undo the recognition-over-recall
decision shipped in `264a3b8`.

Client-side filter over the already-fetched catalog: no request per keystroke, no
debounce, instant. At 50 items — and well past 200 — the whole catalog is a
single cheap fetch, so a server round-trip would add latency and an offline
failure mode for no gain. If the catalog ever outgrows that, `?q=` moves to the
API without a UI change.

Matching is case-insensitive substring across `brand`, `model`, and
`attributes.series`, so "astrox", "88d", and "yonex" all find the same racket.
When a query is active the brand tabs are bypassed and results render flat across
all brands — filtering *within* the selected brand would hide matches and read as
broken.

**Series grouping is explicitly not built.** 39 rackets span 22 series (avg 1.8,
14 singletons); grouping would yield mostly one-row groups.

Empty search results render `EmptyState`, distinct from the load-failure
`ErrorState` — a search miss is not a broken screen.

### 4. Bag view

**Schema.** `PlayerGear` gains one optional field:

```ts
/** Id of the GearItem the player is currently using. Absent on legacy docs —
 *  readers fall back to the first racket in items[]. */
activeRacketId?: string;
```

A top-level pointer, not an `active: true` flag per item: a flag permits two
rackets to both claim active with no tiebreak, and every reader would need to
decide what to do about it. The pointer makes "exactly one active" unrepresentable
in the wrong state.

Additive and optional, per the schema rule — stable and next share one Cosmos DB.

**Read tolerance.** A resolver mirrors `normalizeBirdUsages()`:

```
activeRacket(gear) =
  items.find(i => i.id === gear.activeRacketId && i.category === 'racket')
  ?? items.find(i => i.category === 'racket')   // legacy: first racket
  ?? null
```

Legacy single-racket docs therefore render exactly as they do today, with no
migration.

**API.** The bag must never be written as a whole-array PUT from the client.
CLAUDE.md:

> Atomic appends > read-modify-write via PUT: a client-side read-then-PUT on a
> shared doc can wipe the doc if the read step fails.

A dropped GET before a whole-bag PUT would silently empty a player's bag. Each
verb merges server-side against a fresh read:

| Verb | Body / query | Behaviour |
|---|---|---|
| `POST /api/equipment/gear` | `{ name, item }` | Append to `items[]`. If it is the player's first racket, also set `activeRacketId`. Rejects a duplicate `catalogId` with 409. |
| `PATCH /api/equipment/gear` | `{ name, activeRacketId }` | Set the pointer. 404 if the id is not a racket in `items[]`. |
| `DELETE /api/equipment/gear?itemId=` | — | Remove one item. If it was active, repoint to the first remaining racket, or clear. |
| `PUT /api/equipment/gear` | `{ name, item }` | **Unchanged**, back-compat. Still replaces same-category. No new caller. |

Every verb reuses the existing owner/admin gate (`verifyMemberAuth` →
`memberId`, else `isAdminAuthedWithMember`) — Security Rule 12 — with the auth
check above any body parsing (Rule 3), matching the current `PUT`.

The route has **no rate limiter today**, and `PUT` was the only write. `POST` and
`DELETE` make the bag append-and-remove shaped, which is worth a bound: 20/hr per
`(memberId, IP)` via `getClientIp` (Rule 6), placed before the auth check (Rule
4). This is a new addition, not an existing guard being reused.

**Bag cap:** 10 rackets per player. Not a product constraint — a bound on
unrestricted append to a doc a member controls.

**UI.** The hero card's tap target opens `GearSheet` as it does now. The sheet
gains a bag section above the picker: current rackets as rows, active one marked,
tap to activate, swipe/overflow to remove. Adding uses the existing
search-and-select flow, which now `POST`s instead of `PUT`s.

A player with one racket sees no bag section — it appears at two or more. The
single-racket experience is unchanged from today.

### 5. Offline

`GearSheet` already gates its save on `useOnline()`. Activate/remove gate the same
way. Reads degrade to the standard load-error pill; nothing renders a confident
empty bag on a failed fetch (`loadError` is already tracked and must stay
distinct from loaded-empty).

## Testing

| Area | Cases |
|---|---|
| Import | `category` is `'racket'` for all 50, never a play-style; no `partitionKey`; ids unique and `racket-`-prefixed; every item has a 2-element `skillRange`; the 4 overlaps keep existing `msrp`/`sources`; count is 50. |
| `activeRacket` resolver | pointer hit; pointer to a deleted id → first racket; legacy doc with no pointer → first racket; empty items → null; pointer to a non-racket → first racket. |
| `POST` | appends without clobbering; sets pointer on first racket only; duplicate `catalogId` → 409; cap → 409; non-owner → 401. |
| `PATCH` | sets pointer; unknown id → 404; non-owner → 401. |
| `DELETE` | removes; removing active repoints; removing last clears pointer; non-owner → 401. |
| Search | matches brand, model, series, case-insensitively; query bypasses brand tabs; no matches → `EmptyState` not `ErrorState`. |
| `RacketRow` | hero renders active racket; empty state renders prompt; load failure renders error pill, not empty. |
| Card content | `4U` + `83-88` → `4U (83–88g)`; missing `weightGrams` → bare `4U`; missing `playStyle` → plain-language line omitted entirely, no empty row; legacy 15-item racket (no `weightGrams`/`series`) renders without gaps. |
| `playStyle` normalize | `"Power (beginner step-up)"` → `Power`; `"All-round / Speed"` → `All-round`; `"Speed/Control"` → `Speed`; raw string in `attributes` is not mutated. |
| Rec comparison | lighter/heavier by weight class; falls through to balance when weight ties; to flex when both tie; identical on all three → brand only; no current racket → brand only; exactly one phrase ever renders. |

Existing suite is 1111 tests; these add roughly 25.

## Build order

1. **Catalog import** — everything reads it; carries the partition-key trap.
2. **Hierarchy** — pure UI, independently shippable, no schema risk.
3. **Search** — needs 1, independent of 4.
4. **Bag view** — schema + 3 verbs + UI; needs 1, reads better after 2.

1–3 are low-risk and can ship together. 4 is the substantive slice and should be
its own PR.

## Open questions

None. Per-session racket logging was raised and explicitly scoped out (see
Non-goals); revisit only if "using today" is later meant literally.
