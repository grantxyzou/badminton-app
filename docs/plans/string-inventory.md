# String inventory, and the strings the club offers explained

**Track:** ROADMAP North Star — admin cost-automation (what the club spends on string, next to what it spends on shuttles) and enabled learning (a member choosing a string understands what they are choosing). Extends the stringing service (`home.stringing`, `admin.stringing`).
**Status:** shipped 2026-10-10
**Review on:** 2026-11-20 — has Grant logged at least one string purchase, and does the usage-and-cost figure match what he counts on the shelf? Have members opened a string's page from the Stringing tab? If stock was never logged, drop the inventory and keep the education card.

## Problem

Grant, 2026-10-09: *"String inventories, total tracking of string used, and
cost. on the stringing page, I want people to be able to see the strings I
provide with its attributes and qualities etc. Educational stuff."*

Today the club's offered strings are a list of plain labels
(`OfferedStringsDoc.strings`), a job records only `stringLabel`, and nothing
counts what went onto rackets or what it cost. Shuttles have all of that
(`birds`, `BirdsPage`); string has none. On the member side the request
sheet shows the same labels and nothing else — a member picking BG65 over
Exbolt 63 is guessing, while the catalog already holds 46 strings with
gauge, feel, type, ratings and tension range (`scripts/data/equipment-catalog.json`).

## Kill criterion

By the review date, if no purchase has been logged, the inventory half is
removed (the catalog links on offered strings stay — they cost nothing and
feed the education card). If no member has opened a string's page, the card
shrinks to the plain list it replaces.

## Non-goals

- Changing what a job stores. `stringLabel` stays the snapshot; usage is
  matched to an offered string by label at read time, so an old job counts
  and a renamed string is a visible gap, not a silent one.
- Per-job metre measurement. A set is a set (`setLengthM`, 10 m when the
  catalog has no figure); a stringer who cuts short is not going to log it.
- Pricing a string to the member. The rate card stays per service; the
  catalog's USD price is shown as "typical" like a racket's, never as what
  the club charges.
- Translating the admin inventory page. Admin surfaces are English by
  decision (CLAUDE.md); the MEMBER card and string page are translated.
- A new container for the catalog link: the offered-strings doc grows an
  optional map from label to catalog id, additive, and every existing
  reader of `strings: string[]` is untouched.

<!-- Everything above is the gate for starting. Everything below is appended as
     the work proceeds. -->

## Decisions

- **Usage is counted, never logged.** A job whose string has gone in
  (`strung`, `ready`, `picked_up`) is one set of the string its
  `stringLabel` names, matched to the offered list case-insensitively. The
  bench moving a job along IS the usage event, so there is no second thing
  for the stringer to remember. Beat a "metres used" field on the job (a
  stringer who cuts short will not log it) and beat a usage doc per job (a
  copy of the job list that drifts from it). A job whose label matches
  nothing is shown as "not on your list" with its count, so a misspelling
  is a visible gap rather than a silent one.
- **Metres are the unit; the set is the job.** A reel is 200 m, a set 10 m
  (`REEL_M`, `SET_M`), prefilled from the catalog's `reelLengthM` /
  `setLengthM` when the string is linked, editable on the purchase. Cost
  per set is the LATEST purchase's cost per metre × the set length — the
  `currentPricePerTube` rule, so "what the string on that racket cost" is
  its replacement cost, not an average over years of reels.
- **Rows in `clubSettings` (`kind: 'stringPurchase'`), not in `birds` and
  not a container of their own (reversed 2026-10-10, the day it shipped).**
  Every sum over `birds` filters adjustments by `type`; a third kind there
  would be one more thing each sum has to know. The first cut ensured a
  `stringStock` container on first touch, and production answered the Bench
  with "Couldn't load the string stock" (Grant: "Error?"). Creating a
  container was the one thing the route did that nothing else in production
  does, and a shared-throughput Cosmos database refuses a 26th container
  (`docs/azure.md` §3; the code defined 27, and the portal count §10 asks for
  was never read) — the likeliest cause, so the fix stops needing one.
  `clubSettings` already holds the gift cards and their claims; every reader
  of it is a point read by id or a query filtered on `kind`, so the new kind
  is invisible to all of them. Nothing had been written, so nothing moved.
  Purchases only — no reconcile adjustment yet; "what is left" is purchases
  minus counted sets, clamped at zero, and the review date asks whether
  that matches the shelf.
- **A purchase is `strings` outlay in the ledger, as kind `expense`.** The
  view already buckets `meta.category: 'strings'`; a new kind would have
  needed the view, the backfill's charged-refs scan and the reconcile
  taught. Id `strings:<purchaseId>` (a repeat 409s), voided on delete,
  `mirrorStringPurchase` never throws. Not in the backfill: the mirror has
  been on since before the first purchase could exist.
- **The offered list grows a link map, additively.** `OfferedStringsDoc.links`
  (label → catalog id) rides beside `strings`; every reader of the list is
  untouched, `GET /api/stringing/strings` carries both, and a PATCH without
  `links` keeps the ones already stored for the labels that survive, so an
  older client cannot wipe them. A link to a label not listed or an id the
  catalog lacks is dropped, not refused — the list is what is being saved.
  The admin links a string by picking a catalog match while typing it, or
  by the link glyph on an unlinked chip. Beat a catalog id on the JOB
  (`stringLabel` is a snapshot by design, and old jobs have none).
- **The member card explains, it does not sell.** "Strings we offer" lists
  the club's strings with the catalog's one-line character and `bestFor`;
  a linked one opens a sheet with ratings, a "what this means" paragraph
  per attribute (gauge class, type, feel), the spec rows every other
  catalog sheet uses, and the catalog's USD-derived price captioned as a
  shop's, with the club's price left to the rate card. Four short
  paragraphs under "How to choose a string" are the lesson. All of it is
  `home.stringing.offer.*` in both locales; the admin inventory is English
  by decision.
- **The card holds its order, not its space.** It sits after the stringer's
  queue in a `canBeEmpty` slot with no placeholder, like that queue: most
  members will see it, but a club with nothing listed shows nothing and the
  request form already explains that case.

## Shape

| Piece | Where |
|---|---|
| Purchase type, storage | `StringPurchase` in `lib/types.ts`; `STRING_PURCHASE_KIND` rows in `clubSettings` (`lib/stringStock.ts`) — no container of its own |
| Stock arithmetic, validation, storage | `lib/stringStock.ts` (`summarizeStringStock`, `validatePurchase`, `readStringCatalog`) |
| Ledger hooks | `stringPurchaseEntry`, `mirrorStringPurchase`, `mirrorStringPurchaseDeleted` in `lib/ledgerMirror.ts` |
| Catalog links on the offered list | `OfferedStringsDoc.links`, `readOfferedStringsWithLinks`, `normaliseLinks` in `lib/stringingStrings.ts`; `GET`/`PATCH /api/stringing/strings` |
| Admin routes | `GET`/`POST`/`DELETE /api/stringing/stock` |
| Admin UI | `StringStockCard`, `StringPurchaseSheet`, linking in `OfferedStringsCard` (all `components/admin/CommandCenter/`), on `StringingPage` |
| Member UI | `components/stringing/StringsWeOfferCard.tsx`, `StringDetailSheet.tsx`, slot in `components/StringingTab.tsx`; copy `home.stringing.offer.*`, `admin.stringing.strings.{linked,link,matches,linkHint}` |
| Tests | `__tests__/string-stock.test.ts`, `__tests__/group-string-stock.test.ts`, `__tests__/string-stock-read-failed.test.ts` (the 503 names its step); members-only and sweep canaries updated |
