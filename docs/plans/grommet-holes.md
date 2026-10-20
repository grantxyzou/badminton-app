# Grommet hole counts on the racket catalog

**Track:** ROADMAP North Star — Value-Hub Track 2 (Equipment: the frame page is "a reference you can check courtside") and the stringing service (`admin.stringing`: the stringer is the person who needs the number).
**Status:** intent
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

## Shape (proposed)

Three additive, optional `attributes` on a racket row, which is schema-safe under the rollback rule:

| Field | Type | Meaning |
|---|---|---|
| `grommetHoles` | number | e.g. 76 |
| `grommetSource` | `'maker' \| 'pattern' \| 'counted' \| 'retailer'` | `maker` = the maker states the number; `pattern` = derived from the maker's official stringing pattern; `counted` = the club's stringer counted a frame; `retailer` = one retailer's table |
| `grommetUrl` | string | Where it was read; absent for `counted` |

Plus `stringPatternFamily` (string, Yonex only), the sheet's family label. That is what the stringer uses at the machine, and it is official where the count is not.

| Piece | File |
|---|---|
| Data | `scripts/data/equipment-catalog.json` and `racket-database-v2.json` (both, so a re-import cannot revert it) |
| Importer passes the fields through | `scripts/import-racket-db-v2.mjs` |
| Seed refresh | none needed: `ensureCatalogSeeded` already rewrites a seeded row whose fields changed |
| Frame page cell `holes`, shown for `maker` / `pattern` / `counted` only | `lib/frameDetail.ts` `specCells`, plus a `stats.gear` label in both locales |
| Data test: holes ∈ {68…90}, source in the union, URL present unless `counted`, no `retailer` value rendered | `__tests__/equipment-catalog-data.test.ts`, `__tests__/frame-detail.test.ts` |

## Phases

1. **Yonex from the official sheet.** Map each offered Yonex row to a model code on the sheet, then the code's pattern family to its count (Type 1/2 → 76, Nanoflare 800 Pro → 78, trainers → 72), stored as `pattern`. Rows with no code on the sheet stay blank. This is about 54 rows, and the only phase with an official source.
2. **Victor where the maker page names the tech.** "Seven-Six 76" on Victor's own page → 76, stored as `pattern`. Everything else stays blank.
3. **Li-Ning and the rest: counted at the bench.** The club strings these frames. A stringer counting a frame once is a better source than any web page, and it is the only route Li-Ning has. This needs a small admin "Holes" entry on the frame page; scope it after Phase 1 shows the cell is used.

## Decisions

- **Provenance on every value, beat a bare number:** the research's 1-in-6 conflict rate makes a bare number indistinguishable from a wrong one.
- **Hide `retailer` values rather than show them with a caveat:** the frame page's standing rule is "a fact the app does not actually hold is not shown".
