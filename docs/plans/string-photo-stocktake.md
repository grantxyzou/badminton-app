# String photo stocktake

**Track:** ROADMAP North Star — admin cost-automation (the string inventory). Follows `docs/plans/string-usage-rate.md`.
**Status:** intent
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

<Appended as the work proceeds.>

## Shape

<Appended as the work proceeds.>
