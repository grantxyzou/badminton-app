# String stock by colour

**Track:** ROADMAP North Star — admin cost-automation (the string inventory, `string-inventory.md`) and the stringing service's member request. Extends `docs/plans/string-inventory.md`.
**Status:** shipped 2026-11-12
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

- **Two-colour sets and the club's own colours are reel colour ids too**
  (2026-11-12; Grant, on the canvas: "two colour combo like aerobites, and
  custom picker for future", then layout improvements 1, 4 and 6, then "yes
  fold it in and build it"). Rather than a second vocabulary beside the
  palette, both are ids in it, so the shelf's reel colours, a purchase's
  `color`, the per-colour pools, `colourStock` and `requestColours` take them
  with no new path:
  - `combo:<mains>+<crosses>` — each part a palette or club id, never the
    same twice. Its stored English name is `"<mains> / <crosses>"`, mains
    first, and `colourIdOf` reads that or the catalog's `"Red/White"` back to
    the id. A set needs no definition, so a stringer who is not an admin may
    make one. The club's sets are simply every set on any string's reel
    (`clubCombos`); there is no list to keep.
  - `custom:<rrggbb>` — the id IS the hex, so any reader draws it without
    a lookup and two colours that draw the same are one colour. The NAME
    lives on the club's strings doc, `OfferedStringsDoc.customColours`
    (`{ id, name, hex }[]`, additive; absent is none and an old doc is
    untouched). Club-wide so another string can reuse it. Name: 1–30
    characters, no "/", not a palette colour's name, unique in the club
    without case. An ADMIN adds one with `addColours` on the strings PATCH,
    applied before the colour lists so one Save can name and pick it; a
    stringer's `addColours` is the existing `forbidden_field`. The server
    drops a club id (alone or in a set) the club has not defined.
  - A job keeps its free-text `stringColor`; the request route's cap rose
    from 30 to 64 characters for a set of two club colours.
  - Not done: editing or deleting a club colour (nothing yet needs it, and a
    deleted one would strand purchases tagged with it), and the bench drawing
    a job's colour as a swatch (it shows the words, as before).
  - **Catalog colours, per retailer listings, 2026-11-12**: Aerobite
    "Red/White" (red 0.67 mm textured mains, white 0.61 mm crosses —
    Tennisnuts, W&D Strings, MKSG; only Badminton Warehouse says the
    reverse), Aerobite Boost "Yellow/Grey" (Racquet Guys US and Canada,
    Skylarsun "Yellow (Main) / Gray (Cross)"), BG80 without red (no retailer
    lists one). Its white/green and white/blue Aerobite colourways are left
    out until a listing says which side is which. Both data files carry it;
    the seed refreshes the rows because `attributes` are seed-owned. A job
    strung before this as "White/Red" maps to `combo:white+red`, the other
    way round, so it counts against the mixed pool.

## Shape

| Piece | Where |
|---|---|
| `color?` on a purchase | `StringPurchase` in `lib/types.ts`; `validatePurchase` / `logStringPurchase` in `lib/stringStock.ts` |
| Name ↔ id | `colourIdOf`, `PALETTE_EN` in `lib/stringPalette.ts` |
| Per-colour count | `summarizeStringStock` (`byColour`, `mixedRemainingSets`) in `lib/stringStockMath.ts`; jobs read with `stringColor` in `app/api/stringing/stock/route.ts` and `lib/stringShelfRead.ts` |
| Public map | `colourStock` on `GET /api/stringing/strings`; `parseShelf` |
| Request sheet | `requestColours` in `lib/stringShelf.ts`; `components/stringing/RequestStringingSheet.tsx` |
| Purchase form | `components/admin/CommandCenter/StringPurchaseSheet.tsx` |
| Sets and club colours | `comboIdOf`, `customColourError`, `addCustomColours`, `reelColourEnglish` in `lib/stringPalette.ts`; `reelColourFill`, `makerColourIds` in `lib/stringShelf.ts`; the picker `components/stringing/ReelColourPicker.tsx` (admin's `StringShelfSheet` and the stringer's `StringerShelfCard`) |
| Tests | `__tests__/string-stock-colour.test.ts`, `__tests__/string-reel-colours.test.ts`, `__tests__/components/RequestStringingSheet.test.tsx`, `__tests__/components/StringShelfCard.test.tsx`, `__tests__/components/StringerShelfCard.test.tsx` |
