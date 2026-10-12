# Strings we offer: trade-off map, product sheet, request picker — developer spec

**Date:** 2026-10-11
**Status:** Built (decisions on the open questions at the end)
**Design:** `Strings Shelf.dc.html` → 4a (card), 2e (product sheet), 2f (request picker); `String Sheet.dc.html` (sheet component)
**Builds on:** `docs/plans/string-inventory.md`
**Flag:** `NEXT_PUBLIC_FLAG_STRINGING` (unchanged)

## Overview

At the moment "Strings we offer" is a list of grey rows that look the same. It doesn't say whether a string is on the shelf or what a restring costs. This change plots each string by power and durability, shows the club's restring price and a stock band (In stock / Low / Out) everywhere a string appears, and turns the request form's string dropdown into a short list with price, stock and colour. The card is for browsing only. Requests still start from the Home card's request sheet.

**In scope:** Stringing tab card, string detail sheet, string picker in `RequestStringingSheet`, per-string price on the admin `OfferedStringsCard`, and the API and data changes below.
**Out of scope:** the quiz, compare and filter explorations (2a–2d), and per-colour stock.

## The flow

1. A player opens the **Stringing** tab. "Strings we offer" opens on the **map**, with the first plotted in-stock string selected.
2. They tap a dot. The panel below the map switches to that string's name, price, numbers, best-for and stock.
3. **See how it plays** opens the **product sheet**. Closing it returns to the map with the same string selected.
4. **List** shows the same strings as rows sorted by power. Tapping a row opens the sheet.
5. Separately, **Request stringing** (opened from `StringingCard` on Home, as today) shows the strings as a radio list with price and stock. Out-of-stock rows can't be picked. Picking a multi-colour string shows colour chips. **Bring my own string** is the last row.
6. A summary line shows the string, colour, tension and price. **Send the request** posts as today, plus `stringColor`.

## Data

### What exists

| Need | Today | Source |
|---|---|---|
| Offered list + catalog links | `GET /api/stringing/strings` → `{ strings, links }`, member-gated, 120/h/IP; throttled → `{ strings: null }` | `app/api/stringing/strings/route.ts`, `lib/stringingStrings.ts` |
| Ratings, gauge, type, feel, colours | Catalog attributes: `repulsion`, `durability`, `control`, `gaugeMm`, `gaugeClass`, `stringType`, `feel`, `bestFor`, `ratingSource`, `colors` (`"White; Orange; Yellow"`; `/` marks two-tone, e.g. `"White/Yellow"`) | `scripts/data/equipment-catalog.json`, `useCatalog('string')` |
| Stock | `summarizeStringStock()` → `remainingSets` per label. **Admin only** (`GET /api/stringing/stock`) | `lib/stringStockMath.ts` |
| Price | Rate card per **service**, not per string; the sheet shows the catalog's typical shop range | `lib/stringingRateCard.ts`, `lib/catalogPrice.ts` |
| How many people play it | `tallyClubGear()`; entries below `CLUB_GEAR_MIN_COHORT` (3) are dropped | `lib/clubGear.ts` |

### Changes

**1. Per-string restring price.** This is additive on `OfferedStringsDoc`, the same pattern as `links`.

```ts
/** Offered label → restring price in cents for a restring with that string. null = "Ask". */
prices?: Record<string, number | null>;
```

- `normalisePrices(value, strings)` goes in `lib/stringingStrings.ts`. It drops labels that aren't in `strings` and any value that isn't `null` or an integer from 0 to `MAX_PRICE_CENTS`. It drops rather than refuses, like `normaliseLinks`.
- `PATCH` accepts `prices`. When `prices` is absent, the stored prices for labels that remain are kept, so an older client can't wipe them (the same rule as `links`).
- Prices are formatted with `formatServicePrice()`. The stringer sets them, so they're not estimates and get no tilde.
- `POST /api/stringing/requests` still never takes a price from the player. The job's `priceCents` stays `null` until the bench sets it.

**2. Stock band for players.** This is a pure function in `lib/stringStockMath.ts`.

