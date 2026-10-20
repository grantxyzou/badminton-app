# Racket catalog re-check — 2026-10-20

A follow-up to `docs/catalog-check-2026-09-14.md`, using the same rules: the maker's page first, then retailers that print a spec table; never infer from a series sibling; a URL for every value. It covers the rows that check left alone or could not confirm, and two rows whose weight class and grams disagreed. Every row touched is stamped `lastVerified: 2026-10-20`, in both `racket-database-v2.json` and the catalog.

## Changed

| Row | Field | Was → Now | Source |
|---|---|---|---|
| `racket-li-ning-ignite-8` | grams | 75–82 → 75–79 (the 5U class) | https://topcricketstore.com/products/li-ning-ignite-8-black-maple-red-teal-badminton-racket-prestrung |
| `racket-yonex-nanoflare-nextage` | grams | 78–83 → 80–84 (4U, "83 g avg.") | https://us.yonex.com/products/nanoflare-nextage |
| `racket-victor-auraspeed-80x` | balance | Head-light → Even | https://www.tennisnuts.com/victor-auraspeed-80x-badminton-racket-frame-only-1467652.html |
| `racket-victor-brave-sword-1500` | weight | 4U/5U, 75–84 g → 4U, 80–84 g | https://www.gamepointinc.com/BRAVE-SWORD-1500P, https://kheladda.in/victor-brave-sword-1500-badminton-racket |
| | tension max | 25 → 24 ("H ≤ 24 lbs") | kheladda.in, as above |
| `racket-victor-hypernano-x-800` | tension | 19–28 → 20–27 | https://www.tennisnuts.com/victor-hypernano-x-800-badminton-1212905.html (the only source for the original; Victor's 27/28 are the LTD versions) |
| `racket-victor-thruster-ryuga-ii` | tension max | none → 32 (3U) | https://shop.au.victorsport.com/products/thruster-ryuga-ii-j |
| `racket-victor-jetspeed-12` (S 12 II) | tension max | none → 30 (3U) | https://shop.au.victorsport.com/products/jetspeed-s-12-ii |
| | flex | Medium → Stiff (two retailers agree) | https://joybadminton.com/products/victor-jetspeed-12ii-js-12ii-r-horizone-green, https://www.badmintonwarehouse.com/products/jetspeed-js-12-ii-badminton-racket |
| `racket-victor-drivex-9x` | flex | Medium → Stiff ("the stiffest shaft among all VICTOR's rackets") | https://ca.victorsport.com/product/drivex-9x-b |
| | tension max | none → 29 (3U) | same |
| `racket-victor-auraspeed-fantome` | flex | Stiff → Medium-Stiff (Victor's dot scale and two retailers agree) | https://shop.au.victorsport.com/products/ars-fantome-j, https://racquetguys.com/products/victor-auraspeed-fantome |
| `racket-victor-auraspeed-hyper-sonic-hs` | balance | Head-light → Even | https://racquetguys.com/products/victor-auraspeed-hypersonic-badminton-racquet |
| | tension max | 28 → 29 (3U) | https://ca.victorsport.com/product/auraspeed-hypersonic-b |

The Ignite 8 and Brave Sword rows also carry the old curated text fields `weightGrams` / `stringTensionLbs`. These were brought into line on those two rows; nothing renders them today.

**Confirmed and unchanged:**
- Thruster Ryuga II Pro: https://ca.victorsport.com/product/thruster-ryuga-ii-pro-b
- HyperNano X 900X: https://ca.victorsport.com/product/hypernano-x-900x

## Kept, because the sources disagree

- **HyperNano X 800, weight and balance:** one retailer says 3U and head-heavy, another says 4U and Even.
- **Jetspeed S 12 II, balance:** one retailer says head-light, another says Even.
- **Auraspeed Fantome, balance:** one retailer says head-heavy; another's table says head-light while its text says even.
- **Original Jetspeed S 12, balance and flex:** one retailer's table says head-heavy and medium-stiff, but its own reviewer called it evenly balanced. Changing a speed racket to head-heavy on that alone is the kind of single-source swing the rules exist to stop.
- **Auraspeed 80X, weight class:** only a 3U listing was found.
- **Ignite 8 and Brave Sword 1500, tension floor:** no source prints one.

## For Grant

- **Arrow Speed 88 (AS-88) has no trace** on Victor's sites or any retailer in this pass. The 09-14 check filed it under "real, but old". It stays offered until someone decides; withdrawing it would follow the `unlisted` precedent.
- **No longer sold:** Auraspeed 80X, HyperNano X 800 / 900X and the original Jetspeed S 12 are marked discontinued at UK/US retailers. The Nanoflare Nextage is sold out on Yonex US. They stay in the catalog because a member's bag may point at them.
- **Brave Sword 1500** is an India-market beginner racket. Its US$75–110 price has no current source; the price is advisory and was kept.

## Fixed along the way

The 2026-10-09 Astrox 88S relabel (Even, by the stringer's call) had been written to the catalog only. Re-running the importer would have put three of the four rows back to head-heavy. It is now in `racket-database-v2.json` too, and `__tests__/racket-db-v2-import.test.ts` fails if the two files disagree on any field the importer writes.
