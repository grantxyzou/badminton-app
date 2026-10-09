# String inventory, and the strings the club offers explained

**Track:** ROADMAP North Star — admin cost-automation (what the club spends on string, next to what it spends on shuttles) and enabled learning (a member choosing a string understands what they are choosing). Extends the stringing service (`home.stringing`, `admin.stringing`).
**Status:** in-flight
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

## Shape