```ts
export const LOW_STOCK_SETS = 3;
export type StockBand = 'in' | 'low' | 'out';
/** null when no purchase has been logged: unknown, never "out". */
export function stockBand(line: StringStockLine): StockBand | null {
  if (line.purchases === 0) return null;
  if (line.remainingSets === 0) return 'out';
  return line.remainingSets <= LOW_STOCK_SETS ? 'low' : 'in';
}
```

Players get the band only, never sets, metres or cost.

**3. Club count.** For each offered label, the count from `tallyClubGear()` (category `string`), matched by `labelKey()`. Labels below the cohort threshold are left out entirely.

**4. Colour on a request.** Add `stringColor?: string` to `StringingJob`. The requests route takes `label(body.stringColor, 30)`, is optional, and ignores anything that isn't a valid string. `toPlayerJob` and the bench job row show it. `stringLabel` stays the bare offered label so stock matching by `labelKey` keeps working. Colour must never be appended to the label.

**5. `GET /api/stringing/strings` response**

```jsonc
{
  "strings": ["Yonex BG80 Power", "…"],
  "links":   { "Yonex BG80 Power": "string-…" },
  "prices":  { "Yonex BG80 Power": 3200, "Li-Ning No. 1": null },   // missing = no price set
  "stock":   { "Yonex BG80 Power": "in", "Yonex BG66 Ultimax": "low" }, // missing = unknown
  "players": { "Yonex BG80": 8 }                                       // ≥ 3 only
}
```

A throttled or failed read returns every field as `null`, which means unknown. Readers already treat `strings: null` that way. Stock needs purchases plus every job, so add a 60 s in-memory cache per group for the `stock` and `players` fields.

## Surface 1 — Strings we offer card (4a)

`components/stringing/StringsWeOfferCard.tsx`. The shell is `glass-card p-5 space-y-3`, as today.

### Structure, top to bottom

1. **`CardHeader`**: icon `storefront` (today `science`; see open questions), title `offer.title`, subtitle `offer.subtitle` (new copy).
2. **View toggle**: two `bpm-chip`-style pills, **Map** and **List**, in `role="tablist"`. The selected pill uses the accent tint and border; the other uses the inner-card fill. Hit area is 44 px tall and the visible pill is 34 px. The choice is kept in `localStorage` under `bpm:strings-view`.
3. **Map view**: plot, legend, selected panel, then "Not on the map" rows (see below).
4. **List view**: `ListRow` per string.
5. **Lesson**: the existing `bpm-row-link` "How to choose a string" + `Collapse`, unchanged.

### The map

