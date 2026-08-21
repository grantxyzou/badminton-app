# Gear register — components/stats

Moved out of the root `CLAUDE.md` so it loads only when working in this
directory.

## Gear register (v2, 2026-08-20)

`GearRegister` is the whole register, gated on `NEXT_PUBLIC_FLAG_VALUE_HUB_SLICE`.
It composes four surfaces — the pick rail, "Your kit", string tension, and
"What the club plays" — and is a pure composition component: it holds no
state of its own except the one thing it exists to own (below).

- **`GearRegister` calls `useGear` exactly once and passes it down. This is
  the single-owner invariant the whole redesign exists to establish**, pinned
  by `__tests__/components/GearRegister.test.tsx` (exactly one gear read per
  mount). Before it, up to four components read `GET /api/equipment/gear`
  independently and two of them wrote it, each with its own monotonic op
  counter — an out-of-order-response race that shipped here twice. **Never
  add a gear fetch outside `useGear`; every child takes the `UseGear` object
  as a prop instead.**
- **`components/stats/useGear.ts`** holds `gear/rackets/active/loaded/
  loadError/busy/online` plus `reload/add/activate/remove/setPrefs`, and ONE
  monotonic op counter shared by the read and all writes.
- **Two sheets, two jobs — "take our pick" vs. "choose your own":**
  - **`GearPickRail` + `GearPickCard` + `GearPickSheet`** are "take our
    pick" — one card per category showing what `/api/recommend` would
    suggest, flipping to an IN YOUR KIT badge the instant the member already
    owns it (the redesign's headline bug fix: the old surface could
    recommend back gear the member already had). `GearPickSheet` is the
    detail behind ONE rail card and ONE action (Add to my kit); it never
    browses the catalog. Reasons render plain-language first (the engine's
    own headline reason) and the catalog spec line second — the spec line is
    a display line here, never a "why this" reason (see `lib/pickReasons.ts`).
  - **`GearSheet`** is "choose your own" — the full catalog for a category,
    search-first, one tap commits and closes. It opens on an **All** brand tab,
    not on the first brand: defaulting to a brand hid 46 of the 71 rackets
    behind tabs nobody suspected, and reached us as "the racket database isn't
    showing some rackets". Search runs through **`lib/gearSearch.ts`** (pure,
    unit-tested), which is token-based and order-independent, with a typo pass
    that only fires when the strict pass found nothing — a member typed
    "helbatec" for Halbertec and got an empty list indistinguishable from an
    absent row. Digits never get typo tolerance: one edit turns 5000 into 9000
    and N65 into N68. Full height (`92dvh` — `vh`
    ignores collapsible mobile chrome and clips the sheet). Rows show brand
    ABOVE model: a query searches all brands at once, and brand used to live
    only in the `aria-label`, so exactly the cross-brand results where brand
    matters rendered as bare model names. Owned items are omitted from the
    catalog list (`duplicate_racket` off the happy path) and rendered instead
    via `BagList` above it — this sheet is the one place a category's owned
    items AND its catalog both live, deliberately not split across the tab
    and a sheet any more (see the file's own docstring for why that split
    used to exist and stopped making sense). It also carries the string-
    tension capture field (only for `category === 'string'`) — an optional,
    explicitly-edited value, never a silent echo of the prefilled advice.
  - Both sheets take the register's single `UseGear`, so adding from either
    one updates every other surface (including the other sheet, which reads
    ownership off the same object) with no reload. **`BagList` belongs to
    `GearSheet` only** — `GearPickSheet` never imports it. `GearPickSheet` is
    behind exactly one card and one action, so ownership there is a single
    `StatusBadge` ("In your kit"), not a list; a list of owned items is
    `GearSheet`'s job, since browsing the whole catalog is the only place a
    member needs to see everything they already have at once.
- **`YourKitCard`** — one row per equipment category ("Your kit"), showing
  what the member owns and opening `GearSheet` to change it. Unpickable
  categories (no catalog rows) render as a plain, non-interactive row rather
  than a button that does nothing.
- **`BagList` always renders every owned item, active one included.** It used
  to hide below two items ("a bag of one is chrome") — wrong once ownership
  needed to be manageable from more than one place, because it left a
  one-item player unable to remove or replace what they owned. The active
  row shows a badge instead of "Use this one" but keeps its remove button.
  Don't reintroduce the guard.
- **`lib/activeRacket.ts`** resolves the active racket read-tolerantly: new
  docs carry `activeRacketId`, legacy docs fall back to `items[0]`. No
  migration.
- **`StringTensionCard`** and **`ClubGearCard`** round out the register:
  tension advice from level + format (never rendered without a resolved
  level — an unattributed number reads as a spec, not advice), and the
  aggregated "what the club plays" tally (`lib/clubGear.ts`, cohort-guarded
  at `CLUB_GEAR_MIN_COHORT` before any label can identify fewer than that
  many people).
- **The catalog's vocabulary is pinned by a test.** Every racket row must pass
  `isScorable` and carry `balance`/`flex`/`playStyle`/`tier` values from the
  controlled vocabulary (`__tests__/equipment-catalog-data.test.ts`). The
  failure mode is invisible — `recommendRackets` silently skips a row it cannot
  score, and a skipped row looks exactly like one that scored badly. It has cost
  this catalog twice: 50 of 71 rows in production, and 11 rows in the seed file
  itself (lowercase `"head-heavy"`, a sentence where `playStyle` takes a word)
  until they were normalized on 2026-08-21. `racketRecommend`'s comparisons are
  case-tolerant as a backstop, but the data is the fix. Tension ceilings are the
  one field deliberately left absent on those 11 frames — `scoreTension` has an
  honest branch for it, and a range invented from series convention would be a
  fabricated spec driving a real stringing decision.
