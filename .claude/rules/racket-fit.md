---
paths:
  - "components/stats/**"
  - "lib/racketFit*.ts"
  - "lib/fit*.ts"
  - "lib/racketRecommend.ts"
  - "lib/recommend.ts"
  - "lib/racketProfile.ts"
  - "lib/racketModel.ts"
  - "lib/racketSpecs.ts"
  - "app/api/equipment/**"
  - "app/api/reports/fit-backtest/**"
  - "__tests__/*fit*.test.ts"
  - "__tests__/*recommend*.test.ts"
---

# Racket FIT engine and racket recommender

<!-- Moved word for word from components/stats/CLAUDE.md on 2026-11-08. -->

### Racket FIT engine (Phase 2, 2026-09-09; its flag `NEXT_PUBLIC_FLAG_RACKET_FIT` retired 2026-10-24)

`lib/racketFit.ts` replaces the seven scorers below on the racket branch of
`GET /api/recommend`; the old branch is gone from the route. Spec:
`docs/superpowers/specs/2026-09-07-racket-fit-design.md`. Pure, no I/O.

- **A distance model against a TARGET SPEC**, not rule scorers. Target =
  the member's ACTIVE racket's axes (balance 1–3, flex 1–5, weight midpoint,
  tier 1–3) plus the goal delta (`GOAL_DELTA` — the one table of badminton
  judgment in the file; tune it there and let the golden set say whether it
  was right — read through `goalDelta(goal, swing)`, because since `fit-3`
  (2026-10-09) a SLOW swing's `more_power` is `SLOW_SWING_POWER_DELTA`: no
  head-heavy step, no extra grams, a one-line `reason.slowSwingPower` on the
  even frames it picks instead. A heavier head adds power only to a swing
  fast enough to accelerate it; the stringer rated golden case g01 that way.
  `lib/fitVerdict.ts` reads the same function with the same swing), then swing sets the flex CEILING (the ONLY input that speaks to
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
  `{ needsFit: true }`; `useGearPicks` parks on it with a `parkReason`, and
  `NextRacketCard` renders a racket parked on `needsFit` as a tappable DOOR to
  the questionnaire (`railRacketFit` + `railTapToFit`) — never "do a check-in".
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
  a gear shape per case, an ACCEPTABLE set, never a derived level. One rated
  case (g01, 2026-10-09) and two `pending` drafts the harness reports without
  asserting; Phase 4 raises the guard to five rated cases.
- `canon`, `isScorable`, `overall`, `skillLevel` and the derived-profile
  helpers MOVED here; `lib/racketRecommend.ts` re-exports them until it
  retires. `maxFlexDemand` is still exported for that legacy path only — the
  fit engine no longer reads it.

### Racket recommender (`NEXT_PUBLIC_FLAG_GEAR_RECOMMENDER`) — off the route since the flag above retired (2026-10-24); `recommendRackets` stays for Phase 4

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
- **The fit questionnaire WAS its own sheet — `GearFitSheet`** (DELETED
  2026-10-19 when `NEXT_PUBLIC_FLAG_GEAR_PAGES` retired; `FitProfilePage` asks the
  questions now, so read what follows as the history of rules that page
  inherits, not as a live component) (racket-fit
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
    `PROFILE_READS_FIT` (`lib/racketProfile.ts`) is true — which it has been
    since the Phase 2 engine shipped (2026-09-09, #345); before that it was
    false, because re-asking on a field no engine reads burnt the 10/min/IP
    limiter on identical answers (three reviewers, one throttle-math). It
    lives THERE, next to `buildProfile`, so the rail cannot drift from the
    server. With the gate open: a change that leaves
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
    **A fit-driven refetch is HELD while the fit page is open**
    (`holdFitRefetch`, from a `fit` entry on `GearRegister`'s page stack): answered at a human
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
