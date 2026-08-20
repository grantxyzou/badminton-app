# Equipment tab — components/stats

Moved out of the root `CLAUDE.md` so it loads only when working in this
directory. Everything below is unchanged.

## Equipment Tab

The Equipment register inside Stats (`RacketRow`, gated on
`NEXT_PUBLIC_FLAG_VALUE_HUB_SLICE`). **The tab IS the player's bag** — hero
(today's racket) → recommendation → your rackets → "+ Add a racket". Adding is
the only thing that opens a sheet, and that sheet does nothing else.

- **`components/stats/useGear.ts` is the single owner of gear state.** It holds
  `gear/rackets/active/loaded/loadError/busy/online` plus `reload/add/activate/
  remove/setPrefs`, and ONE monotonic op counter shared by the read and all
  writes. Before it, `RacketRow` held the read and `GearSheet` held the writes,
  each with its own counter — that out-of-order-response race has shipped here
  twice. Never add a gear fetch outside this hook.
- **`GearSheet` is a catalog picker and nothing else.** Full height (`92dvh` —
  `vh` ignores collapsible mobile chrome and clips the sheet), search-first,
  one tap commits and closes. Rows show brand ABOVE model: a query searches all
  brands at once, and brand used to live only in the `aria-label`, so exactly
  the cross-brand results where brand matters rendered as bare model names.
  Rackets already in the bag are omitted, which takes `duplicate_racket` off
  the happy path.
- **`BagList` always renders, active racket included.** It used to hide below
  two rackets ("a bag of one is chrome") — correct inside a sheet, wrong once
  the tab became the bag, because it left a one-racket player unable to remove
  or replace what they owned. The active row shows a badge instead of "Use this
  one" but keeps its remove button. Don't reintroduce the guard.
- **The hero is display-only.** With the bag on the tab, switching and removing
  live in the list and adding has its own button, so a tappable hero would be a
  second door to the same room (same principle as `RacketRecCard`'s
  conditional interactivity).
- **`lib/activeRacket.ts`** resolves the active racket read-tolerantly: new docs
  carry `activeRacketId`, legacy docs fall back to `items[0]`. No migration.

### Racket recommender (`NEXT_PUBLIC_FLAG_RACKET_RECOMMENDER`)

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
- **No assessment → no recommendation.** With no ratings the engine would score
  fourteen 3s and emit a confident, meaningless pick. The card says "do the
  check-in" instead.
- **The flag-on route requires auth; flag-off stays public.** `GET
  /api/recommend` was unauthenticated because it returned only a coarse
  stage-derived pick. Engine reasons quote individual ratings ("smash 4/5"),
  and member names are enumerable via `GET /api/members`, so the flag-on branch
  gates on a `member_session` cookie for that name or admin (same gate as
  `/api/stats/level`). Rate limiting stays first (security rule 4).
- **Format and budget are asked, not inferred** — the engine's author flagged
  both as not derivable from skill scores. Stored as optional
  `playFormat`/`budgetMaxCad` on `PlayerGear`; budget bands are CAD and every
  band sets an UPPER bound.

