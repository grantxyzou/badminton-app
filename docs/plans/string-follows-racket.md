# The string follows the racket

**Track:** none, and deliberately so: it fixes a shipped screen (Stats → Equipment, `components/stats/CLAUDE.md`) rather than starting anything.
**Status:** shipped 2026-11-05
**Review on:** 2026-12-03 — has a member with two rackets seen the wrong string or tension after a swap? Check a few bags with spares for strings with no `racketId`.

## Problem

Grant, on the design canvas (2026-11-05): "on the equipment card the string should follow the rackets. Today when I switch racket the string and tension stays with the new racket which is incorrect."

A bag held strings and rackets side by side, and "the member's string" was the newest live string in the bag. Swapping in a spare changed the racket line and left the string line, tension and all, as it was.

## Kill criterion

After a swap, the card shows a string or a tension that is not on the racket in play.

## Non-goals

- A restring history per racket beyond what `stringLog` already keeps.
- Moving a string from one racket to another. Add it to the other racket instead.

## Decisions

- **A string names the racket it is on**: `GearItem.racketId`, additive. `stringOn(gear, racket)` in `lib/activeRacket.ts` is the one rule: the newest live string naming that racket. A string naming no racket (written before 2026-11-05), or one naming a racket that is gone, belongs to the ACTIVE racket and to no other, which is exactly how it read before.
- **Legacy strings are pinned when the pointer moves**, not by a backfill. `writeGearDoc` compares the active racket before and after every write; when it changes, `pinLooseStrings` writes the old racket's id onto every loose string. One place, so no verb (PATCH swap, POST with `makeActive`, PUT of a racket) can forget it.
- **The same string may be on two rackets.** POST dedupes a string per racket, PUT matches by item id first (then the copy on the racket in play), the client sends the id, and strings take the racket cap (10). Deleting a racket deletes the strings naming it.
- **Every reader of "the member's string" reads the active racket's** (`currentString`): the Set-up card, `clubTension`, `fitVerdict`, `shareCard`, `frameDetail` (the owned racket's own string), the fit-verdict and share-card routes, and the verdict's refetch signature. The restring log records the racket the string names.
- **The card** (Grant, same day): racket and string together, a divider, then the spares, each with its own string; a spare opens its own `SetupLineSheet` (`spareId`); the Strings line's club count was dropped; the string's packet sits under the label, its coil drawn in the racket's string colour (`StringPackImage coil`, `STOCK_STRING` when none was picked, the white every racket picture is drawn with); the main racket close up across the right half with liquid-glass controls over it. The first close-up was the 240 × 624 list picture scaled up, and it was soft.

- **The card became design A** (Grant picked it on the Stats canvas the same day, after six comment rounds there): the eyebrow reads "Equipment"; roles lead each sub-line instead of label rows; the packet starts the strings line; "Racket and tension fitting" moved into the main area; the spares are one group with "+ Add a spare racket" and show no string; no club counts. The close-up is now each racket's own 540 px head render (`public/rackets/head/`, 154 files, about 6 MB on disk, one loaded per card), because the list picture scaled up was the "fuzz".

## Shape

| Piece | File |
|---|---|
| The rule | `lib/activeRacket.ts` (`stringOn`, `stringsOn`, `currentString`, `pinLooseStrings`) |
| Writes | `app/api/equipment/gear/route.ts`, `components/stats/useGear.ts` |
| The card and the spare's sheet | `components/stats/GearSetupCard.tsx`, `components/stats/SetupLineSheet.tsx` |
| Tests | `__tests__/gear-string-follows-racket.test.ts` |
