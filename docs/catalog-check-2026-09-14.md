# Racket catalog check — 2026-09-14

Grant asked for the racket catalog to be checked against real listings and for the missing current models to be added. The catalog went from 71 rackets to 157. Every racket still passes `isScorable`. Six rows are withdrawn with `unlisted` (below), so 151 are offered.

## How
- One research pass per brand (Yonex, Victor, Li-Ning), with the same rules for each:
  - use the maker's page first, and retailers that print a spec table second;
  - map the page's wording onto the engine's fixed vocabularies;
  - never infer a spec from a series sibling;
  - give a URL for every value.
- New models went through `scripts/import-racket-db-v2.mjs`, the documented author-time path. It derives `msrp` (USD × 1.38) and `skillRange` from tier.
- Corrections were applied to both `racket-database-v2.json` and the catalog, so re-running the importer cannot revert them.

## Rules applied, and why
- **A sourced value replaces a wrong one.** That meant 268 field changes, mostly current USD prices, weight classes, grip sizes, tension ceilings, flex and balance. Each touched row gets `lastVerified: 2026-09-14`, and `skillRange` follows its tier.
- **Nothing is blanked because a page was silent.** A blank `balance`, `flex` or `tier` makes a racket invisible to the recommender. The one exception is a tension *floor* the maker never printed: it was removed, because the scorer reads the ceiling and an invented floor is not a spec.
- **Grams follow the weight class.** On Yonex rows, "83–88 g" is the typical 4U/3U frame and "80–89 g" is the class boundary. Rewriting one as the other would also contradict the curated `weightGrams` text, so 21 such restatements were not applied.
- **Curated CAD prices stay.** Rows with a hand-set `msrp` and a retailer link keep that price, per the importer's own rule. Several of those prices now look out of date (see below).
- **No row was removed.** A member's bag may point at any of these ids. Seeding also never deletes a Cosmos row, so removing one from the JSON would not remove it from production.

## Decisions for Grant

### Withdrawn with `attributes.unlisted` (Grant, 2026-09-14)

`lib/catalogOffer.ts` `isOffered()` drops these rows from both recommenders and from every "Add a racket" list. Each row stays in place, so a bag that points at one still shows its name and specs. The flag records its reason:

- **`not_a_model`:** NitroLite 80X, Halberd 900, G-Force Superlite.
- **`duplicate`:** AxForce 90 Dragon (the Dragon Max is the real row).
- **`discontinued`:** plain Nanoflare 700, Air Force 79. These did exist, so the reason says so.

### What the check found for each
| Row | What the check found |
|---|---|
| `racket-victor-nitrolite-80x` | Not a racket. NitroLite is Victor's shoe foam, and no racket in Victor's catalog carries the name. |
| `racket-li-ning-halberd-900` | No "Halberd" exists anywhere. The series is Halbertec, and Halbertec 9000 is already a row. |
| `racket-li-ning-g-force-superlite` | A series name (3500–3900, Max 9/10), not one racket, and none of those models is Even balance. |
| `racket-li-ning-axforce-90-dragon` | Only the Dragon Max exists, and `racket-li-ning-axforce-90-dragon-max` is already a row. |
| `racket-li-ning-air-force-79` | Not sold anywhere now. |
| `racket-yonex-nanoflare-700` | The original is discontinued. The current line is 700 Pro/Tour/Game/Play, now in the catalog. |

### Pairs the research called duplicates: renamed instead (Grant, 2026-09-14)

The research merged generations and editions of each pair into one "current" racket. A member may own the older one, so both rows stay, and the names now say which is which. The ids are unchanged.

| Row | Was | Now |
|---|---|---|
| `racket-yonex-astrox-88s-pro` | Astrox 88S Pro | Astrox 88S Pro (2nd Gen) — the 2021 model; 3rd Gen is its own row |
| `racket-yonex-astrox-99-pro` | Astrox 99 Pro | Astrox 99 Pro (2nd Gen) |
| `racket-victor-thruster-falcon` | Thruster Falcon | Thruster K Falcon Enhanced Edition |
| `racket-victor-jetspeed-12` | Jetspeed 12 | Jetspeed S 12 II — the successor; Jetspeed S 12 is the original |

Both 2nd-generation Yonex rows took their corrected specs and current US price from Yonex's current (3rd-generation) pages, because the older model has no page of its own now. The specs match; the price is the successor's.

### Real, but old or no longer sold
- **Victor:** HyperNano X 800 (2015), Brave Sword 1500, Arrow Speed 88.
- **Li-Ning:** N90 IV, Turbo Charging 75.
- **Market-only, no US price:** Yonex Astrox Lite 43i, Voltric Lite 35i and ArcSaber 71 Light are Asia/India models; Nanoflare X5 is a Korea-only pre-strung club racket; Li-Ning Ignite 8 is India-only.

### Kept values the check could not confirm
- **Victor:** balance and/or flex on Thruster Ryuga II, both JS-12 rows, DriveX 9X, Auraspeed Fantome, HyperNano X 900X, Arrow Speed 88 and HyperSonic. Victor rarely prints either.
- **Yonex:** grip on the Pro frames sold in both 3U and 4U. Their sizes span G4–G6, which the vocabulary cannot express.
- **Li-Ning:** Windstorm 72 is 72 g (6U), outside the vocabulary; its weight class was kept as 4U/5U.

### Curated prices that look stale (CAD `msrp` against today's USD retail)
- Li-Ning 3D Calibar 900: C$209 against US$250–300.
- Li-Ning Aeronaut 9000: C$249 against current US retail.
- Yonex Astrox 99 Pro, 88D Pro, 88S Pro, ArcSaber 11 Pro: C$309–329 against US$255–325.

## Judgement calls in the data
- **Yonex "Hi-Flex"** was treated as Flexible, on about 10 rows.
- **Tier** comes from list price, which puts some Yonex Play models in Mid-range.
- **Li-Ning "Hard Flexible"** was mapped only where a US retailer printed a clear grade; otherwise the model was skipped.
- **Drawings:** colours for the 86 new models follow `lib/racketLook.ts`'s method, and hexes read from text descriptions are approximate.
