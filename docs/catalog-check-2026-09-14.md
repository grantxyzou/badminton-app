# Racket catalog check — 2026-09-14

Grant asked for the racket catalog to be checked against real listings and for the missing current models to be added. The catalog went from 71 rackets to 157. Every racket still passes `isScorable`, so all 157 can be recommended.

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

### Not a real model — still in the catalog AND still recommendable until decided
| Row | What the check found |
|---|---|
| `racket-victor-nitrolite-80x` | Not a racket. NitroLite is Victor's shoe foam, and no racket in Victor's catalog carries the name. |
| `racket-li-ning-halberd-900` | No "Halberd" exists anywhere. The series is Halbertec, and Halbertec 9000 is already a row. |
| `racket-li-ning-g-force-superlite` | A series name (3500–3900, Max 9/10), not one racket, and none of those models is Even balance. |
| `racket-li-ning-axforce-90-dragon` | Only the Dragon Max exists, and `racket-li-ning-axforce-90-dragon-max` is already a row. |
| `racket-li-ning-air-force-79` | Not sold anywhere now. |
| `racket-yonex-nanoflare-700` | The original is discontinued. The current line is 700 Pro/Tour/Game/Play, now in the catalog. |

### Duplicates (two rows, one racket)
- `racket-yonex-astrox-88s-pro` = `racket-yonex-astrox-88s-pro-3rd-gen`
- `racket-yonex-astrox-99-pro` = `racket-yonex-astrox-99-pro-3rd-gen`
- `racket-victor-thruster-falcon` = `racket-victor-thruster-k-falcon` (both are the Thruster F)
- `racket-victor-jetspeed-12` = `racket-victor-jetspeed-s-12` (both are the JS-12)

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
