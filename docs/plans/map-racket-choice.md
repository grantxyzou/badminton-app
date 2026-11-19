# The strings map: your racket, another of yours, or "what do you play with?"

**Track:** North Star pillar 4 (equipment service), the same track as [`stringing-canvas-redesign.md`](stringing-canvas-redesign.md): the map is how a member picks the string for the one paid thing the app sells, and its glow is the "recommendations strong enough to suggest equipment purchases" half of the North Star.
**Status:** in-flight
**Review on:** 2026-12-16 — From `playerGear` and Grant's own bench: how many members with no racket added one from the strip's "Add racket", and did any of them already have the same racket typed in by name (the case the strip does not ask about)?

## Problem

Grant, on the design canvas frame "Idea B · 1 · nothing picked" (2026-11-18), on the "For your Astrox 88D Pro" strip under the map: "this should allow user change rackets".

The frame already draws a small "Change" label at the right end of the strip. It was never built: the strip names one racket, the one in play, and a member who brings their spare for a restring reads a map that glows for the other frame. The only way to move it is to go to Stats, swap the racket in play, and come back, which also moves their string, their tension and their racket recommendation.

Grant, reading the first cut (2026-11-19), asked "Remember on the phone?" and then set the model: "String goes on the racket and both are what I picked as my main. My main is default selected on the stringing page so the dot glow up. If there's no selection ie I didn't add my racket yet, the strip should ask for me what am I using then it can make a recommendation."

Until then a member with no racket saw no strip at all: the map said nothing about them and nothing about why.

And on the map's size (Grant, 2026-11-19): "Can you also make the total chart area width and height to be device screen aware? Ie: iPhone pro max displays the current height fine, but on iPhone pro or smaller androids it's cutting off and require scrolling. I want to avoid that". The plot was a fixed 280px tall on every phone; an iPhone Pro Max fits it by 4px and an iPhone Pro is 76px short.

## Kill criterion

The map, the peek, the list or a string's own page says "your &lt;racket&gt;" about two different rackets on one screen; or the route pairs a string with a frame that is not in the caller's own bag.

## Non-goals

- Changing the racket in play. Change moves what the MAP is matched to and nothing else: not `activeRacketId`, not the string on the racket, not the Stats recommendation.
- A racket the catalog does not know. A typed-in racket has no frame to pair a string against, so it is not offered, and a member whose racket in play is typed in still sees no strip (as before).
- Remembering the pick anywhere, on the phone or the account (see Decisions).
- A member with one racket: nothing new on their screen.
- A member whose racket in play is typed in by name. They told us what they play, so the strip does not ask again, and the catalog cannot pair it, so there is no strip (Grant, 2026-11-19: "If we don't have data on the racket for the strining page just don't show. Until we have data base"). The strip appears on its own once the racket is in the catalog and the member's bag row points at it.
- Opening the check-in from the strip. It points at Stats, where the check-in is.
- No scrolling on an iPhone SE (375×667) or a 360×640 Android: the card's text and controls alone leave the plot less than its floor. They scroll, as before, with a shorter map.
- Keeping the strip clear of the peek while a string is PICKED. The peek is a line taller then and covers part of the strip on a phone where the fit is exact, as it already did on an iPhone Pro Max.

<!--
Everything above is written BEFORE the work and is the gate for starting it.
-->

## Decisions

