# String stock by colour

**Track:** ROADMAP North Star — admin cost-automation (the string inventory, `string-inventory.md`) and the stringing service's member request. Extends `docs/plans/string-inventory.md`.
**Status:** in-flight
**Review on:** 2026-12-11 — has a purchase been logged with a colour, and has a request since then asked for a colour the club had none of? If no purchase carries a colour, drop the per-colour count and keep the reel colours driving the sheet.

## Problem

Grant, on the design canvas, 2026-11-11, pointing at the request sheet's
colour chips: *"this need to match and be dynamic to the strings inventory and
string type"*.

The chips came from the CATALOG (`stringColours(item)`: BG80 → White, Blue,
Yellow, Red) — what the maker sells, not what is on the club's reel. Two things
the stringer already says were ignored:

- the reel colours he sets on the bench's string sheet (`OfferedStringsDoc.colours`,
  since 2026-10-21) — the Stringing tab's string page shows them as "On the
  reel", and the request sheet two taps later offered the maker's list anyway;
- what he bought. A purchase recorded label, units, metres and cost, and no
  colour, so the app could say "BG80 is in stock" but not "only white BG80 is".

Asked whether colours the club is out of should be hidden or shown greyed out,
Grant answered: *"Allow string name edit and colour edit from the stringer
side so this scenario will not be run into."* — the stringer's own word on the
reel is the list, so a member is never offered a colour that is not there.

## Kill criterion

By the review date: if no purchase has been logged with a colour, the
per-colour count is dead weight — remove it and keep the reel colours (from the
bench) as the sheet's source. If a request still names a colour the club did
not have, the source order below is wrong.

## Non-goals

- A per-colour reconcile or adjustment. Stock stays purchases minus counted
  jobs (`string-inventory.md`); a colour is one more key on the same count.
- A new container, or a new doc kind. A purchase grows one optional field in
  its existing `clubSettings` row.
- Rewriting old purchases or jobs. An untagged purchase stays untagged
  ("Mixed / not sure") forever.
- Letting a non-admin stringer edit the shelf. The bench's string sheet
  (rename, reel colours) is admin-only, as every set-up card is; widening
  `canString` is a roles decision (`docs/roles.md`), not part of this.
- Showing members counts per colour. A member sees which colours they can
  pick, never sets, metres or cost — the same rule as the stock band.

## Decisions

- **One colour vocabulary: the palette ids** (`lib/stringPalette.ts`). A
  purchase stores `color` as a palette id, as the reel colours do. A job keeps
  its free-text `stringColor` (what the bench and the player read) and is
  mapped to an id at count time by `colourIdOf` — the catalog's names are the
  palette's English names, so "Fluorescent yellow" and `fluo_yellow` meet. The
  request sheet now sends the palette's English name for a palette colour, so
  a new job always maps; a two-tone ("White/Yellow") maps to nothing and
  counts against the untagged pool. Beat a second free-text colour on the
  purchase: free text is how "bg80", "BG-80" and "Bg 80 white" came about.
- **Two pools per string, never an overflow.** Tagged purchases count per
  colour; untagged ones form one "mixed" pool. A strung job whose colour has a
  tagged pool draws from it; any other strung job draws from the mixed pool.
  A colour that runs dry does not borrow from another — the line's own total
  (the band, the cost) is unchanged and still counts every job, so the
  per-colour view can only ever be MORE cautious than the total.
- **What the request sheet offers, in order** (`requestColours` in
  `lib/stringShelf.ts`):
  1. the string's base list — the stringer's reel colours when he has set
     them, else the catalog's (Grant's answer: his word wins over the maker's);
  2. if any purchase of the string carries a colour, only the tagged colours
     with sets left, plus the base list when the mixed pool still has sets
     (an untagged reel could be any of them);
  3. no tagged purchase at all → the base list, as before.
  Out of stock colours are HIDDEN, not greyed: with the stringer's list and
  the stock both driving it, there is nothing for a member to learn from a
  colour they cannot pick. One colour left → no question, sent as is.
- **The public read carries colours, never counts.** `GET
  /api/stringing/strings` adds `colourStock` (label → `{ inStock: ids,
  mixed: boolean }`), present only for a string with a tagged purchase. The
  admin read (`GET /api/stringing/stock`) carries the counts per colour on
  each line.
- **The purchase form asks for the colour** with chips: the string's reel
  colours, else the catalog's, else the whole palette; "Mixed / not sure" is
  the default and stores nothing, so a stringer who skips it logs exactly what
  he did before.

## Shape

| Piece | Where |
|---|---|
| `color?` on a purchase | `StringPurchase` in `lib/types.ts`; `validatePurchase` / `logStringPurchase` in `lib/stringStock.ts` |
| Name ↔ id | `colourIdOf`, `PALETTE_EN` in `lib/stringPalette.ts` |
| Per-colour count | `summarizeStringStock` (`byColour`, `mixedRemainingSets`) in `lib/stringStockMath.ts`; jobs read with `stringColor` in `app/api/stringing/stock/route.ts` and `lib/stringShelfRead.ts` |
| Public map | `colourStock` on `GET /api/stringing/strings`; `parseShelf` |
| Request sheet | `requestColours` in `lib/stringShelf.ts`; `components/stringing/RequestStringingSheet.tsx` |
| Purchase form | `components/admin/CommandCenter/StringPurchaseSheet.tsx` |
| Tests | `__tests__/string-stock-colour.test.ts`, `__tests__/components/RequestStringingSheet.colours.test.tsx` |
