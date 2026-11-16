# String photo stocktake

**Track:** ROADMAP North Star — admin cost-automation (the string inventory). Follows `docs/plans/string-usage-rate.md`.
**Status:** in-flight
**Review on:** 2026-12-31 — how many stocktakes were saved, and how far did the photo's first guess sit from the count the person confirmed? If the guess was corrected on most lines, the photo is ceremony: keep the hand count and drop the AI step.

## Problem

Grant, 2026-11-15: *"can we build a feature where taking a picture in app gives
the stocking inventory"*. The shelf's figure is worked out (bought minus
strung), so a reel nobody logged, or an own-string job nobody marked, leaves it
wrong with nothing to correct it against. A shop fixes that with a stocktake:
count what is physically there, and the count wins.

Asked how to count a part-used reel, Grant chose **both**: the photo's guess of
how full it is, and a weigh-in for the exact figure. Asked who may count:
**admins and stringers**. Asked the order: **usage rate first**, then this.

## Kill criterion

See the review line: if people correct the photo's guess on most lines, the
photo is not saving work.

## Non-goals

- Changing stock from a photo alone. The photo PROPOSES; a person confirms
  each line before anything is saved (the "never guess" rule the money code
  follows).
- Money. A count changes sets and metres; what a reel cost stays with its
  purchase.
- A native camera plugin. The web file input with `capture` opens the camera
  in the browser and in the app's WebView alike.

## Decisions

- **A count RESETS a string, it does not adjust it.** The latest count is the
  string's starting metres; only purchases logged after it and jobs strung
  after it (by `strungAt`, the usage-rate work) move it. Beat: an adjustment
  row (+3 / −2) like the shuttles' reconcile, which would have needed the
  counter to know the app's figure, and would stack wrongly when two counts
  are close together. History stays: sets used, cost and the rate still count
  every job.
- **A string the photo did not show is left OUT of the count**, never counted
  as none. A photo of half the shelf must not empty the other half. The
  counter taps "Count it" to include one.
- **The server re-adds every line.** The client's "You count 15" is a preview;
  `validateCount` works the sets out again from packets, fullness and weights,
  and stores both what was counted and what the app said at that moment.
- **Weigh-in: (scale − empty reel) ÷ grams per metre.** Grams per metre start
  from the catalog's gauge (nylon, ~0.41 g/m at 0.68 mm) and the empty-reel
  weight is typed once; both are kept on the count and prefill the next one,
  so the second weigh-in is one number. Whole sets only: a part set left on a
  reel is not a set.
- **The model: the current Opus**, reading one shrunk photo (≤ 240 KB of
  base64, under the proxy's 256 KB body cap) with the club's shelf list, and
  answering in a fixed shape (`ScanReplySchema`). A label not on this club's
  shelf comes back as "not sure" for the counter to place. The photo is never
  stored or logged. Server-side fallback on a refusal; 20 an hour per caller,
  30 a day per person.
- **Without an API key, counting by hand**: the same sheet, no photo button.
- **Who counts: an admin, or a member who strings for this club**
  (`stocktakeCaller`, re-read per call). The sheet's read carries sets only.
- **One stock loader.** The bench's stock route, the players' shelf bands and
  the club report each made the same five reads; adding counts would have been
  a sixth in three places. `loadStringStock` makes them all now.

## Shape

| Piece | File |
|---|---|
| Counting arithmetic (eye, weight, gauge) | `lib/stringStocktakeMath.ts` |
| A count resetting a string | `lib/stringStockMath.ts` (`counts`, `lastCount`) |
| Storage, the one loader, who may count, validation | `lib/stringStocktake.ts` |
| Reading the photo (prompt, reply shape, check) | `lib/stringStocktakeScan.ts` |
| Shrinking the photo in the browser | `lib/photoDownscale.ts` |
| Routes | `app/api/stringing/stocktake/route.ts` (GET, POST), `app/api/stringing/stocktake/scan/route.ts` |
| The sheet | `components/stringing/StocktakeSheet.tsx` |
| Doors | `components/admin/CommandCenter/StringShelfCard.tsx`, `components/stringing/StringerShelfCard.tsx` |
| Tests | `__tests__/string-stocktake.test.ts`, `__tests__/group-stocktake.test.ts` |