1. **The map always opens on the racket in play; a pick under "Change" is for the visit and is stored nowhere** (Grant, 2026-11-19: "My main is default selected on the stringing page"). The first cut remembered the pick on the phone (`localStorage`), and Grant's question about it is why it went: a remembered pick meant the page could open on a racket that is not the member's main, and would not follow a swap of the main. The pick now lives in the card's memory, is dropped when the member comes back to the tab after being away (`useTabReturn`, which also re-reads the match, so a swap made on Stats shows), and is gone on a reload. Saving it on the account lost for the reason it always had: the account already has one answer to "which racket", the racket in play.
2. **The parameter names a row in the caller's own bag, never a frame.** `racket=<bag item id>` is looked up inside the gear doc the member cookie points at, so no value in the query string ever reaches the catalog read. It beat `racket=<catalog id>` checked against the bag: that works, but one missed check pairs any frame, which is the reason the route took no frame from the query in the first place.
3. **A pick the bag does not hold answers for the racket in play, and says so** (`racketId` in the answer). It beat a 404: a pick goes stale the moment the racket is removed or retired on another phone, and the map's read would then fail for a reason the member cannot see. The card lets go of a pick the answer did not honour.
4. **The route lists the rackets; the card does not read the gear doc.** The gear read does return every racket logged, but it is keyed by name, carries the whole bag, and cannot say which rackets the catalog can pair. The fit read already holds the gear doc, so it answers `rackets` (bag item id, catalog name, in play) with the verdicts: one request, and the sheet can only offer what the route will accept.
5. **The sheet stays open until the new racket's answer is in.** A pick is applied only when its read comes back for that racket; a failure says so in the sheet and the map stays on the racket it was on. It beat closing at once and re-reading behind it, where a failed read made the strip, and the Change control with it, vanish with nothing said.
6. **A string's own page follows the map.** The card hands the racket the map is matched to down to the page's fit read (`?id=…&racket=…`), so the glow and "How it suits you" cannot name different rackets.
7. **With no racket in their equipment, the strip asks "What racket do you play with?"** and "Add racket" opens a search of the catalog's rackets. A tap ADDS the racket to the member's equipment as the racket in play, through the same `useGear().add` Stats uses, and the map is read again. It beat a link to Stats → Equipment (the member leaves the map to answer a question the map asked) and a pick kept only for the map (two answers to "which racket is mine" again). Catalog rackets only: a typed name cannot be paired, and Equipment is where one is typed.
8. **The server says what to ask** (`ask` on the `ids` answer), a racket before a check-in. A new member usually has neither, and the route used to answer `needs_check_in` before it looked at the bag, so asking for the racket had to come first or the people the ask is for would never see it. With the racket known and no skills rated, the strip names the racket and points at Stats ("Go to Stats", an in-app tab switch): without that, adding a racket would be followed by silence.
9. **The ask sheet owns the Strings register's one `useGear`, and is mounted on its first opening**, so the register reads no gear doc for a member who never taps the strip.
10. **The plot's height is what the screen has room for, between 140 and 280px; its width already followed the card.** `fitPlotHeight` takes where the card and strip end against where they must end for the page not to scroll (the screen, less the shell's bottom padding and the peek) and gives the plot the difference. Everything is measured off the page (the top inset, the tab bar with its home-indicator padding, the text size), never from a table of phones, and the answer does not depend on the plot's current height, so it settles in one pass. It beat a CSS `clamp()` on viewport height, which would have had to restate the height of every other row on the screen and gone wrong the first time one wrapped.
11. **The map does not resize for things the member does.** The peek is budgeted at REST (a tap on a dot makes it taller), the strip's room is reserved before it arrives, and the map holds still while "How to choose a string" is open. Grant's earlier rule for the zoom was "The chart area should not skip or grow", and it holds here too.
12. **The floor is 140px, with the zoom's ring drawn smaller under a short plot** (`ringRadiusFor`). 180 was the first floor and left a 360×740 Android scrolling by 48px; at 140 it scrolls by 8.
13. **The match strip wears the AI badge and the dots it recommends wear the badge's rim** (Grant, on a screenshot from his phone, 2026-11-19: "AI badge, can you apply the same AI rainbow stroke around the dots recommended that glow? Move the grey text to second line"). The rim is the one `--ai-rim` token, as a ring a hair off the dot (`.map-dot-ai`), so a dot keeps its type colour and its glow. The badge until now meant "a model wrote this"; the match is the pairing engine's (rules over the racket and the skill ratings), so its label says "matched by the app" and `AIBadge`'s own comment records the wider use as the owner's call. The two ask states keep the racket glyph: nothing is recommended yet.
14. **The Change sheet draws each racket** with `RacketThumb`, the pre-rendered picture Equipment uses, so the `ids` answer carries the racket's `catalogId` (the member's own, as their gear read already shows it; still never an input).

## Shape

| Piece | File |
| --- | --- |
| The optional `racket` choice, the `rackets` list and `racketId` on the answer | `app/api/stringing/fit/route.ts` |
| Which rackets in a bag can be paired (live, catalog-known, one per frame) | `lib/activeRacket.ts` (`pairableRackets`) |
| The answer's shape | `lib/types.ts` (`FitRacketChoice`) |
| The strip's three states (a match with Change, the racket ask, the check-in pointer), the visit's pick, the re-read on return | `components/stringing/StringsWeOfferCard.tsx` |
| The Change sheet | `components/stringing/MapRacketSheet.tsx` |
| "What racket do you play with?" | `components/stringing/MapRacketAskSheet.tsx` |
| What the strip should ask for (`ask`) | `app/api/stringing/fit/route.ts` (`askFor`) |
| The string page's read follows the map | `components/stringing/StringDetailSheet.tsx` (`fitRacket`) |
| The plot's height for this screen, and the ring's radius under it | `lib/stringMap.ts` (`fitPlotHeight`, `ringRadiusFor`), `components/stringing/useMapPlotHeight.ts`, `components/stringing/StringMap.tsx` (`height`) |
| Tests | `__tests__/stringing-fit-api.test.ts`, `__tests__/components/StringsWeOfferCard.test.tsx`, `__tests__/active-racket.test.ts`, `__tests__/string-map.test.ts` |
