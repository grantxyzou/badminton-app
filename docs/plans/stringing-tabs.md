# Stringing tab: Racket · Strings · Bench

**Track:** North Star pillar 4 (equipment service), the same track as [`bench-redesign.md`](bench-redesign.md): the Stringing tab is the player half of the stringing service, and the bench is the admin half.
**Status:** in-flight

## Problem

Grant, 2026-10-12: "can you add tabs to the stringing page like the stats page?"

The tab was one column of unrelated things: the admin's bench row, the service card (progress, request, a "View pricing" expander), then the strings shelf with its own prices. Prices appeared twice. The shelf, which is long, pushed everything else below it. And the bench, the admin's actual work, was a row that opened a separate page.

## Kill criterion

If a player can't find how to request a restring (the Racket tab is the default, so they shouldn't need to look), or if Grant goes back to opening the bench from Admin instead of from this tab.

## Non-goals

- Android back from a bench sub-screen (an existing deferred minor in `bench-redesign.md`).
- A push that opens the Bench tab directly. Push links still land on the tab's default.
- Any change to what the bench itself does.

## Decisions

Both were Grant's picks from a shape round, 2026-10-12:

- **Racket · Strings for everyone.** Racket holds the service card: request, progress and your rackets. Strings holds the shelf with every price, the own-string price and the stringer's note.
  - The service card's "View pricing" expander was removed, because Strings already shows each string's price beside it.
  - A "Strings and prices" link takes its place and switches tabs.
  - The alternative was a separate Prices tab. It lost because it would split a string from its price.
- **Bench as a third tab, only for admins and stringers.** The other option was keeping the row above the tabs.
  - **Admins** get the bench inline. It has no back header, because the tab bar already says where you are.
  - Job detail, intake, the archive and set-up take over the screen, the way Stats' Gear pages do. The tab chrome is hidden, not unmounted, so the bench keeps its data underneath.
  - **Stringers who aren't admins** get their queue there. `?view=stringer` now answers `canString`, so a stringer with nothing assigned still gets the tab, with an empty state.
- **The chosen tab lives in HomeShell, above the tab's refresh key.** It replaces `benchOpen`, so a pull-to-refresh doesn't reset you to Racket.
- **One register switch.** Stats and Stringing render the same `RegisterSwitch` primitive, so the two tab bars can't drift apart.

## Shape

| Piece | File |
| --- | --- |
| The tab and its registers | `components/StringingTab.tsx` |
| The register switch shared with Stats | `components/primitives/RegisterSwitch.tsx` |
| Tab state above the refresh key | `components/HomeShell.tsx` (`stringingView`) |
| Bench inline, and its takeover | `components/admin/CommandCenter/StringingPage.tsx` (`embedded`, `onTakeover`) |
| Strings: empty state, own-string price, note | `components/stringing/StringsWeOfferCard.tsx` |
| Stringer queue's empty state | `components/stringing/StringerJobsCard.tsx` |
| `canString` on the stringer read | `app/api/stringing/jobs/route.ts` |
| Chunk-loading frame | `components/TabFallbacks.tsx` (`StringingFallback`) |
