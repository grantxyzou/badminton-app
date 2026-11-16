# String inventory as a list

**Track:** ROADMAP North Star — admin cost-automation (the string inventory). Follows `docs/plans/string-barcode-stocktake.md`.
**Status:** in-flight
**Review on:** 2027-01-15 — with a real shelf of 20+ strings, does the admin find a string by search or by opening "On the shelf"? If nobody ever opens the folded group, the fold is right; if every visit opens it, the shelf group should start open.

## Problem

Grant, on the Inventory canvas (2026-11-16):

- "I think for the strings card. Have the card only on the first level. The strings should just be a list, no container. … consider large list inventories."
- "Make this exactly as shown here. The app UI existing is ughly af."
- "a little competing controls" (Add beside Count, both filled).
- On String holes: "I think this should be part of the rackets?" and then "we never have that one list anyways".
- "Isn't this list a little long? If that's the case, like, how do we optimize for mobile? What's the principle?"
- Then "go with v3, build it in the app".

Every shelf string was a tile with a warning icon, a stocktake row sat under the list, the add field sat under that, and two more full cards (Other prices, String holes) waited under a list that grows with the club.

## Kill criterion

An admin who used to count by tapping Count on the old row cannot find the stocktake, or a string that needs reordering is missed because it sat in a folded group. Low on stock, out of stock and mismatched are never folded, so the second would be a bug, not a design outcome.

## Non-goals

- The stringer's own shelf card (`components/stringing/StringerShelfCard.tsx`). It keeps its tiles for now; it is a short list a stringer edits, not the club's inventory.
- Editing a hole count from the racket's page. Hole counts leave Inventory here and stay reachable from a stringing job's "Add a hole count"; a racket-page editor is a separate change.
- Any change to how stock is counted. This is the screen only; `lib/stringStock.ts` is untouched.

## Decisions

- **The principle (canvas v3):** a long list is fine when it IS the page and nothing waits under it. What needs someone (low on stock, out of stock, mismatched) is on top, open, under its own label; what is fine ("On the shelf", "No stock logged") starts folded, one tap or a search away. A search or a filter opens every group, so a match is never inside a folded one. Rules in `lib/shelfList.ts` (`shelfGroups`, `FOLDED_BY_DEFAULT`), which replaced the first cut's "Show N more" — a cut at an arbitrary row count is a web habit, and it hid strings for no reason of their own.
- **One card, plain rows.** A row is the packet (26×36), the name, a stock line (amber when the row needs someone, no warning icon: the label and the colour say it), the price and a chevron. No tile behind a row and no line between rows (`.shelf-row`).
- **A large shelf (more than 8) gets a search field, always shown, and one row of filter chips**, stuck under the page's top bar while the list scrolls. The bar condenses on scroll, so its bottom edge is measured, not guessed (`useStickUnderBar`). A small shelf is just the list.
- **Count is the header's one filled button.** The + beside it is a quiet icon that opens the add field. v2 and v3 drew the + in the page's top bar; in the app that corner belongs to the bell, language and theme buttons on every screen, and a + there sat on top of them. The header + is the state Grant accepted after "competing controls". An empty shelf shows the add field without it.
- **The header says when the shelf was last counted, as a date only** ("Strings · Nov 16"), as Grant drew it; a screen reader hears "Last counted Nov 16".
- **The money summary under the title is gone** ("Removed the summary … since the filter does summarize already").
- **Other prices is one row above the list** ("Other prices · Own string $20 ›") that opens a sheet with both fields and Save pinned to its foot, a phone's settings pattern. Closing without saving drops what was typed.
- **String holes left Inventory.** A job's "Add a hole count" opens its own page with the same card, preset to that racket (`view: 'holes'` in `StringingPage`). The data is unchanged: a `holeCount` row per racket in the club's `clubSettings`.
- **The bench row is "Inventory"** (was "Strings, stock, prices & holes").

## Shape

- `lib/shelfList.ts` — statuses, groups, chips, the fold.
- `components/admin/CommandCenter/StringShelfCard.tsx` — the list.
- `components/admin/CommandCenter/OtherPricesCard.tsx` — the row and its sheet.
- `components/admin/CommandCenter/StringingPage.tsx` — the Inventory page and the hole-count page.
- `app/globals.css` — `.shelf-*`, `.inventory-row-card`, `.string-pack-list`.
