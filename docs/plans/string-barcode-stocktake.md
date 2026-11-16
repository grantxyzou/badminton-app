# String barcode stocktake

**Track:** ROADMAP North Star — admin cost-automation (the string inventory). Replaces the photo step of `docs/plans/string-photo-stocktake.md`.
**Status:** in-flight
**Review on:** 2027-01-15 — how many stocktakes were saved by scanning, and how many barcodes did each club teach? If clubs still count by hand, scanning is not saving work.

## Problem

Grant, 2026-11-16, after the photo stocktake shipped and closed the iPhone app:
*"bad UX, why cant we just treat reading inventory like scanning a product in?
Can the barcode be read by camera? I can just scan, log amount, colour, then
recon whats in the app vs I just scanned."*

The photo asked a model to guess what was on the shelf: it misread lighting and
stacks, cost a model call per photo, and needed a person to correct each line
anyway. A packet and a reel carry a barcode, and a barcode is exact, free and
works offline. Asked whether the stocktake reconciles or adds: it reconciles —
a count replaces what the app worked out, and a purchase is what adds.

## Kill criterion

See the review line: if scanning is opened and abandoned for the hand count, the
barcode step is ceremony.

## Non-goals

- Adding stock by scanning ("receive stock"). The scanner could add a delivery
  instead of typing it into the purchase form; that is a later step.
- A barcode catalogue shipped with the app. A club teaches each barcode once,
  on its own shelf; nothing is guessed from a code the club has not taught.
- Any model call. Removing the photo removes the stocktake's AI cost.

## Decisions

- **Scan, then reconcile** (Grant, 2026-11-16: "yes go ahead"). The camera stays
  open; each read barcode adds one packet of the string and colour it was taught
  as, or asks how full a reel is. Done → the review screen, per string and
  colour: what the app says, what was scanned, the difference. Save stores a
  `stringCount` exactly as the hand count does (`source: 'scan'`).
- **A barcode is taught once per club**: an unknown code asks which shelf string,
  which colour (or mixed / not sure) and whether it is a packet or a reel, and
  the club remembers it as a `kind: 'stringBarcode'` row in `clubSettings` — no
  new container. A code taught again replaces the old answer, so a mistake is
  fixed by scanning it and teaching it right.
- **A string nobody scanned is left OUT of the count, never zeroed** — the same
  rule the photo had; "None left" counts it as zero on purpose.
- **The photo step is removed**: its route, its model, its downscaler and its
  share of the AI allowance. Older counts keep `source: 'photo'`.
- **The camera is read in the page** with `@zxing/browser` (EAN/UPC and Code 128),
  loaded only when scanning starts. The browser's own `BarcodeDetector` exists
  in Chrome on Android and not in Safari, so one library is the one path for
  every phone. `Permissions-Policy` moves from `camera=()` to `camera=(self)`:
  the page itself may ask for the camera, nothing it embeds may.
- **Checked on real stock** (Grant's photos, 2026-11-16: an Aerobite White/Blue
  packet and a BG80 Yellow 200 m reel). Yonex prints an EAN-13 on a colour
  sticker — `4549317924709` (BGAB, WHITE/BLUE 207), `4930379423758`
  (BG80-2, YELLOW 004) — so each COLOUR and each FORM (packet, reel) is its
  own code, and teaching a code once teaches its colour and form too; the
  Aerobite set is the combo colour `white / blue`. Read out of the whole
  photo, neither decoded at any size; cropped to the sticker both did, and
  the reel's only when turned upright. So the scanner reads frames itself
  (`lib/barcodeScanner.ts`): only the middle of the picture (a little more
  than the aiming box), at 1280×720, upright and turned a quarter on
  alternate frames, and the hint says "Hold the barcode close, inside the
  box". Through the live scanner in Chromium, with each photo as the camera,
  the packet read in 0.3 s and the sideways reel in 0.8 s.
- **The store apps scan from their next builds**: iPhone build 8 carries the
  camera usage key, Android versionCode 7 declares `CAMERA` (without it the
  WebView's camera ask is refused at once). `lib/nativeCamera.ts` reads the
  build; older builds count by hand.

## Shape

| Piece | File |
|---|---|
| Barcode memory | `lib/stringBarcodes.ts` |
| The tally (pure) | `lib/stocktakeTally.ts` |
| The camera | `lib/barcodeScanner.ts` |
| Teach a barcode | `app/api/stringing/stocktake/barcode/route.ts` |
| The sheet | `components/stringing/StocktakeSheet.tsx` |
| Tests | `__tests__/string-barcode-stocktake.test.ts`, `__tests__/components/StocktakeSheet.test.tsx`, `__tests__/group-stocktake.test.ts` (two clubs) |