The geometry is a pure module, `lib/stringMap.ts` (no imports, so it's safe to test and import client-side), plus `components/stringing/StringMap.tsx`.

| | Spec |
|---|---|
| Plotted | Linked strings that have numeric `repulsion` **and** `durability` |
| Axes | y = `repulsion`, labelled "More power →" (rotated 90°, reads bottom to top, `fs-xs`, muted). x = `durability`, labelled "Lasts longer →" (right-aligned under the plot) |
| Domain | Per axis `[min − 1, max + 1]` of the plotted values. Widen evenly to a span of at least 4. Clamp the low end at 0; the high end may pass 10 to leave room for labels |
| Plot box | Full card width minus a 16 px axis gutter (6 px gap), 220 px tall, `var(--inner-card-bg)`, 1px `var(--inner-card-border)`, radius 12 |
| Guides | One dashed vertical and one dashed horizontal line through the domain midpoint, `rgba(255,255,255,0.10)`, `aria-hidden`. Decorative only |
| Dot | 14 px circle. In stock: `var(--accent)`. Low: amber. Out: transparent with a 2 px muted ring. Unknown stock or `showStock` off: `var(--accent)`. Selected: `0 0 0 3px` card-ground ring plus `0 0 0 5px var(--text-primary)` |
| Hit target | A 44×44 `<button>` centred on the dot |
| Same point | Strings that land on identical coordinates spread horizontally 10 px apart around the true point, in list order |
| Label | Model name (not brand), 12 px. Selected: `--text-primary` at 600 weight. Others: `--text-secondary` at 400 |

**Label placement** (`placeLabels()` in `lib/stringMap.ts`):

1. Place the selected string's label first, then the rest in list order (power descending).
2. For each label try right, left, above, then below the dot, with a 2 px gap.
3. Take the first spot that stays inside the plot box and doesn't overlap any dot or any label already placed. Measure widths with `CanvasRenderingContext2D.measureText` in the card font.
4. If no spot fits, show no visible label. The dot keeps its `aria-label`, and the panel names it once it's selected. The selected label is always shown.
5. Re-run placement on selection change and on resize (`ResizeObserver` on the plot box).

**Legend** (only when at least one plotted string has a stock band): In stock, Low and Out swatches, 8 px, `fs-xs` muted, 14 px gap.

**Selected panel** (`aria-live="polite"`): accent-tinted inner card (`rgba(74,222,128,0.06)` fill, `rgba(74,222,128,0.45)` border, radius 12, padding 12).

- Row 1: brand and model (Space Grotesk 16 / 600) on the left; price (mono 16 / 700) or "Ask" on the right. If no price is set, show nothing.
- Row 2: `offer.numbers` in mono `fs-sm`, `--text-secondary`.
- Row 3: `bestFor` in `fs-base`, `--text-secondary`.
- Row 4: stock band (6 px dot plus label, `fs-xs`) on the left; **See how it plays ›** on the right (text link, accent, 600 weight, 44 px tall).

**Not on the map**: linked strings without both ratings, and unlinked labels. Shown under a muted `section-label` as standard `ListRow`s, with an unlinked row disabled and using `offer.unknown`, as today. Hidden when empty.

### List view

- `ListRow` per string, sorted by `repulsion` descending, then `durability` descending, then label. Strings without ratings come last, then unlinked labels.
- Title: brand and model. Subtitle: `offer.listLine`, or `offer.unknown` for an unlinked label.
- Trailing: price (mono `fs-md` / 600) above the stock band (`fs-xs`), then `chevron_right`.

### States

| State | Trigger | Behaviour |
|---|---|---|
| Loading | Strings or catalog in flight | `useRevealReady` holds the slot, as today |
| Failed | `strings` is `null` or the request failed | `ErrorState` plus a retry button, as today |
| Empty | `strings: []` | Card renders nothing, as today |
| Too few to plot | Fewer than 3 plotted strings | List only; the toggle is hidden |
| Catalog failed | `catalog.loadError` | List only, labels only; every row disabled with `offer.unknown` |
| Stock unknown | `stock` is `null` or the label has no entry | No band on that string; it isn't counted in the legend |
| Price unset | No `prices` entry | No price shown. `null` shows `offer.priceAsk` |
| Shop closed | — | Not affected. Browsing doesn't depend on the shop sign |

### Interactions

- Tap a dot: select it and update the panel. The sheet doesn't open.
- **See how it plays**: open `StringDetailSheet` for the selected item.
- Tap a list row: open the sheet. If the string is plotted, it also becomes the map's selection.
- Default selection: the first plotted string in list order whose band isn't `out`, falling back to the first plotted string. It persists while the tab is mounted.

### Accessibility

- The plot is `role="group"` with `aria-label={offer.mapLabel}`. Dots are buttons with `aria-pressed` and `aria-label={offer.dotLabel}`. Tab order follows the list sort.
- Left and right arrow keys move the selection between dots in list order.
- The List view is the full text equivalent. Nothing is shown only on the map.
- Respect `prefers-reduced-motion`. The ring moves without a transition.

## Surface 2 — String detail sheet (2e)

`components/stringing/StringDetailSheet.tsx`. Same `BottomSheet` / `BottomSheetHeader` / `BottomSheetBody`, same title. Sections use `gap: var(--space-5)` as today.

1. **Header band** (new): inner card, radius 12, padding 16, with a type-tinted gradient (see Tokens).
   - Top row: type label (`section-label` size 11, colour from the type map) and a stock pill (`rgba(16,15,15,0.45)` fill, 6 px dot plus band label).
   - Bottom row: gauge in mono 28 / 600 with a "mm" suffix at 13 px, and `gaugeClass` + "gauge" in `fs-xs` beneath it. On the right, the price in mono 22 / 700 with `offer.restringWith` in `fs-xs` beneath it. Leave out the price block when no price is set.
2. **Best for**: unchanged.
3. **Fact chips** (new): wrapping row of inner-card chips (radius 8, padding 6×10, `fs-xs` secondary). The chips are tension range, feel, and level, taken from `catalogSpecRows`, plus a `group` icon and `offer.clubCount` when present. Leave out any chip whose value is missing.
4. **Colours** (new, only when `attributes.colors` exists): `section-label`, then 16 px swatch plus name for each colour. Split on `;` and trim; a `/` name renders as a half-and-half two-tone swatch. Below it, `offer.coloursNote` in `fs-xs` muted.
5. **Ratings**: the order becomes **Power, Control, Durability**. Rename the `repulsion` label to `offer.power`. The caption becomes `offer.ratingSourcePower`. Bars are unchanged.
6. **What this means**: unchanged.
7. **Specs**: unchanged, except that `typicalPrice` shows only when the club has no price for this string.

There's no request button; browsing only was the decision.

## Surface 3 — Request sheet string picker (2f)

`components/stringing/RequestStringingSheet.tsx`. The racket field, tension stepper, Custom request, error and Send all stay as they are. The `<select>` for the string is replaced. The sheet reads the extended `/api/stringing/strings` payload plus `useCatalog('string')`.

1. **Label**: `whichString` as a muted `section-label`.
2. **Radio list**: `role="radiogroup"`. Each row is a `role="radio"` button with `aria-checked`, inner-card styling, radius 12 and padding 12.
   - Contents: radio glyph (`radio_button_checked` in accent, or `radio_button_unchecked` in muted); a 36 px gauge tile (type-tinted, mono 11 / 600); label in `fs-md`; `stringSpecLine()` in `fs-xs` muted; then price above the stock band on the right.
   - Selected: accent tint and border.
   - Out of stock: `aria-disabled="true"`, opacity 0.5, can't be selected, and `aria-label={request.outOfStock}`.
   - Unlinked labels: no gauge tile, subtitle `offer.unknown`.
3. **Bring my own string** (built-in last row; it isn't an offered label): title `request.bringOwn`, subtitle `request.bringOwnSub`, trailing `offer.priceAsk`. Selecting it shows a text input under the list (`request.bringOwnPlaceholder`, `maxLength={80}`), and the typed value is sent as `stringLabel`. Remove "Bring my own" from the club's offered list when this ships, otherwise it appears twice.
4. **Colour**: shown only when the picked string has more than one colour.
   - `role="radiogroup"` of pills, each with a 16 px swatch and the name. The first colour is selected by default.
   - Below it, `request.colourNote` in `fs-xs` muted.
   - A single colour or a two-tone string sends that value with no chips. An unlinked string or Bring my own sends nothing.
5. **Summary** (new, above Send, hairline top border): `request.summary` in `fs-base` secondary on the left; the price in mono 16 / 700, or "Ask", on the right.
6. **Custom request**: unchanged. It still swaps the picker for free text and split tension, and carries the picked label forward.

Stock is advisory. The server **doesn't** refuse a request for an out-of-stock label, because a reel that hasn't been logged yet would make the band wrong. The UI blocks the row, and Custom request stays open as the way round it.

The loading, failed and empty fallbacks (`stringsLoading`, `mustBeCustom`) keep their current behaviour.

## Copy

All of these go under `messages/en.json`, and **every key needs a `zh-CN` entry as well**. Customer-facing copy never says "members" (house rule), so the count reads "in the club".

| Key | en | Notes |
|---|---|---|
| `offer.subtitle` | Higher hits harder. Further right lasts longer. Prices are for a restring. | Replaces today's subtitle |
| `offer.viewLabel` | View | Tablist label |
| `offer.viewMap` / `offer.viewList` | Map / List | |
| `offer.mapLabel` | Strings by power and durability | |
| `offer.axisPower` / `offer.axisDurability` | More power → / Lasts longer → | |
| `offer.dotLabel` | {name}: power {power} out of 10, durability {durability} out of 10 | |
| `offer.stock_in` / `_low` / `_out` | In stock / Low / Out | |
| `offer.numbers` | Power {power}/10 · Durability {durability}/10 · Control {control}/10 | |
| `offer.listLine` | Power {power} · Durability {durability} | |
| `offer.seeHow` | See how it plays | |
| `offer.notOnMap` | Not on the map | Section label |
| `offer.priceAsk` | Ask | |
| `offer.restringWith` | Restring with this string | |
| `offer.clubCount` | {count} in the club play it | Only when the count is ≥ 3 |
| `offer.colours` / `offer.coloursNote` | Colours / The maker's colours. Ask the stringer which are on the reel. | |
| `offer.power` | Power | Replaces `repulsion` in the sheet |
| `offer.ratingSourcePower` | Ratings: {source}. Power is the catalog's repulsion score. | |
| `request.bringOwn` / `request.bringOwnSub` | Bring my own string / Hand it over with the racket. | |
| `request.bringOwnPlaceholder` | Which string? e.g. BG80 white | |
| `request.colour` / `request.colourNote` | Colour / The stringer confirms the colour when you hand the racket over. | |
| `request.outOfStock` | {name}, out of stock | aria-label |
| `request.summary` | {string} · {colour} · {tension} lb | Leave out `· {colour}` when there's no colour |
| `admin.stringing.strings.price` | Restring price | Admin price field |
| `admin.stringing.strings.priceHint` | Leave empty to show "Ask". | |

## Tokens and colours

Use the app's tokens and classes from `app/globals.css`. Wherever the design file shows a literal, the token in this table replaces it.

| Use | Token / value |
|---|---|
| Text | `var(--text-primary)`, `var(--text-secondary)`, `var(--text-muted)` |
| Accent (in stock, selection, links) | `var(--accent)` |
| Low stock | Amber, `var(--color-amber)` (confirm it exists in app globals; the mock uses `#fcd34d`) |
| Inner fills | `var(--inner-card-bg)`, `var(--inner-card-border)` |
| Radii | Pills `var(--radius-pill)`, rows 12, chips 8 |
| Mono figures | `var(--font-mono)` |
| Type tint: repulsion | `#fb923c` (orange-400), gradient at 26% → 7% alpha |
| Type tint: control | `#93c5fd` (blue-300) |
| Type tint: durability | `#4ade80` (accent) |
| Type tint: hybrid | `#c4b5fd`, **not a system colour** (see open questions) |
| String swatches | Data colours, not UI tokens: White `#f1f5f9`, Yellow `#facc15`, Fluorescent yellow `#d9f99d`, Orange `#fb923c`, Red `#f87171`, Blue `#60a5fa`, Pink `#f9a8d4`, Green `#4ade80`, Purple `#a78bfa`, Black `#1f2937`, Gold `#eab308`. Unknown names get `var(--text-muted)` |

Light mode: every UI colour comes from tokens. Type tints and swatches stay fixed, with a 1 px `inset` ring at 30% ink so white swatches show on cream.

## Admin: price per string

`components/admin/CommandCenter/OfferedStringsCard.tsx`. Tapping a chip's label opens a small inline row with a `$` number input (`inputMode="decimal"`, 0–1000). It saves through the existing `save()`, which gets `prices` added to the PATCH body, and uses the same optimistic update with rollback. An empty field is stored as `null`, which shows "Ask". Removing a chip also drops its price.

## Tests

- `stockBand`: no purchases → `null`; 0 sets → `out`; 1 and 3 → `low`; 4 → `in`.
- `normalisePrices`: drops unknown labels, floats, negatives and values over `MAX_PRICE_CENTS`; keeps `null`; when `prices` is absent, keeps the stored values.
- `GET /api/stringing/strings`:
  - `players` leaves out counts below 3.
  - `stock` leaves out labels with no purchase.
  - A throttled read sets every field to `null`.
  - Players never see `remainingSets` or any cost.
- `lib/stringMap`:
  - Domain padding and the minimum span.
  - Same-point spread.
  - No label leaves the plot, and labels don't overlap.
  - The selected label is always placed.
  - Fewer than 3 plotted strings → list-only flag.
- `POST /api/stringing/requests`: `stringColor` is optional, trimmed and capped at 30, and a non-string is ignored. `priceCents` stays `null`.
- Add `lib/stringMap.ts` and `lib/stringStockMath.ts` to `__tests__/client-server-import-canary.test.ts`.

## Files

| File | Change |
|---|---|
| `lib/stringingStrings.ts` | `prices` on the doc, `normalisePrices`, read helper returns prices |
| `lib/stringStockMath.ts` | `LOW_STOCK_SETS`, `StockBand`, `stockBand()` |
| `lib/stringMap.ts` | **New**: domain, positions, label placement |
| `app/api/stringing/strings/route.ts` | Extended GET payload with cache; PATCH accepts `prices` |
| `app/api/stringing/requests/route.ts` | Optional `stringColor` |
| `lib/types.ts` | `StringingJob.stringColor?` |
| `components/stringing/StringsWeOfferCard.tsx` | Toggle, map, list, not-on-map rows |
| `components/stringing/StringMap.tsx` | **New** |
| `components/stringing/StringDetailSheet.tsx` | Header band, chips, colours, Power rename |
| `components/stringing/RequestStringingSheet.tsx` | Radio list, Bring my own, colour, summary |
| `components/admin/CommandCenter/OfferedStringsCard.tsx` | Price per string |
| Bench job row | Show `stringColor` |
| `messages/en.json`, `messages/zh-CN.json` | Keys above |

## Open questions

1. **Low threshold.** Is 3 sets or fewer right for "Low"? A reel is about 20 sets.
2. **Pricing model.** Is the price one per string, or the rate card's labour price plus a per-string string cost? This spec assumes one all-in price per string.
3. **Hybrid tint.** Violet isn't in the system. Should it use a neutral glass tint instead, or approve the colour?
4. **Hybrid cross gauge.** The design shows "0.72 mains / 0.61 crosses" for Aerobite Boost. Does the catalog have a cross-gauge attribute? If not, the sheet shows the mains gauge only.
5. **Club count matching.** Gear labels are free text. Should strings be matched by `catalogId` when a gear item carries one, rather than by label?
6. **Bring my own price.** "Ask", or the rate card's labour-only service if there is one?
7. **Header icon.** Change `science` to `storefront`? Confirm `storefront` is in the loaded icon font.

### Decisions (2026-10-11, at build)

1. **Low threshold:** 3 sets or fewer, as written (`LOW_STOCK_SETS`).
2. **Pricing model:** one all-in price per string, set by the stringer (Grant).
3. **Hybrid tint:** violet `#c4b5fd` approved as a data colour for hybrids (Grant). All-round takes the neutral inner-card fill.
4. **Hybrid cross gauge:** the catalog has `gaugeCrossMm`; the sheet's header band shows it under the mains gauge.
5. **Club count matching:** by label, and for a linked string by the catalog's own `<brand> <model>` too, which is what a bag item picked from the catalog is labelled.
6. **Bring my own price:** "Ask".
7. **Header icon:** `storefront`, added to `lib/iconNames.ts` with `radio_button_checked`, and the subset font rebuilt (Grant).

Build notes: the gauge figure uses `--fs-count` (34px) rather than the mock's 28px, because the type scale has no 28 rung; the stock cache runs against real Cosmos only, like the catalog memo. "Bring my own" should come off the club's offered list now, or it appears twice in the picker.
