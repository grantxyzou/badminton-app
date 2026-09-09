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
    and N65 into N68. Full height (`92dvh` — `vh`
    ignores collapsible mobile chrome and clips the sheet).
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

### Racket FIT engine (`NEXT_PUBLIC_FLAG_RACKET_FIT`, Phase 2, 2026-09-09)

`lib/racketFit.ts` replaces the seven scorers below on the racket branch of
`GET /api/recommend` when the flag is on; off, that branch is unchanged. Spec:
`docs/superpowers/specs/2026-09-07-racket-fit-design.md`. Pure, no I/O.

- **A distance model against a TARGET SPEC**, not rule scorers. Target =
  the member's ACTIVE racket's axes (balance 1–3, flex 1–5, weight midpoint,
  tier 1–3) plus the goal delta (`GOAL_DELTA` — the one table of badminton
  judgment in the file; tune it there and let the golden set say whether it
  was right), then swing sets the flex CEILING and comfort sets flex/weight/
  balance ceilings. Ceilings penalise and WARN; nothing is hidden. Unanchored
  members get a level-based target with a wider tolerance and a lead reason
  that says so.
- **Honest states** (`resolveFitState`): a pick needs a catalog racket in the
  bag, OR a check-in, OR goal + swing — goal alone is not enough, swing is the
  injury axis. Otherwise `needsFit`, which the route returns as
  `{ needsFit: true }` (Phase 3 makes the parked card tappable on it).
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
- **The golden set** (`__tests__/fixtures/fit-golden.json`, run by
  `__tests__/fit-golden.test.ts`) is the expert ground truth: raw ratings +
  a gear shape per case, an ACCEPTABLE set, never a derived level. Empty
  today and skipping loudly; Phase 4 raises the guard to five cases.
- `canon`, `isScorable`, `overall`, `skillLevel`, `maxFlexDemand` and the
  derived-profile helpers MOVED here; `lib/racketRecommend.ts` re-exports
  them until it retires.

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
  - **`fitArmComfort` is health-adjacent.** The gear GET is public by name, so
    the route strips it for anyone but the owner or an admin — with the FRESH
    role re-check on that cold path, so a demoted admin's live cookie does not
    read it for 30 days (same shape as the pinHash strip-canary, tested by
    VALUE not by key — the mock keeps an explicit `undefined`, production JSON
    drops it); it is disclosed in
    `legal.privacy` in both locales (pinned by the `'arm or shoulder'` needle
    in `__tests__/legal-pages.test.ts`) and purged with the doc. **A strip
    sets `fitArmComfortRedacted: true`** (response-only, never stored): the
    OWNER on a lapsed 30-day `member_session` reads by name like anyone else,
    and without the marker the sheet would show "not answered" for a value
    Cosmos still holds — the lying-empty-state rule, produced by the strip
    itself. What leaks is that SOME answer exists, never which. A `Clear`
    link renders only while an answer is stored — a Clear that clears nothing
    is a button that lies.
  - **`writeGearDoc` rebuilds the doc from an explicit field list.** A field
    left off it survives the PATCH that wrote it and is dropped by the next
    POST or DELETE. Pinned by "fit answers survive a bag write".
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
    which drifted twice (a free-text racket, an unresolvable catalogId); and
    a category whose in-flight fetch the effect's cleanup discarded is never
    skipped, whatever its status (`cancelledRef`), or the answer from before
    the change stays on screen. Nothing about the bag is an effect dependency:
    keyed on it, adding the recommended racket re-scored with it excluded and
    swapped the pick out from under the YOU OWN THIS flip.
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
