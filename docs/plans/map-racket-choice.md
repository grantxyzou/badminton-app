# The strings map: change which racket it is matched to

**Track:** North Star pillar 4 (equipment service), the same track as [`stringing-canvas-redesign.md`](stringing-canvas-redesign.md): the map is how a member picks the string for the one paid thing the app sells, and its glow is the "recommendations strong enough to suggest equipment purchases" half of the North Star.
**Status:** in-flight
**Review on:** 2026-12-16 — From Grant and the two-racket members he strings for: has anyone tapped Change, and did the map then stay on a racket they no longer play with (the pick is remembered on the phone and does not follow the racket in play)?

## Problem

Grant, on the design canvas frame "Idea B · 1 · nothing picked" (2026-11-18), on the "For your Astrox 88D Pro" strip under the map: "this should allow user change rackets".

The frame already draws a small "Change" label at the right end of the strip. It was never built: the strip names one racket, the one in play, and a member who brings their spare for a restring reads a map that glows for the other frame. The only way to move it is to go to Stats, swap the racket in play, and come back, which also moves their string, their tension and their racket recommendation.

## Kill criterion

The map, the peek, the list or a string's own page says "your &lt;racket&gt;" about two different rackets on one screen; or the route pairs a string with a frame that is not in the caller's own bag.

## Non-goals

- Changing the racket in play. Change moves what the MAP is matched to and nothing else: not `activeRacketId`, not the string on the racket, not the Stats recommendation.
- A racket the catalog does not know. A typed-in racket has no frame to pair a string against, so it is not offered, and a member whose racket in play is typed in still sees no strip (as before).
- Remembering the pick on the account (see Decisions).
- A member with one racket, or none: nothing new on their screen.

<!--
Everything above is written BEFORE the work and is the gate for starting it.
-->

## Decisions

1. **The pick is remembered on the phone, not saved on the account** (`localStorage`, `bpm:strings-racket`, beside the map's axis pick). It beat a field on the gear doc: the account already has a per-account answer to "which racket", the racket in play, and a second one would have to say which wins on every screen that reads a racket. A pick on the phone is a view setting, like the axis. The cost is that a second phone starts on the racket in play, and that the pick does not follow a later swap of the racket in play; the Review-on line asks whether that bites.
2. **The parameter names a row in the caller's own bag, never a frame.** `racket=<bag item id>` is looked up inside the gear doc the member cookie points at, so no value in the query string ever reaches the catalog read. It beat `racket=<catalog id>` checked against the bag: that works, but one missed check pairs any frame, which is the reason the route took no frame from the query in the first place.
3. **A pick the bag does not hold answers for the racket in play, and says so** (`racketId` in the answer). It beat a 404: a pick stored on a phone goes stale the moment the racket is removed or retired on another phone, and the map's first read would then fail for a reason the member cannot see. The card forgets a stored pick the answer did not honour.
4. **The route lists the rackets; the card does not read the gear doc.** The gear read does return every racket logged, but it is keyed by name, carries the whole bag, and cannot say which rackets the catalog can pair. The fit read already holds the gear doc, so it answers `rackets` (bag item id, catalog name, in play) with the verdicts: one request, and the sheet can only offer what the route will accept.
5. **The sheet stays open until the new racket's answer is in.** A pick is applied and remembered only when its read comes back for that racket; a failure says so in the sheet and the map stays on the racket it was on. It beat closing at once and re-reading behind it, where a failed read made the strip, and the Change control with it, vanish with nothing said.
6. **A string's own page follows the map.** The card hands the racket the map is matched to down to the page's fit read (`?id=…&racket=…`), so the glow and "How it suits you" cannot name different rackets.

## Shape

| Piece | File |
| --- | --- |
| The optional `racket` choice, the `rackets` list and `racketId` on the answer | `app/api/stringing/fit/route.ts` |
| Which rackets in a bag can be paired (live, catalog-known, one per frame) | `lib/activeRacket.ts` (`pairableRackets`) |
| The answer's shape | `lib/types.ts` (`FitRacketChoice`) |
| The phone's remembered pick | `lib/mapRacket.ts` |
| The Change control on the strip, the read for a pick | `components/stringing/StringsWeOfferCard.tsx` |
| The sheet | `components/stringing/MapRacketSheet.tsx` |
| The string page's read follows the map | `components/stringing/StringDetailSheet.tsx` (`fitRacket`) |
| Tests | `__tests__/stringing-fit-api.test.ts`, `__tests__/components/StringsWeOfferCard.test.tsx`, `__tests__/active-racket.test.ts` |
