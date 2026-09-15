# Gear register — components/stats

Moved out of the root `CLAUDE.md` so it loads only when working in this
directory.

## Gear register (v2, 2026-08-20)

`GearRegister` is the whole register, gated on `NEXT_PUBLIC_FLAG_VALUE_HUB_SLICE`.
It composes four surfaces — the pick rail, "Your equipment", string tension, and
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
    suggest, flipping to a YOU OWN THIS badge the instant the member already
    owns it (the redesign's headline bug fix: the old surface could
    recommend back gear the member already had). `GearPickSheet` is the
    detail behind ONE rail card and ONE action (Add to my equipment); it never
    browses the catalog. Reasons render plain-language first (the engine's
    own headline reason) and the catalog spec line second — the spec line is
    a display line here, never a "why this" reason (see `lib/pickReasons.ts`).
  - **`GearSheet`** is "choose your own" — the full catalog for a category,
    search-first, one tap commits and the sheet STAYS OPEN. Closing on success
    was right while owned rows were hidden (nothing was left to look at); now
    the tapped row becomes a checked, tinted, inert owned row, and dismissing
    rendered that state for one frame to nobody. The confirmation IS the row.
    `GearPickSheet` follows the same rule — a successful add flips its action
    to the YOU OWN THIS badge in place. Both rely on `useGear` being the single
    owner: the write updates the shared doc, so ownership re-renders with no
    refetch and neither sheet holds gear state. It opens on an **All** brand tab,
    not on the first brand: defaulting to a brand hid 46 of the 71 rackets
    behind tabs nobody suspected, and reached us as "the racket database isn't
    showing some rackets". Search runs through **`lib/gearSearch.ts`** (pure,
    unit-tested), which is token-based and order-independent, with a typo pass
    that only fires when the strict pass found nothing — a member typed
    "helbatec" for Halbertec and got an empty list indistinguishable from an
    absent row. Digits never get typo tolerance: one edit turns 5000 into 9000
    and N65 into N68. It opens at the app's one sheet cap (`--sheet-max-h`, 88dvh —
    `dvh` because `vh` ignores collapsible mobile chrome and clips the sheet;
    it had its own 92dvh until every sheet was made one size, 2026-09-14).
    **It BROWSES and nothing else** (gear-sheet redesign, 2026-08-27):
    - **Brand is a GROUP HEADING with a count** (`YONEX · 21`), not the first
      line of every row — it printed five times running under a filter chip
      already naming that brand. The reason it used to ride on each row still
      holds and is still satisfied: a query searches all brands at once, and a
      cross-brand result set still groups, so brand stays legible exactly
      where it matters. Do not put it back on the row.
    - **Owned rows stay IN PLACE**, checked, captioned ("Yours · using
      today" / "· strung at 24 lb"), and NOT tappable. They used to be deleted
      from the catalog and re-rendered in an "Already in your kit" section
      pinned above it — which is bag MANAGEMENT sitting on top of the list you
      opened in order to ADD something. `duplicate_racket` stays off the happy
      path because the row is inert, not because it is hidden.
    - **Rows are edge-to-edge divided rows** (`.sheet-list` / `.sheet-row` in
      `globals.css`), not bordered cards with gaps. 38 catalog rows as glass
      cards fit five on screen; divided they fit eight with the next group
      already in view. Same material as `ProfileTab`'s account list.
    - **Search leads, and its placeholder carries the catalog count**
      (`searchCountRacket` / `searchCountString`) — which is what let the
      instruction line above it go, and is per-category: the string sheet used
      to say "Search rackets".
    - **No tension field.** It was parented to nothing, duplicated the "Set
      tension" control one row above it, and could only describe a string the
      member did not yet own. It moved to `YourKitCard` with the rows.
  - Both sheets take the register's single `UseGear`, so adding from either
    one updates every other surface (including the other sheet, which reads
    ownership off the same object) with no reload. **`BagList` belongs to
    `YourKitCard` only** — neither sheet imports it any more. `GearPickSheet`
    is behind exactly one card and one action, so ownership there is a single
    `StatusBadge` ("You own this"); `GearSheet` marks owned rows in place. A
    LIST of owned items, with controls, is the kit's own job.
- **`YourKitCard`** — one row per equipment category ("Your equipment"), showing
  what the member owns and opening `GearSheet` to change it. Unpickable
  categories (no catalog rows) render as a plain, non-interactive row rather
  than a button that does nothing. **It is also the bag's MANAGE surface**
  (2026-08-27): `BagList` plus the string-tension field live here, below the
  category rows, because that is where the kit is. They were inside
  `GearSheet`; moving them is what let the picker become a pure browse list.
  The tension field sits ABOVE `BagList` — the flow is type a number then tap
  the row it belongs to, and `BagList`'s control is disabled until the field
  holds something usable. Activate/remove/set-tension results are RENDERED
  (one `ErrorState` slot); calling them as `{ void activate(id) }` is what
  once made a refused operation indistinguishable from a dead button.
- **`BagList` always renders every owned item, active one included.** It used
  to hide below two items ("a bag of one is chrome") — wrong once ownership
  needed to be manageable from more than one place, because it left a
  one-item player unable to remove or replace what they owned. The active
  row shows a badge instead of "Use this one" but keeps its remove button.
  Don't reintroduce the guard. It now mounts in `YourKitCard` over ALL
  categories at once (it already gates activate on `racket` and tension on
  `string` per row), rather than per-category inside `GearSheet`. **It is the
  only surface anywhere that can remove or re-activate an item — deleting it
  strands three functions.**
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

### Set-up register (`NEXT_PUBLIC_FLAG_GEAR_SETUP`, 2026-09-14)

The Equipment redesign — `docs/plans/equipment-setup-card.md`. Flag on,
`GearRegister` renders `SetupRegister` instead of the rail + kit arrangement
above; flag off, nothing changes. Two components rather than branches, because
each owns different hooks and a hook cannot be conditional.

- **Every reader still has ONE instance, owned by the register**: `useGear`, the
  recommend picks (`useGearPicks` — the rail's state machine extracted verbatim;
  the rail owns it on the flag-off branch) and the club tally (`useClubGear`,
  handed to `ClubGearCard` so the card's "N others play it" and the tally cannot
  disagree). `useCatalog` is a module-cached catalog read shared by the card and
  sheets.
- **`lib/gearSetup.ts` owns the rules**, pure and tested: which item fills each
  line (`setupLines` — active racket, newest live string, other rackets are
  spares), the spec lines, `clubOthers` (reads ONLY `tallyClubGear`'s
  cohort-cut entries; the member is counted, so the fact is `count - 1`; keyed
  exactly as the tally keys), `blankStringPairing` (a pairing is quoted only
  when the server paired against the racket on the line) and `tensionOnScreen`
  (the ONE rule both the card and `StringTensionCard`'s stand-down read).
- **`GearSetupCard`**: three non-ready states draw no lines — an unread card
  must not read as an empty one. The "Your fit" link sits outside the error fork
  (the always-there door rule above).
- **`SetupAddSheet`**: a tap saves; the row expands in place with the one
  follow-up (in play / strung at). The tension is local until Done (bag limiter).
  The suggestion confirms before saving and is offered only on a blank line.
  Mounted with a fresh `key` per opening — its state is one visit. **Search
  leads, chips narrow** (Turn 3): `lib/catalogFilters.ts` is the pure rule —
  one value per facet, a dual weight class counts as both — and the result
  line, group headers ("Yonex · 4 match") and rows all read the same filtered
  list. The suggestion is never filtered.
- **A hybrid's crosses string is NESTED on the mains string item**
  (`GearItem.crosses`, `lib/stringCrosses.ts`, 2026-09-15), written only by
  PATCH `itemCrosses` and carried through PUT like `feel`/`look`. Not a second
  string item, on purpose: seven readers take "the member's string" as the LAST
  string in the bag (`clubTension`, `fitVerdict`, `frameDetail`, `shareCard`,
  `setupLines`, the fit-verdict and share-card routes), and a crosses item
  would silently become it — the club band, the verdict and the share card
  would all read a figure conventionally 2 lb high. Nested, they all keep
  meaning the mains. The card stacks mains over crosses inside the one Strings
  line (`filled` still counts two lines), the line sheet sets each tension, and
  `SetupAddSheet` in crosses mode (`crossesForId`) picks the crosses string;
  "Change the string" carries the crosses onto the new mains. Crosses are not
  in the club tally or the restring log.
- **`TensionField`** is tension as a field: a numeric input with steppers
  bounded by the frame's rated range (`ratedRange` in `lib/tension.ts`, a
  missing bound is the app scale's own), a warning that still saves, and the club hint from
  `useClubTension`. **Pass `clubStatus` only when there is a frame to ask about**:
  then it draws the live ruler (`rulerScale` + `scalePosition`: the frame page's
  20–30 lb scale, widened to hold a figure past either end — members string past 30) and its club line distinguishes loading, a failed
  read and "not enough of the club yet" — passing `.band` alone made all three
  the same silence. Its classes are `tension-field-*` — `.setup-tension` is the
  CARD's figure, and reusing that name restyled it.
- **`SetupLineSheet`**: one filled line's management. Remove asks once. No Retire.
- **`NextRacketCard`** renders only once a racket is in play; its tap carries the
  `rec_card_tap` beacon the rail card carries on the other branch.
- **`SetupShareSheet`** answers "what are you playing?": preview is the exported
  PNG (`lib/setupShareCanvas.ts`, callback-ref draw, dark `--bpm-night`). Its
  facts come from `GET /api/equipment/share-card`, built by `lib/shareCard.ts`
  — every club-relative number is server-side, and a fact that cannot honestly
  be stated is null so its line drops. `ShareCard` has no field for level,
  results, kudos or arm history. A failed read falls back to the local gear
  lines only.
- **The restring log is `lib/stringLog.ts`** (`PlayerGear.stringLog`): written by
  the gear route when a string goes in (POST) or its tension changes (PUT; the
  same value again is not an event). Nothing kept this history before
  2026-09-14, so every restring count starts there.
- **The club tension band is `lib/clubTension.ts`** (`GET /api/stats/club/tension`):
  `{ sampleSize, low, high, mean }` per frame, null below
  `CLUB_GEAR_MIN_COHORT`. Club readers go through `lib/clubGearDocs.ts`, whose
  projection never selects the fit answers.
- **A catalog row can be withdrawn without deleting it**: `attributes.unlisted` (a reason string) makes `isOffered()` (`lib/catalogOffer.ts`) false, and both recommenders plus both add sheets skip it, while a bag pointing at it still resolves. Deleting a row from the seed JSON would not remove it from Cosmos, since seeding never deletes. See `docs/catalog-check-2026-09-14.md`.
- **A racket the catalog lacks can be logged by name** (Grant, 2026-09-14): the racket add sheet offers "Add “…”" for any typed name that is not already in the bag or an exact catalog model, via `useGear.addCustom`. Its saved panel asks "How does it feel?" (balance, shaft, weight, each with "Don't know"), written once on Done through PATCH `itemFeel` into `GearItem.feel`; `SetupLineSheet` edits it later. `lib/racketFeel.ts` turns an in-play typed racket with balance AND shaft answered into the fit engine's anchor (tier from the member's level), and `useGearPicks` keys a refetch on those answers. PUT carries `feel` over from the matched item, because it rebuilds items from the wire.
- **The racket is Grant's 3D model** (design project "Racket 3D", 2026-09-14):
  `lib/racketModel.ts` is the design's racket builder ported with its geometry untouched —
  do not "improve" a number; the handoff README says which values read as an
  egg, a teardrop or a flat top. `lib/racketStage.ts` is the studio the
  materials were balanced against (ACES 1.15, the PMREM gradient, key and fill);
  without it the model looks like plastic. **three.js is only ever reached by a
  dynamic `import()`** — `__tests__/racket-custom.test.ts` fails the build on a
  static import.
  - **Lists and cards use images pre-rendered from that model**
    (`public/rackets/<catalogId>.webp`, `racketSrc`), written by
    `scripts/render-racket-images.mjs` against the dev-only
    `/design/racket-render` page. Re-run it when a look changes: the coverage
    test fails on a look with no image or an image with no look.
  - **Live 3D only on big views**: `Racket3D` (falls back to the image without
    WebGL; no autorotate under reduced motion) inside `RacketLookSheet`
    ("See it in 3D" on the racket's line sheet). The share card draws a still
    of the model in the member's colours (`lib/racketSnapshot.ts`).
  - **Paint comes from the catalog; a member dresses it** (`lib/racketCustom.ts`,
    `GearItem.look`, PATCH `itemLook`): string and wrap colour on any racket,
    frame colour, paint pattern and head shape only on a typed-in racket — a
    recoloured Astrox 88D is not an Astrox 88D. Closed palettes, validated
    server-side; PUT carries `look` over; picking a typed racket's catalog row
    keeps string and wrap and drops the paint.
  - `RACKET_LOOKS` in `lib/racketLook.ts` stays the one paint table (frame,
    accent, grip, optional `pattern` / `shape`). It is presentation, so it stays
    off `CatalogItem`; an unknown id uses `DEFAULT_LOOK`.

- **Your fit is a PAGE** (`NEXT_PUBLIC_FLAG_GEAR_PAGES`, Turn 3 `3a`): `FitProfilePage`,
  rendered IN PLACE by `SetupRegister` (it owns the data), with the shell's
  chrome hidden through `components/stats/statsTakeover.ts` — hidden, not unmounted, or the
  register holding the page's state would go with it. Flag off, the same doors
  open `GearFitSheet`. Answers autosave through `gear.setPrefs`, QUEUED one
  after another (the PATCH is read-modify-write, so racing taps would each keep
  only their own field), shown optimistically and reverted with a retry on a
  refusal. New answers on `PlayerGear`: `fitLevelOverride`, `fitPlayStyle`
  (doubles/singles also write `playFormat`), `fitSoreness` (stripped for
  non-owners like `fitArmComfort`; `effectiveArmComfort` in `lib/fitProfile.ts`
  is how the engines read it), `fitOvergrips`, and `G3`.
  - **The verdict's judgement is `lib/fitVerdict.ts`, and only there**: state,
    reasons, range, all deterministic. It borrows the engines' opinions rather
    than holding its own — `GOAL_DELTA`'s balance axis, `pairTension` when frame,
    string and check-in are known (else `recommendTension`), one `ratedRange`.
  - **`GET /api/equipment/fit-verdict` is OWNER ONLY** — no admin-on-behalf,
    because the facts carry soreness; an admin cookie counts only as that admin.
    With `NEXT_PUBLIC_FLAG_FIT_VERDICT` on, Claude words the decided facts
    (`lib/fitVerdictCopy.ts`): strict JSON, length caps, and NO DIGITS except
    inside the racket's own name. Off-contract means `copy: null` and the page's
    own strings, never a repair. Cached per member per frame in `insights`,
    keyed on facts + locale + `FIT_COPY_VERSION` (bump it when the prompt
    changes). `insufficient` never calls the model.
  - The page keeps the previous verdict while re-asking (`useFitVerdict`), and
    re-asks the racket pick once answers have been still for 2.5 s — the
    register holds fit refetches while the page is open.
- **A racket's page is `FrameDetailPage`** (same flag, Turn 3 `3d`). The
  register keeps a PAGE STACK (`GearPage[]`): a frame opens another frame, back
  pops, and opening Your fit returns to one already underneath rather than
  stacking a second. Its rules are `lib/frameDetail.ts`, pure: `specCells`
  (a cell the row cannot fill is absent; `rated` carries only the bounds the
  maker printed — never `ratedRange`'s scale fill), `cadRange` (now in `lib/catalogPrice.ts`, the one price source: USD × 1.38,
  captioned as typical, never live; `priceCadPoint` is the single figure lists
  show, and every row's `msrp` is held to it by `__tests__/catalog-price.test.ts`), `closeToFrame` (the fit engine's own
  distance to this frame's axes, so "close" means what the pick means) and
  `frameHistory` (restrings keyed by model, last four tensions). Rows expand
  one at a time through CSS grid rows (reduced-motion covered), closed rows
  `inert`. The Strings row is not drawn for a racket you don't own; the club
  band draws only from `useClubTension`'s cohort. The tension chart is on a
  FIXED 20–30 lb scale so every band is measured on the same ruler.

### Racket FIT engine (`NEXT_PUBLIC_FLAG_RACKET_FIT`, Phase 2, 2026-09-09)

`lib/racketFit.ts` replaces the seven scorers below on the racket branch of
`GET /api/recommend` when the flag is on; off, that branch is unchanged. Spec:
`docs/superpowers/specs/2026-09-07-racket-fit-design.md`. Pure, no I/O.

- **A distance model against a TARGET SPEC**, not rule scorers. Target =
  the member's ACTIVE racket's axes (balance 1–3, flex 1–5, weight midpoint,
  tier 1–3) plus the goal delta (`GOAL_DELTA` — the one table of badminton
  judgment in the file; tune it there and let the golden set say whether it
  was right), then swing sets the flex CEILING (the ONLY input that speaks to
  flex since `fit-2`, 2026-09-10 — an unanswered swing caps nothing, widens
  the tolerance and asks) and comfort sets weight/balance ceilings and hands
  the string engine a 1–2 lb tension reduction, never a flex cap. Ceilings
  penalise and WARN; nothing is hidden. Unanchored members get a level-based
  target with a wider tolerance and a lead reason that says so. A Beginner
  reaching up past the target's tier pays double — reordered, never excluded.
  The sources are in the file header and spec D3/D4/D12/D13.
- **Honest states** (`resolveFitState`): a pick needs a catalog racket in the
  bag, OR a check-in, OR goal + swing — goal alone is not enough, swing is the
  injury axis. Otherwise `needsFit`, which the route returns as
  `{ needsFit: true }`; the rail parks on it with a `parkReason`, and
  `GearPickCard` renders a racket parked on `needsFit` as a tappable DOOR to
  the questionnaire (`railRacketFit` + `railTapToFit`), one parked on an empty
  catalog as `railNoCatalog` — never "do a check-in" for either.
- **Level from RATED skills only** (`fitLevel`, null below three) — the
  string engine keeps `overall()`'s fill-with-3 for its reference constants;
  the two are different on purpose. `buildProfile` records `ratedKeys`.
- **Exclusion by id OR normalised label** (D5), so a free-text bag row is
  excluded too — the rail recommended Lin her own typed racket on 2026-09-07.
- **Reasons are KEYS** (`stats.gear.reason.*`, `warn.*`, `diff.*`) with
  params; `FIT_REASON_KEYS` is exported and `__tests__/racket-fit.test.ts`
  asserts every key exists in both locales, because `check-i18n-keys.mjs`
  cannot see a dynamic `t(reason.key)`. `lib/fitReasonText.ts` renders them
  to English on the server for the client that still reads `reasons:
  string[]` — TRANSITIONAL, deleted in Phase 4 once the rail translates keys.
- **Top pick + two alternatives**, diversity-selected on the (balance, flex,
  tier) triple with a rank-order fallback, each with a `differsBy` of at most
  two fragments. Order is score → distance → price → id: deterministic, never
  catalog order.
- **Phase 3 (2026-09-09) — the sheet and the loop.** `GearPickRail` stores
  what the server sent (keys AND the legacy English strings) and TRANSLATES
  `reasonKeys` / `warningKeys` / `differsBy` at RENDER (a `useMemo` view over
  state), so a language toggle re-renders the reasons in place with no
  refetch and the fetch effect does not depend on `t`. The club-tally line
  keeps its reserved last slot on the engine path as a KEY
  (`buildPickReasonKeys`, `reason.clubPlays`). Per-pick sheet state (a rating,
  a "tried", a chosen alternative) resets when the PICK's identity changes,
  not only on close — the pick is live under an open sheet.
  `GearPickSheet` shows the top pick and an "Or consider" list of the other
  candidates with their "differs by" line; tapping one SWAPS the sheet's
  subject (name, price, reasons, the Add action all follow; warnings and the
  tension figure are the top pick's and clear on a swap) — never a second
  sheet over this one. Three beacons, all fire-and-forget through
  `recordEngagement(kind, meta)`: `pick_added` after a successful add,
  `pick_rated` (a yes/no under the headline, engine picks only, once per
  open), `pick_tried` (a ghost button in the footer, only for a row the member
  owns). **`pick_served` is written SERVER-SIDE** by `/api/recommend` when a
  fit pick is returned to the member it is about — never on admin view, and
  `POST /api/events` refuses it from a client — so the feedback read has an
  honest denominator. **`lib/events.ts` is the ONE writer** for the `events`
  container and the one home of the kind lists (`CLIENT_KINDS`,
  `SERVER_KINDS`, `PICK_KINDS`) and the per-kind payload schema; the beacon
  route, the client type and the Slice-0 reader all derive from it, and the
  recommend route's `pick_served` runs alongside the club read, never on the
  response's critical path. `lib/racketFitInput.ts` is the ONE builder of the
  engine's input, shared by `/api/recommend` and `/api/admin/fit-preview`, so
  the golden set is rated against exactly what members are served. `served`
  is one row per REQUEST (a format tap re-serves); the plan's gate reads
  `picks.engagedMembers` — added, tried or rated — never served. `GET /api/admin/slice0` reports `picks` split by
  `engineVersion`; `GET /api/admin/fit-preview` answers one member's top three
  (`?memberId=`) or prints anonymised golden-set skeletons, which
  `scripts/dump-fit-cases.mjs` fetches for the owner and the stringer to rate.
- **The golden set** (`__tests__/fixtures/fit-golden.json`, run by
  `__tests__/fit-golden.test.ts`) is the expert ground truth: raw ratings +
  a gear shape per case, an ACCEPTABLE set, never a derived level. Empty
  today and skipping loudly; Phase 4 raises the guard to five cases.
- `canon`, `isScorable`, `overall`, `skillLevel` and the derived-profile
  helpers MOVED here; `lib/racketRecommend.ts` re-exports them until it
  retires. `maxFlexDemand` is still exported for that legacy path only — the
  fit engine no longer reads it.

### Racket recommender (`NEXT_PUBLIC_FLAG_GEAR_RECOMMENDER`) — the OFF branch of the flag above

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
  factual and numeric throughout, rendered inline and never collapsed.
  **`provenance` is a SEPARATE field from `warnings`** (2026-08-27). The
  "Performance ratings are community consensus" sentence used to be pushed
  into `warnings`, which stopped working once `GearPickSheet` began rendering
  the two differently: warnings stay inline, provenance joins the muted caveat
  paragraph under the action. It is also CONDITIONAL — only the 13 of 46 rows
  whose `ratingSource` is a consensus estimate carry it — so it must never be
  baked into the static footnote copy: the other 33 ARE
  manufacturer-published, and saying otherwise about them is a false claim,
  not a cautious one.
- **The flag-on route requires auth; flag-off stays public.** `GET
  /api/recommend` was unauthenticated because it returned only a coarse
  stage-derived pick. Engine reasons quote individual ratings ("smash 4/5"),
  and member names are enumerable via `GET /api/members`, so the flag-on branch
  gates on a `member_session` cookie for that name or admin (same gate as
  `/api/stats/level`). Rate limiting stays first (security rule 4).
- **The fit questionnaire is its own sheet — `GearFitSheet`** (racket-fit
  Phase 1, 2026-09-08; spec `docs/superpowers/specs/2026-09-07-racket-fit-design.md`).
  Five optional answers on `PlayerGear` — `fitGoal`, `fitSwing`,
  `fitArmComfort`, `fitGrip`, `stringBudgetMaxCad` — plus `fitUpdatedAt`,
  stamped by the route. Every tap is ONE `gear.setPrefs()` write (no Save
  button: a half-answered questionnaire is a valid state) and every refusal is
  rendered; every stored answer has a Clear (the privacy policy promises it),
  and tapping the selected goal row is its own undo. **`GearRegister` owns the
  sheet, and it has TWO doors**: a "Your fit" row on the kit card (always
  there) and the pick sheet's Fit link (only on a READY racket card — a member
  whose card is parked or errored would otherwise have no way to clear a
  stored comfort answer on exactly the days the rail is broken). The Fit link
  goes through the pick sheet's `close()` — it is an exit route like any
  other — and the two sheets swap, never stack. **That swap overlaps two body
  scroll locks for ~220 ms** (the closing sheet still holds its lock), which is
  why `useBodyScrollLock` is reference-counted and `useFocusTrap` is
  top-of-stack-only: per-instance cleanups restored the page to scrollable
  beneath the open sheet, then pinned it fixed with nothing on screen, and
  handed keyboard focus to the rail card BEHIND the open sheet. Format and budget stay in `GearPickSheet`; the fit sheet
  shows them read-only. A `null` option ("Not sure", "No limit") is a CLEAR and
  never lights — the doc cannot tell "answered: not sure" from "never asked".
  Five rules that are easy to break:
  - **`fitArmComfort` is health-adjacent.** The gear GET is owner-or-admin
    (since 2026-09-14 — it was public by name, so a device that merely
    remembered a name showed that person's bag; a refused read renders
    `YourKitCard`'s locked state via `useGear().forbidden`), and the route
    still strips this field (and `fitSoreness`) for anyone but the OWNER —
    admins included, since 2026-09-14: the policy says only the member sees
    it. An admin cookie counts as the owner only when it re-checks FRESH as
    that same member (same shape as the pinHash strip-canary, tested by
    VALUE not by key — the mock keeps an explicit `undefined`, production JSON
    drops it); it is disclosed in
    `legal.privacy` in both locales (pinned by the `'arm or shoulder'` needle
    in `__tests__/legal-pages.test.ts`) and purged with the doc. **A strip
    sets `fitArmComfortRedacted: true`** (response-only, never stored). It was
    written for the OWNER on a lapsed 30-day `member_session`, who used to read
    by name like anyone else; that reader is now refused outright, so the
    marker is reached only by a lapsed owner who also holds a sync-valid admin
    cookie. Without the marker the sheet would show "not answered" for a value
    Cosmos still holds — the lying-empty-state rule, produced by the strip
    itself. What leaks is that SOME answer exists, never which. A `Clear`
    link renders only while an answer is stored — a Clear that clears nothing
    is a button that lies.
  - **`writeGearDoc` rebuilds the doc from an explicit field list.** A field
    left off it survives the PATCH that wrote it and is dropped by the next
    POST or DELETE. Pinned by "fit answers survive a bag write".
  - **`/api/recommend` is 30/min per IP since 2026-09-15** (the notes below
    were written at 10). Swapping a racket in re-asks both picks, and five
    swaps inside a minute rendered "Couldn't load this pick"; `GearRegister`
    also collapses a burst of swaps into one re-ask (`REC_REFETCH_DEBOUNCE_MS`).
  - **The rail's refetch has THREE keys, two of them GATED, and is never
    keyed on the bag.** Format/budget reach both engines and always re-ask at
    once. The fit answers and the string budget are in the key only while
    `PROFILE_READS_FIT` (`lib/racketProfile.ts`) is true — it is false until
    the Phase 2 engine reads them, because re-asking on a field no engine
    reads burnt the 10/min/IP limiter on identical answers (three reviewers,
    one throttle-math). Flip it THERE, next to `buildProfile`, so the rail
    cannot drift from the server. With the gate open: a change that leaves
    format/budget alone is debounced (`REC_REFETCH_DEBOUNCE_MS`, 500 ms); a
    string-budget change re-asks the string only; a fit change skips the
    string only when the SERVER said it is paired with the member's own frame
    (`pairedWith.source === 'owned'`) — never a client mirror of that rule,
    which drifted twice (a free-text racket, an unresolvable catalogId); a
    category whose in-flight fetch the effect's cleanup discarded is never
    skipped, whatever its status (`cancelledRef`), or the answer from before
    the change stays on screen; and a PARKED category is skipped only when it
    parked on `no_engine` — `needsFit`, `needsCheckIn` and a string with no
    frame are THIS member's state and un-park when their answers change.
    **A fit-driven refetch is HELD while the fit sheet is open**
    (`holdFitRefetch`, from `GearRegister`'s `openFit`): answered at a human
    pace, five controls were eleven calls inside a minute against the 10/min
    limit, and the card is under the sheet anyway. Nothing about the bag is an
    effect dependency: keyed on it, adding the recommended racket re-scored
    with it excluded and swapped the pick out from under the YOU OWN THIS flip.
    The string budget is NOT a key: no engine reads it yet.
  - **The kit card's "Your fit" row lives OUTSIDE the error fork and is never
    disabled.** Opening a sheet is not a mutation, and on the day the gear
    read fails it is the only door. `fitUpdatedAt` moves only when an ANSWER
    changes against the stored doc — a re-tap of the lit tab sends no PATCH
    at all, and the string budget is a pairing preference, not an answer.
  - **Preference PATCHes have their own limiter bucket** (`gear-prefs`, 60/h)
    separate from the bag's (`gear-bag`, 20/h). A first-pass questionnaire is
    five to eight writes; sharing the bucket let it lock "Add to my
    equipment" with nothing saying why.
  - **Unknown answers light nothing.** A failed gear read still renders every
    control (they are the only way to clear a stored answer) with no option
    selected — the same unknown-≠-known-false rule as the pick sheet's
    preference block.
  Read by the fit engine (below) since Phase 2.
- **Format and budget are asked, not inferred** — the engine's author flagged
  both as not derivable from skill scores. Stored as optional
  `playFormat`/`budgetMaxCad` on `PlayerGear`, edited from inside
  `GearPickSheet`'s controls; the refetch-on-change lives in
  `GearPickRail`'s `recKey` effect, not the sheet itself — see its own
  comments for why. Budget bands are CAD and every band sets an UPPER bound.
  The controls sit **above** the recommendation now, folded behind a one-line
  summary with a Change link ("For doubles · no budget limit") — they are set
  once or twice a year, and two labelled segment controls standing open
  competed with the answer. **Exception: when the gear read fails the
  preferences are UNKNOWN, so there is no honest summary sentence to write and
  the controls render already-expanded.** They must stay reachable exactly
  then — they are what writes the doc, so they are what can leave a member
  with a budget they cannot change back, and the rail card behind the sheet is
  a non-interactive div in its error state.