- **Category scope is data-driven, not flag-driven.** Rackets and strings are
  selectable because the catalog has rows for them; shoes and shuttles are
  parked because it doesn't — not because the UI is missing. Both the rail
  and `YourKitCard`'s rows key off the same sourced-category list
  (`GearPickRail`'s `SOURCED`, `YourKitCard`'s `PICKABLE`), so un-parking a
  category is only ever a sourcing step, never a UI change.

### Racket recommender (`NEXT_PUBLIC_FLAG_GEAR_RECOMMENDER`)

Scores the **fourteen check-in skill ratings** rather than the old
`Member.stage` (optional, rarely set — so it showed nearly everyone the same
racket and never excluded what they owned).

- `lib/racketProfile.ts` — `buildProfile(ratings, gear)`. Owns the 14-key rename
  table between the app's assessment keys and the engine's field names; a wrong
  key silently defaults that skill to 3 and no type check catches it, since the
  map is keyed by `string`. Unrated skills default to 3 (partial ratings are
  normal — `validateRatings` accepts any subset). Returns **`null` when there
  are no ratings at all**, which is what drives `needsCheckIn`.
- `lib/racketRecommend.ts` — pure, no I/O or clock. Seven weighted scorers
  ported from `docs/superpowers/reference/recommend_racket.py`, which stays the
  source of truth for thresholds. Two deliberate divergences: **budget never
  hard-filters** (prices are USD-derived and go stale; a silent exclusion is
  invisible when the price is wrong), and rows missing normalized
  `balance`/`flex`/`tier` are **skipped, not scored on invented values**.
  Takes a `category` parameter (default `'racket'`) so `/api/recommend`'s
  per-category ask doesn't hardcode the one it was written for.
- **No assessment → no recommendation.** With no ratings the engine would score
  fourteen 3s and emit a confident, meaningless pick. The rail's `racket` card
  parks with "do the check-in" copy instead (`needsCheckIn`).
- **`lib/pickReasons.ts`'s `buildPickReasons`** grounds a pick's "why this"
  list in two sources, priority order: the engine's own equipment-derived
  reasons, then the club tally (`lib/clubGear.ts`, re-guarded here even though
  `tallyClubGear` already filtered — a reason is a NEW disclosure surface for
  that data). The engine leads and fills; the club line takes at most one slot,
  always the last.
- **Drills are NOT a reason source** (2026-08-21). They were, under a rule that
  capped the engine at one slot whenever a drill line existed — and since
  `GearPickSheet` renders `reasons[0]` as its headline and only
  `reasons.slice(1)` under WHY THIS, that cap made "You are working on drops —
  slow-drop target zones is in this week's focus" the *entire* visible list. A
  gear pick answers "does this suit how you play"; a drill answers "what are
  you trying to fix", and nothing computes a relationship between the two.
  Don't re-add it. The string branch of `/api/recommend` had already reached
  this conclusion independently and passed `drills: []`.
- **Reason ORDER is play-style first.** `lib/racketRecommend.ts`'s
  `REASON_PRIORITY` presents balance → style → format → flex → tier → weight →
  budget, which is deliberately NOT the order the scorers run in: execution
  order put `flex` first, making "Medium-Stiff shaft matches your technique
  level" the near-universal headline. It is a separate list rather than a
  reordering of `scorers` because `total` is a float sum and reassociating it
  can flip a tie. Scores are untouched by it.
- **String reasons speak in play, not in spec math.** `lib/stringPair.ts`'s
  reason copy branches on format and attacking intent ("Quick off the strings
  for flat doubles exchanges…") instead of reporting indices. The numbers live
  in `GearPickSheet`'s spec `<dl>`, and the system-power figure moved onto
  `StringPairing.systemPower` as DATA — it is the observable proving tension
  reaches `scoreSystemPower`, a branch that was dead until 2026-08-21. The
  tension-WINDOW line was dropped from the reason list entirely (the sheet
  prints the same range a couple of inches above it); the ceiling-unpublished
  CAVEAT stays and keeps its front slot. Warnings are safety copy — left
  factual and numeric throughout.
- **The flag-on route requires auth; flag-off stays public.** `GET
  /api/recommend` was unauthenticated because it returned only a coarse
  stage-derived pick. Engine reasons quote individual ratings ("smash 4/5"),
  and member names are enumerable via `GET /api/members`, so the flag-on branch
  gates on a `member_session` cookie for that name or admin (same gate as
  `/api/stats/level`). Rate limiting stays first (security rule 4).
- **Format and budget are asked, not inferred** — the engine's author flagged
  both as not derivable from skill scores. Stored as optional
  `playFormat`/`budgetMaxCad` on `PlayerGear`, edited from inside
  `GearPickSheet`'s controls; the refetch-on-change lives in
  `GearPickRail`'s `recKey` effect, not the sheet itself — see its own
  comments for why. Budget bands are CAD and every band sets an UPPER bound.
