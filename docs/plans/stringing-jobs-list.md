# Stringing jobs as a list

**Track:** ROADMAP North Star — the stringing service (the bench). Follows `docs/plans/string-inventory-list.md`.
**Status:** in-flight
**Review on:** 2027-01-15 — with a real week on the bench, does the stringer still open a job to read its spec, or do the row's M and C pills carry it? If every job is opened first, the row is carrying too little; if a wrong tension or string is strung from the row, it is carrying the wrong thing.

## Problem

Grant, on the Stringing jobs canvas (2026-11-16), with a screenshot of the bench:

- "this is today still a lot of scrolling"
- "can we use the racket render data, and call out the name maybe due date?"
- "HOW MIGHT WE DECREASE Stringer error by presenting racket information easily and detailed more info are easy to find?"
- "can we also differentiate requested main and cross vs. system default? Maybe call out custom M/C by the player. For strings that are two colours in a pack. M and C should use the perspective colour"
- "so many redundant information", "wtf is the outline stroke on the M and C?"
- "keep MC always vertical stack with the icon + tention + String"
- Then "go with A, build it in the app".

Every job was its own tall card with a next-step button, the spec written out as one line ("BG80 · Yellow · 23/25 lb"), and nothing set a player's own request apart from the usual pair.

## Kill criterion

A stringer strings a racket at the wrong tension or with the wrong string because the row showed it wrongly, or cannot find a job because it sat in the folded Picked up group. Picked up is the only fold, and nothing there needs the stringer.

## Non-goals

- The stringer's own queue (`StringerJobsCard`) and the archive keep the card. This is the admin's live bench.
- Any change to what a job stores. A hybrid is still "<mains> / <crosses>" in one label and a two-colour set one colour name; `lib/stringingSides.ts` only reads them.
- Moving a status from the list. The status moves on the job page.

## Decisions

- **One card, rows grouped by status** (`lib/benchGroups.ts`): Received, Strung, Ready for pickup, Requested, each "<status> · n"; Picked up folded at the foot. Inside a group, the bench's own order (pinned, then due).
- **The racket picture leads the row** (86×105, `racketHeadSrc`), its name under it. The stringer recognises the frame before reading a word.
- **M and C are always two stacked pills**: a letter circle in the string's colour (grey when none is recorded), the tension in mono, then "lb · <string>". No colour words; a two-colour set gives each side its own colour (`comboParts`).
- **A colour as dark as the pill keeps a faint light edge** (Grant: "fix the black string circle contrast"): `blendsWithDarkPill` in `lib/stringShelf.ts`, under 1.6:1 against the pill (black, navy). An inset ring on the circle only; the pill stays fill-only.
- **Where a colour comes from**: a player's request carries `stringColor`; a job added on the bench has no colour field, so a label ending in " · <colour>" ("BG80 · white") gives it, read only when the word is a palette colour (a club's own colours are not passed to the row yet) and then dropped from the string's name. Anything else draws the grey circle.
- **A player's own request is called out once**: "Custom request" when crosses are not mains + 2 (`isConventionalPair`) or the strings differ, and the tension numbers turn amber. No outline on the pills (Grant).
- **Grommet holes is a pill only when the count is known**; nothing when it is missing.
- **No next-step button on the row** (Grant hid it on the canvas). The ⋮ stays: SwipeRow's pin and archive are touch-only, and the menu is a desktop's way to them.
- **No tap-open details panel**: the row opens the job page.

## Shape

- `lib/stringingSides.ts` — a job's mains and crosses, read off its one spec.
- `lib/benchGroups.ts` — the groups and their order.
- `components/stringing/BenchJobRow.tsx` — the row.
- `components/stringing/BenchList.tsx` — the card, the groups and the fold.
- `components/admin/CommandCenter/StringingPage.tsx` — the live list uses them; the archive keeps `JobCard`.
- `app/globals.css` — `.bench-*`.
