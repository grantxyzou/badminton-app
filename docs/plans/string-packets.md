# String packets

**Track:** none, and deliberately so: it gives already-shipped screens (the Stringing tab's strings, a string's page, the request form) the picture the rackets got in `docs/plans/racket-fidelity.md`.
**Status:** in-flight
**Review on:** 2026-12-02 — has anyone said a string picture looks wrong, or that it helped them pick? Spot-check five packets against a photo.

## Problem

Grant, 2026-11-05, after the photo-matched rackets shipped: "can you do the same to render strings? like for stringing page". Asked whether a string should look like its reel, its retail packet or a coil, he chose the packet.

Until now a string on the Stringing tab was a name, a line of ratings and a few colour dots. Nothing showed what it looks like when the stringer holds it up.

## Kill criterion

A string's picture does not read as its packet at a glance. Check that the colour blocks, the model name, the window and the string's colour are in the right places when compared with a photo of the packet.

## Non-goals

- The maker's logo or wordmark. The model name is set in plain type; the brand is left off, as on the rackets.
- A photo of the packet. The pictures are drawn, so no retailer's image is copied into the app.
- Reels and coils (the other two options Grant was offered).
- Showing the string colour the club stocks. The packet shows the colour in its photo; the colour dots beside it still say what the stringer has.

## Decisions

- **A packet is data, drawn flat** (`lib/stringPack.ts`). The spec covers:
  - the card's aspect and colour;
  - polygons, ellipses and rules;
  - plain-type words;
  - rating bars;
  - a clear window with a coil of string behind it;
  - a hang slot;
  - a finish.

  `drawStringPack` paints it on a 2D canvas, and `scripts/render-string-images.mjs` pre-renders `public/strings/<id>.webp` (240×336, about 9 KB each) through the dev-only `/design/string-render` page. Nothing draws a packet live.
- **The table never reaches a screen.** `lib/stringPacks.ts` is imported only by the render page and the tests. A screen asks `stringPackSrc(id)` in `lib/stringPackSrc.ts`, a list of ids that the test holds equal to the table and to the files on disk.
- **Where it shows** (`components/stringing/StringPackImage.tsx`):
  - each row of the strings list, plus the map view's selected string;
  - beside the name on a string's page;
  - in place of the gauge tile in the request form.

  A string with no packet keeps what it had. In the list it keeps the packet's room while any row has one, so the names still line up.
- **Matched to photos by five parallel agents** (2026-11-05), with BG65 calibrated by hand from Yonex's own photo. Each entry records its photo `source`.

## Shape

| Piece | File |
|---|---|
| The type, its checks and the drawing | `lib/stringPack.ts` |
| The table | `lib/stringPacks.ts` |
| The ids a screen reads | `lib/stringPackSrc.ts` |
| Rendering | `app/design/string-render/page.tsx`, `scripts/render-string-images.mjs`, `public/strings/` |
| The picture on screen | `components/stringing/StringPackImage.tsx` |
| Tests | `__tests__/string-pack.test.ts` |
