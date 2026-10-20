# Grommet hole counts on the racket catalog

**Track:** ROADMAP North Star — Value-Hub Track 2 (Equipment: the frame page is "a reference you can check courtside") and the stringing service (`admin.stringing`: the stringer is the person who needs the number).
**Status:** in-flight — Phase 1 (Yonex) shipped 2026-10-20 (#658); Phase 2 (Victor) shipped 2026-10-20 (#660); Phase 3 (counted at the bench) built 2026-10-20
**Review on:** 2026-11-20 — did Phase 1 (Yonex, from the maker's pattern sheet) ship, and has the stringer looked up a hole count in the app instead of on the frame? If neither, drop Phases 2–3.

## Problem

Grant, 2026-10-20: "do we know if the rackets we have are accurate? and do they have # of grommet holes anywhere?" — they do not. The only grommets in the repo are the 3D drawing's (`lib/racketModel.ts`), which gives every racket the same invented 21 × 21 bed. Nobody else has asked for it yet, so this is a stringer's convenience before it is a member feature.

## What the sourcing research found (2026-10-20)

A one-off pass sampled 12 current frames. Full notes are in this PR's description. In short:

- **No maker prints a hole count as a spec.**
  - Yonex publishes an official stringing sheet: pattern families by model code, with the main start, skipped holes and tie-offs. The count is implied by the pattern, not stated. Source: https://us.yonex.com/pages/stringing-instructions, PDF dated May 2025.
  - Victor names "single-pass" / "Seven-Six 76" grommet tech on some product pages.
  - Li-Ning publishes nothing found, in English or Chinese.
- **One retailer has a count for nearly everything** (badminton-shop.com's "Grommets" row). In the sample, **2 of 12 conflicted with Yonex's own sheet**: it lists the Astrox 88D Pro at 72 and the 99 Pro at 68, but the 88D Pro shares a pattern with the 76-hole ArcSaber 11 Pro and Astrox 100ZZ.
  - Only 2 of 12 values had a second, independent source.
  - Only 1 of 12 came from the maker as an explicit number (the Nanoflare 800 Pro's "78-grommet" copy).
- **Yonex's "String Pattern 22 × 21" field does not convert to holes.** The outer strings share holes, so 22 × 21 is 76 holes, not 86. It also looks like boilerplate (the 99 Pro carries it despite having its own pattern).
- **Typical values:**
  - 72: traditional round heads, trainers.
  - 76: the current standard; Yonex Isometric with skipped head holes, and Victor Seven-Six.
  - 78: Nanoflare 800 Pro / Tour, 22 × 22.
  - 70, 80 and 88 exist in Victor's diagrams but could not be tied to models.

The conclusion: a bare number is cheap to scrape and wrong about one time in six, which is the catalog's own failure mode from before the 2026-09-14 check (`docs/catalog-check-2026-09-14.md`). So the field carries where it came from, and the app only shows the trustworthy kinds.

## Kill criterion

- Phase 1 covers fewer than half the offered Yonex rows from the official sheet. That would mean the model-code → pattern mapping is not workable, and a retailer scrape is not worth doing in its place.
- The stringer says the count is not what they need from the app. The pattern (start, skips, tie-offs) is what is used at the machine. Then store the pattern family and drop the count.

## Non-goals

- **No retailer-only number shown to members.** A single-retailer count is stored as `retailer` and hidden until a second independent source or a physical count agrees.
- **No filling from a series sibling.** This is the catalog's standing rule; the 88D Pro / 99 Pro errors are exactly what sibling inference produces.
- **No change to the 3D drawing.** `lib/racketModel.ts` stays a generic bed; drawing per-model patterns is design work, not data.
- **No stringing-job link to the catalog in this item.** `StringingJob.racketLabel` is free text by design (types.ts: a job is a snapshot). Showing holes on the bench needs a catalog id on the job; that is its own decision.
- **No string-length-per-job model.** Stock already counts one set per job (`lib/stringStockMath.ts`). Hole count does not change how much string a job uses in practice.

## Shape

As built in Phase 1. The proposal had three per-row fields (`grommetHoles`, `grommetSource`, `grommetUrl`); see Decisions for why it changed.

- **A racket row carries one additive, optional attribute, `stringPattern`** (e.g. `'yonex-1'`): the family Yonex's sheet puts its model code in.
- **The count lives on the family**, in `lib/stringPatterns.ts`, with how it is known and where.

| Piece | File |
|---|---|
| Families: the sheet's model codes, count, `HolesSource` (`pattern` / `retailers` / `counted`), URLs; `grommetHoles(item)` | `lib/stringPatterns.ts` |
| Data: `stringPattern` on 38 Yonex rows | `scripts/data/equipment-catalog.json` and `racket-database-v2.json` (both, so a re-import cannot revert it) |
| Importer passes it through | `scripts/import-racket-db-v2.mjs` |
| Seed refresh | none needed: `ensureCatalogSeeded` rewrites a seeded row whose fields changed |
| Frame page cell "String holes", after "Rated", only when the count is known | `lib/frameDetail.ts` `specCells`; `stats.gear.framePage.spec_holes` in both locales |
| Tests | `__tests__/string-patterns.test.ts`, plus the field list in `__tests__/racket-db-v2-import.test.ts` |

## Phase 1 result (2026-10-20)

Source: Yonex's stringing sheet, May 2025 (https://us.yonex.com/pages/stringing-instructions; Grant supplied the same PDF). It has six pattern families, listed by model code, and **gives no hole counts.**

| Family | What the sheet says | Holes | How we know |
|---|---|---|---|
| `yonex-1` | Mains skip A7, A9 & A11 (ArcSaber 11 / 7 Pro & Tour, Astrox 100ZZ & 100 Tour, the 3rd-gen 88S / 88D line, 88 Play, 77 Pro, 70) | 76 | `pattern` |
| `yonex-2` | Mains skip A8 & A10 (Nanoflare 1000 line, 800 Play, the 700 Pro / Tour / Game / Play line, Nextage; Astrox 100 Game, 77 Tour & Play, 01; ArcSaber 7 Play, 2) | 76 | `pattern` |
| `yonex-3` | The 2021 Astrox 99 line (`AX99-*`) | — | not confirmed |
| `yonex-4` | Astrox Nextage | — | not confirmed |
| `yonex-5` | Nanoflare 800 Pro / Tour / Game: the "78 Grommets System", 22 × 22 | 78 | `retailers` (badmintonbay ×2, Decathlon) |
| `yonex-6` | Trainers and entry frames (Nanoflare 001, Astrox 02, …) | 72 | `pattern` |

**`pattern` means** an earlier edition of Yonex's instructions, reproduced at https://www.badmintonbay.com/yonex-stringing-method.html, labels a pattern with its count. Its "Type 1: 76 holes", "Type 2: 76 holes" and "Type 3: 72 holes" match families 1, 2 and 6 word for word: main start, skips, tie-offs, cross start. The same instructions through the same holes means the same holes.

**Coverage:**
- 38 of the 53 offered Yonex rackets are mapped, and 36 of those show a count (68%). The kill criterion's "fewer than half" was not met.
- **Not mapped (15), because their code is not on the sheet:**
  - Astrox 88S Pro (2nd Gen), Astrox 99 Pro (3rd Gen) — the 2025 frame is `3AX99-P`, launched after the sheet.
  - Astrox 99 Tour / Game / Play — the sheet's `AX99-*` codes are the 2021 line, and these rows do not say which generation they are.
  - Astrox 100VA ZZ / Tour / Game, Nanoflare X5 / X7, Astrox Lite 43i, Voltric Lite 35i, ArcSaber 71 Light, Astrox Attack 9, Nanoflare Speed 7.
- **Judgement calls:**
  - `Astrox 88D Pro` (no generation in its name) is read as the 3rd-gen frame Yonex sells now, `3AX88D-P`.
  - `ArcSaber 2 Clear` is read as `ARC2C`.

**The sheet disproves sibling inference.** The Nanoflare 800 Play is in family 2 (76) while the 800 Pro, Tour and Game are in family 5 (78). A retailer lists the 800 Play at 76 independently.

## Phase 2 result (2026-10-20)

**Victor publishes no stringing sheet.** No Victor document mapping models to patterns or counts was found. The Victor Europe stringing PDF now redirects to a 404. What Victor does publish is a per-model mark on its product pages:

- The image `tech-tech_mark_81.webp` reads **"SEVEN SIX 76"** (viewed 2026-10-20).
- It always sits beside the caption "The single-pass grommet hole construction…".
- That is the maker stating 76 for that model, so its source is `maker`.

| Pattern | Rackets | Holes | How we know |
|---|---|---|---|
| `victor-seven-six-76` | 23 frames, each with its own ca.victorsport.com page carrying the mark. Every page was fetched and its title checked against the catalog row on 2026-10-20. | 76 | `maker` |
| `victor-76-retailers` | Thruster Ryuga II Pro (its own page shows no mark) | 76 | `retailers` (badminton-shop.com, badmintonalley) |

**Coverage:** 24 of 39 offered Victor rackets.

**Rules applied:**
- **A page without the mark proves nothing.** Colourway pages of one frame disagree on showing it (the 90F M page has it, the 90F J page does not).
- **A frame's own page or nothing.** It is never inferred from a sibling or a special edition.

**Left blank (15):**
- **Marked only on a special edition:** Thruster Ryuga Metallic (CPS capsule), DriveX 12 (ZSW collab).
- **Identity uncertain:** Thruster F Enhanced HS (the marked page is titled only "THRUSTER F HS").
- **A sibling is marked, this frame's page is silent:** Thruster F C Ultra CX.
- **One retailer only:** Auraspeed Fantome, Auraspeed 90K II, Auraspeed 99, DriveX 10 Metallic.
- **Nothing found:** Thruster F Claw, Jetspeed S 011, Brave Sword 1500, Brave Sword 12, HyperNano X 800, Thruster K 100K, Thruster K 6.

Every source found says 76 for Victor; none disagreed. The stringer counting one frame of each would fill most of the blanks. Phase 3's bench entry is the place for that.

## Phase 3 result (2026-10-20)

Grant's two calls, 2026-10-20: the entry point is a **"String holes" card on the bench's Set-up screen** (renamed "Strings, stock, prices & holes" the same day so the card can be found), not the racket page; and a count is **per club**.

**What it does:**
- **What can be counted:** any offered racket with no sourced count. That is 90 today: every Li-Ning, plus the Yonex and Victor blanks. Search, pick, type the number, Save.
- **What members see:** the number shows on that racket's page, in the same "String holes" cell, to that club's members only.
- **Range:** the route refuses a count outside 60–100.
- **No second opinions:** a racket the maker or a pattern sheet already answers for is refused with `already_known` (409). If a counted racket later gains a sourced count, the stored count gives way on read.

| Piece | File |
|---|---|
| Storage: a `kind: 'holeCount'` row in `clubSettings`, id `holes:<catalogId>` (prefixed outside BPM); validate, read, set, clear | `lib/holeCounts.ts` |
| `GET` (any member: the racket page) / `PUT` / `DELETE` (admin) | `app/api/stringing/holes/route.ts` |
| Bench card | `components/admin/CommandCenter/HoleCountsCard.tsx`, on `StringingPage`'s Set-up screen |
| Racket page: asks only when no source answers | `components/stats/useClubHoleCount.ts`, `specCells(row, clubHoles)` |
| Tests | `__tests__/group-hole-counts.test.ts` (two clubs, auth, validation), `__tests__/components/HoleCountsCard.test.tsx` |

**Why per club, in `clubSettings`:**
- One club's admin can never change what another club's members read. The multi-group rule is that a GROUP-scoped write is stamped and read by group.
- The account is at Cosmos's container cap, so a new kind goes into an existing container.
- A count is a physical fact, so a second club counting the same frame repeats work. That is the price of not letting one club write for all.

**Only an admin enters a count.** The Set-up screen is admin-only. A stringer who is not an admin sees only their assigned jobs (`docs/roles.md`), and nothing here changes that.

## Phases

1. **Yonex from the official sheet.** Map each offered Yonex row to a model code on the sheet, then the code's pattern family to its count (Type 1/2 → 76, Nanoflare 800 Pro → 78, trainers → 72), stored as `pattern`. Rows with no code on the sheet stay blank. This is about 54 rows, and the only phase with an official source.
2. **Victor where the maker page names the tech.** Done: "SEVEN SIX 76" on Victor's own page → 76, stored as `maker` (see Phase 2 result). Everything else stays blank.
3. **Li-Ning and the rest: counted at the bench.** Done: a "String holes" card on the bench's Set-up screen, per club (see Phase 3 result). A stringer counting a frame once is a better source than any web page, and it is the only route Li-Ning has.

## Decisions

- **Provenance on every value, beat a bare number:** the research's 1-in-6 conflict rate makes a bare number indistinguishable from a wrong one.
- **Hide `retailer` values rather than show them with a caveat:** the frame page's standing rule is "a fact the app does not actually hold is not shown".
- **The count lives on the pattern family, not the row (Phase 1).**
  - The proposal had three per-row fields.
  - The sheet groups models, so per-row counts would let two rows Yonex says are strung identically disagree.
  - It also means one stringer count fills a whole family.
- **A single retailer's count is not stored at all, rather than stored and hidden.** Nothing would read it, and a hidden wrong value is still a wrong value waiting for a renderer.
- **`retailers` (two or more independent retailers agree) replaces `maker` for now.** No maker states a count as a spec.
  - `maker` can be added the day one does.
  - The test checks for at least two distinct hostnames.
- **A pattern is not derived from string counts.** Yonex's "22 × 21" is 76 holes, not 86, because outer strings share holes. So families 3 and 4 stay blank until a source states a count or the stringer counts one frame.

