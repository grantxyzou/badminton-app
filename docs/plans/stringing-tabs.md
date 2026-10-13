# Stringing tab: Racket · Strings · Bench

**Track:** North Star pillar 4 (equipment service), the same track as [`bench-redesign.md`](bench-redesign.md): the Stringing tab is the player half of the stringing service, and the bench is the admin half.
**Status:** shipped 2026-10-12 (#614); labels renamed the same day

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
- **The labels say what each tab is for** (Grant, 2026-10-12, after #614 shipped): Racket → "Submit request", Strings → "Pricing details", Bench → "Stringing jobs". The service card's link to the second tab now uses the same words as the tab it opens. Only the labels changed; the ids stay `racket` / `strings` / `bench`, because HomeShell keeps the chosen id across a refresh.
- **Design-system pass, the same day** (Grant: "review design system and see if we are following it", then "all of them" to the findings). One set of rules across the three registers:
  - **Headers.** Every card uses `CardHeader compact`: a card that names a thing gets the section-label title with a muted icon. Pricing details was the odd one out with the full heading and an accent icon. The bench keeps no header (see above).
  - **Accent** marks only the way in on each register: "Submit a request", "See how it plays", "Add job", plus the active tab. Status pills, row icons and secondary links are neutral. The map's dots and its selected panel keep accent, because those are state and selection.
  - **Job rows** stay three components, because the player, stringer and admin rows are different projections of the money: a band, nothing, the exact figure. They follow one set of rules: body face for words, mono for the tension with "lb", `--text-muted` for the spec line, `dueStyle()` for the date (bold only when it asks for something), and `STATUS_TONE` for the pill.
  - **Failures say so.** That covers the catalog, the pricing read in both places, the shop toggle and a failed request send. A failure never shows up as "Not in the catalog yet", "Ask" or silence.
  - **Left alone, on purpose:**
    - **The shared `RegisterSwitch` height.** Its 28px tabs pass WCAG 2.5.8, and changing it would also change Stats.
    - **A failed stringer check means no tab.** That is still deliberate, and listed as open.
    - **Late is red.** It is a promise already missed, not a deadline coming up.
    - **English "Submit request" matches the request link.** It was Grant's choice. The zh tab is 申请穿线, so the two buttons no longer share a name there.

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
