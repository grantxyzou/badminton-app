# A stringer names the strings and says their reel colours

**Track:** the stringing service (`home.stringing`): the roles split in `docs/roles.md` (stringer is not admin), and the colour work in `string-stock-by-colour.md`, which this finishes.
**Status:** shipped 2026-11-12
**Review on:** 2026-12-12 — has a stringer who is not an admin renamed a string or changed its reel colours, and has any such edit had to be undone by an admin?

## Problem

Grant, 2026-11-11, asked whether a colour the club is out of should be hidden
or greyed out on the request sheet: *"Allow string name edit and colour edit
from the stringer side so this scenario will not be run into."* Then, on
2026-11-12: *"open up reel and strining name, colour for stringers"*.

The request sheet now offers the reel colours set on the bench
(`string-stock-by-colour.md`). Only an admin could set them: the shelf lives
on the bench's set-up screen, and `PATCH /api/stringing/strings` is admin-only.
A stringer who is not an admin — the person who actually loads the reel — had
no way to say "this one is white now" or fix a misspelt name, so the colours a
member saw could go stale until an admin noticed.

## Kill criterion

If by the review date no stringer who is not an admin has used it, the card
is clutter on their page: remove it and keep the route open only to admins.
If an admin has had to undo a stringer's edit, narrow it (colours only).

## Non-goals

- Prices, the catalog link, adding or removing strings, aliases, purchases or
  stock. Those are the club's money and its list, and stay with an admin. A
  stringer still sees no money (`toStringerJob`).
- A new role or a new switch. `canString` in THIS club (`canStringIn`) is the
  gate, as it is for moving a job along.
- Changing what an admin can do or where they do it.

## Decisions

- **Two narrow writes, not the admin's PATCH.** A stringer may send
  `{ rename: { from, to } }` (the same operation the admin's sheet sends) or
  `{ colours: { <label>: ids } }` — one or more strings' reel colours, MERGED
  into the stored doc. Any other key is refused with 403 `forbidden_field`,
  never quietly dropped, the rule the jobs route already follows for a
  stringer. The admin's PATCH is unchanged; an admin may use the colours-only
  shape too, since it is just a smaller write.
- **Applied to the stored doc**, like rename, so a stringer's phone with an old
  copy of the list can never write that list back over an admin's.
- **The stringer's answer carries `strings` and `colours` only** — no prices,
  links or aliases. Prices are on the public read anyway; aliases are the
  admin's.
- **The card is on the stringer's own page** ("Stringing jobs" register, under
  their queue): each string as a row with its reel dots, opening a sheet with
  Name and Colours on the reel and one Save pinned at the foot (the sheet
  rule). Translated, because it is a member surface.

## Shape

| Piece | Where |
|---|---|
| Route | `PATCH /api/stringing/strings` — stringer branch (`canStringIn`, `verifyLiveMemberAuth`), `mergeColours` in `lib/stringingStrings.ts` |
| Card + sheet | `components/stringing/StringerShelfCard.tsx`, mounted in `components/StringingTab.tsx` |
| Copy | `home.stringing.shelfEdit.*` (en, zh-CN) |
| Tests | `__tests__/stringing-strings-stringer.test.ts`, `__tests__/components/StringerShelfCard.test.tsx` |
| Roles | `docs/roles.md` (Stringer row) |
