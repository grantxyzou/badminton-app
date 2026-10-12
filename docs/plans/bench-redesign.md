# Bench redesign: one strings list, set-up on its own screen, a way in from the Stringing tab

**Track:** North Star pillar 4 (equipment service), the same track as [`stringing-audit-fixes.md`](stringing-audit-fixes.md): the bench is where the stringing service is run, and this is the admin half of it.
**Status:** in-flight
**Review on:** 2026-11-12 — has any shelf string been left with no price, and has an off-shelf purchase or job label been left unaliased?

## Problem

Grant, 2026-10-12, with two screenshots of the bench: "Can you please fix the bench page's hierarchy, organization, navigation, visual design and also do all feature need to exist?"

Read off those screenshots and the code at `b5fcf067`:

- **The heaviest thing on the bench was the shop sign.** It was a green glass card with an h3, above a lighter job card. "Add job" was a second green slab, and "Archived (8)" was a full-width outlined button. The page is named for the jobs, and the jobs were the quietest block on it.
- **One shelf, three lists.** The same strings appeared as chips in "Strings you stock" (link, price and remove packed into each chip), again as rows in "String stock", and a third time in a paragraph, "Not on your list: … Add the name above, spelled the way the jobs have it".
- **The data was already wrong.** 20 sets were bought as "Lining No.1" while the shelf offered "Li-Ning No. 1". The offered string read "no stock logged" and showed players no stock at all, and the only fix offered was to retype a name.
- **Two price systems.** #602 gave every string a restring price, and the older "Your prices" rate card stayed as a second menu. One of its rows ("Pricing still being finalized; the cost below are estimated") is a note entered as if it were a service, and its rows overflowed the card at phone width.
- **Navigation.** The bench is Profile → Admin tools → Stringing bench, with Profile lit in the nav, while Stringing is a bottom-nav tab of its own.

## Kill criterion

Grant still has to scroll past set-up to reach a job, or he asks where a string's stock or price went. Either one means the split moved complexity instead of removing it.

## Non-goals

- The job detail and intake screens' own layout (only intake's price source changes, in PR 2).
- A view of unclaimed requests for non-admin stringers (`canString`): they keep `StringerJobsCard` on the Stringing tab.
- Rewriting stored purchase or job labels. An old spelling is ALIASED, never rewritten (see Decisions).

## Decisions

Grant's four calls, 2026-10-12 (each was the recommended option):

1. **Per-string price is the price.** The rate card shrinks to one "Bring your own string" price plus an optional note for players (PR 2). It beat "keep both", because two menus that disagree are worse than one, and "rate card only", because #602 already shows per-string prices to players everywhere a string appears.
2. **One Strings list.** Each row shows name, price and sets left. Tapping a row opens a sheet holding everything about that string (price, stock, purchases, catalog link, remove).
3. **Set-up gets its own screen**, reached from a row under the jobs. This **reverses finding 05 of [`stringing-audit-fixes.md`](stringing-audit-fixes.md)**, which folded set-up into a `Collapse` at the bottom of the bench. Folding kept the jobs first, but opened, it still put three tall cards under the list. A separate screen keeps the jobs first and gives set-up room. The shop sign stays at the top as Grant chose then ("bench first"), now as one line.
4. **Admins reach the bench from the Stringing tab** with a row at the top of the tab. The bench opens inside that tab, so the nav keeps Stringing lit. The Command Center row stays.

Made while building:

- **An old spelling is aliased, not relabelled.** A first idea was to rewrite the purchases' labels to the offered one. That would have broken #603's `renamed` mapping: jobs strung under the old spelling only count against the new label while a purchase still carries the old spelling. Those jobs would have fallen into `unmatched`, and the string would have shown more sets left than the shelf holds. `aliases` (old label → offered label) on the offered-strings doc is additive, maps purchases AND jobs, and rewrites nothing.
- **Mine/All shows only when the bench has two or more stringers**, read from the jobs already loaded (an All load), and stays once shown. Asking `/api/stringing/stringers` instead would have shown the segment one request late and pushed the list down.

## Shape

| Piece | File |
|---|---|
| Bench, set-up view, footer rows | `components/admin/CommandCenter/StringingPage.tsx` |
| One strings list + its sheet | `components/admin/CommandCenter/StringShelfCard.tsx`, `StringShelfSheet.tsx` |
| Aliases (stored, normalised) | `lib/stringingStrings.ts`, `app/api/stringing/strings/route.ts` |
| Aliases (counted) | `lib/stringStockMath.ts`, `app/api/stringing/stock/route.ts`, `lib/stringShelfRead.ts` |
| Bench row on the Stringing tab | `components/StringingTab.tsx`, `components/HomeShell.tsx` |
