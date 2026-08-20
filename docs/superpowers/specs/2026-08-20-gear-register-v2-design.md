# Gear register v2 — design

**Date:** 2026-08-20
**Status:** approved, ready to plan
**Depends on:** PR #262 (Stats v2 Stage 8). This work deletes `RacketRow`, which
the pre-Stage-8 `SkillsTab` still imports for its v1 path. Branch
`feat/gear-register-v2` is based on `chore/stats-v2-stage8`; rebase onto `main`
once #262 merges.

---

## Why

The Gear register was never designed. You / Play / Learn each got a purpose-built
v2 layout; Gear got the **v1 Equipment tab (`RacketRow`) with four v2 cards
stacked underneath it**. That composition produces three defects, only the first
of which is visible:

1. **A live data bug.** `GET /api/equipment/gear` is fetched **four times** per
   register mount by components that don't know about each other —
   `RacketRow` (`useGear` instance A), `YourKitCard` (`useGear` instance B),
   `GearRail:76` (raw fetch), `StringTensionCard:40` (raw fetch). There are also
   **two independent writers**: `useGear`'s mutations and `StringTensionCard:72`,
   which PUTs directly. `useGear` holds `useState`/`useRef` with no module store,
   no context and no cross-instance event, so the instances cannot see each
   other's writes. **Adding a racket via "Your kit → Racket → Add" leaves
   `RacketRow`'s hero and bag list above it showing stale data until reload.**
   `components/stats/CLAUDE.md` says "Never add a gear fetch outside this hook";
   three of the four readers break it.
2. **Two doors to the same room.** `RacketRow` mounts a `GearSheet` and
   `YourKitCard` mounts a second one. `GearRegister`'s own docstring says the
   design is "deliberately not two doors to the same room."
3. **Two design languages.** `RacketRow` reads the `valueHub` i18n namespace
   while every other Gear card reads `stats.gear`; it re-resolves identity
   locally instead of taking the `activeName` prop the register hands everyone
   else; its sub-cards pad 16px against the v2 cards' `p-5`.

`GearRail`'s docstring — *"The racket is NOT a card here: `RacketRow` already
renders a hero... a second racket card in the rail would be a second door"* —
shows the rail was shaped **around** `RacketRow`. Removing `RacketRow` therefore
changes what the rail should be, not merely what sits above it.

## What we're building

The Gear artboard from the Claude Design handoff ("Stats Frame"). Gear is a
**reference surface**: it answers "what should I play with?" Managing what you
own is a deliberate detour behind one door per category, not the register's job.

```
GEAR
┌─ pick rail (horizontal scroll) ─────────────────┐
│ ┌ RACKET ────────┐ ┌ SHOES ─────────┐ ┌ STRINGS │
│ │ Yours · Astrox │ │ Yours · none   │ │ Yours · │
│ │ Astrox 99 Pro  │ │ Power Cushion  │ │ Nanogy  │
│ │ Yonex · stiffer│ │ Yonex · nothing│ │ Yonex · │
│ │ Why this? ⌄    │ │ Why this? ⌄    │ │ Why th… │
│ └────────────────┘ └────────────────┘ └─────────│
└─────────────────────────────────────────────────┘
┌─ Your kit ──────────────────────────────────────┐
│ RACKET    Astrox 88D Pro              Change ›  │
│ STRINGS   BG65 · 24 lb                Change ›  │
│ SHOES     Not set                        Add ›  │
│ SHUTTLES  Not set                        Add ›  │
└─────────────────────────────────────────────────┘
[ String at 24 lb        ]   ← StringTensionCard
[ What the club plays    ]   ← ClubGearCard
```

**No hero.** All four registers lead with a card. The racket's specs live in the
picker, where you are actually comparing.

### Owned-state flip

When the recommendation *is* what the member already owns, the card must stop
recommending it back at them (this was a live bug in the prototype, called out in
plan Stage 6):

| | Not owned | Owned |
|---|---|---|
| Pill | — | `IN YOUR KIT` (accent) |
| Sub-line | `Yours · none on file` | `Saved to your kit` |
| Disclosure | `Why this?` | `Why we picked it` |

## Component shape

`GearRegister` becomes the single owner and pure composition:

```
GearRegister              calls useGear(activeName) ONCE
├── GearPickRail          replaces GearRail; one card per category, racket included
│   └── GearPickCard      "Yours · X", the pick, disclosure, owned-state flip
│       └── GearPickSheet NEW — We recommend / plain line / WHY THIS / Add to my kit
├── YourKitCard           extracted to its own file; gear via props
│   └── GearSheet         catalog picker + owned items (BagList moves in here)
├── StringTensionCard     gear + setPrefs via props; stops fetching
└── ClubGearCard          extracted to its own file
```

**Deleted:** `RacketRow`, `GearRail`, `cards/YourRacketCard`, `cards/RacketRecCard`.
**Relocated:** `BagList` survives, moving inside `GearSheet`.

Two sheets, two jobs, no overlap:

- **`GearPickSheet`** — *"take our pick."* Opened from a rail card. Recommendation
  detail, then one action: **Add to my kit**.
- **`GearSheet`** — *"choose your own."* Opened from a kit row's Change/Add. Owned
  items in that category at the top (switch / remove), catalog below (add).

This is the distinction that keeps the redesign from repeating the current
double-door. A door to "the thing we suggest" and a door to "the whole catalog"
are different rooms.

`GearSheet` already accepts `category`, `title` and `hint` props, so it needs an
owned-items header section, not a rewrite.

## State ownership

`GearRegister` calls `useGear(activeName)` once and passes the `UseGear` object
down one level. **No context** — the tree is shallow, and a single literal call
site is the only version of "single owner" that cannot quietly decay back into
the current state.

`StringTensionCard` takes `gear` and `setPrefs` from that object and stops both
its read and its direct PUT.

**Required regression test:** the register issues **exactly one**
`GET /api/equipment/gear` per mount. This is the invariant that broke, and
nothing was watching it. A doc comment is what we had; it did not hold.

## API changes

### `GET /api/recommend?category=<category>`

Today the route hardcodes `category: 'racket'` in both queries (lines 131, 163)
and `recommendRackets` hard-filters `item.category !== 'racket'` internally
(line 339). Plan Stage 6 called for a `category` parameter; it was never built.

- Absent `category` → `racket`, so existing callers are unaffected.
- Unrecognised `category` → **400 `invalid_category`**, matching the fix already
  made in `app/api/equipment/catalog/route.ts` (an unrecognised category used to
  coerce silently to `racket` and answer 200 — a plural typo like `shoes` would
  have returned rackets with a success status).
- `recommendRackets`' internal category filter becomes a parameter.
- The rail requests only **sourced** categories — one request today, two once
  strings land. It does not fan out to four.

Rate limiting stays first in the handler (security rule 4). The existing flag-on
privacy gate — `verifyMemberAuth` + name ownership, or admin — **stays and becomes
load-bearing**, see below.

## Why-this reasons, and the privacy constraint

The artboard's reasons cite cross-domain facts ("You are drilling split steps
twice a week", "Wide last fits the foot shape most of the club reports"). Today's
engine only produces equipment-derived reasons. We are wiring in the other two
sources. A reason may cite:

1. the member's own skill ratings (`assessments`);
2. catalog specs;
3. the member's current drill picks (`lib/drills.ts` → `DrillPick.skillLabel`,
   `title`, `setting`);
4. club aggregates — **only through `tallyClubGear`**, never re-derived.

Point 4 is the constraint that matters. `lib/clubGear.ts` enforces
`CLUB_GEAR_MIN_COHORT = 3` and **drops** sub-cohort entries rather than showing
them with a count, because "1 player uses X" in a twelve-person club, plus knowing
who turned up, is a name. A personalised reason is a **new disclosure surface for
that data**, so it must inherit the guard by calling the same helper. A reason
must never cite a club fact that did not survive the cohort filter.

Adding drills to reasons also makes `/api/recommend`'s auth gate load-bearing
rather than defensive: drill picks are already member-cookie gated, so the
recommendation route must not become a way to read them for an arbitrary name.

## States and failure

Every rail card renders one of four states honestly. `catch { setX([]) }` is
forbidden — a loaded-empty card must not look like a failure, and a failed card
must not look confidently empty.

| State | Render |
|---|---|
| Loading | `CardSkeleton` at the card's own height |
| Error | `ErrorState` in-card, `role="alert"` |
| No pick possible | The parked card, naming what the category **will** do |
| Ready | The pick |

**Parked is driven by a catalog probe, not a flag** — the rule `GearRail` already
follows. Landing shoe rows un-parks shoes with zero code change. Note that
catalog seeding **refreshes**, it does not only fill (see the `ensureCatalogSeeded`
note in `CLAUDE.md`), so sourcing rows is a data task with its own hazard.

The parked card is not drawn in the artboard, because the artboard assumes the
data exists. It is kept deliberately: naming what a category will do is the
difference between "not built yet" and "broken".

**"No pick possible" has two distinct causes and ONE rendered state.** A category
can fail to produce a pick because it has no catalog rows (shoes, shuttles) *or*
because it has rows but no recommender (strings, until the follow-up PR). Both
collapse to the same parked card: from the member's side the fact is identical —
"we can't suggest one for you yet" — and splitting it into two near-identical
cards would be a distinction drawn for the implementer's benefit.

**This produces one combination that looks like a bug and is not:** strings will
show a **parked rail card** (no recommender) while its **`Your kit` row is fully
live** (46 catalog rows, pickable via `GearSheet`). Suggesting and owning are
different capabilities with different requirements. Do not "fix" the kit row to
match the rail card, or vice versa; the follow-up PR resolves it by landing the
recommender.

## Scope

### In this PR

- The pick rail, `GearPickCard`, `GearPickSheet`, the owned-state flip.
- `GET /api/recommend?category=` as a real dimension.
- Single gear owner + the one-fetch regression test (fixes the live bug).
- `YourKitCard` / `ClubGearCard` extracted to their own files.
- `BagList` relocated into `GearSheet`.
- i18n consolidated onto `stats.gear.*`; retire the `valueHub.*` keys owned by
  the deleted components.

**Racket recommends for real. Strings, shoes and shuttles render the parked card.**

### Follow-up PR

Port `docs/superpowers/reference/pair_racket_string.py` to TS so strings go live
(2 of 4). Kept separate so a scoring engine gets its own tests and review rather
than riding along with a layout refactor.

### Not code

Shoes and shuttles need catalog rows sourced. The catalog holds **71 rackets, 46
strings, zero shoes, zero shuttles**. No amount of UI makes them recommend. The
artboard's headline example is a shoe, so the drawing depicts a state the data
cannot reach yet.

## Testing

**Route** (`__tests__/` pattern: import the handler directly, `resetMockStore()` +
`setupAdminPin()` in `beforeEach`, `makeRequest()` for the unique `X-Client-IP`):

- per-category responses; absent category → racket
- unrecognised category → 400
- flag-off → 404; no cookie → 403; wrong-owner cookie → 403; admin-browses-another
- zero catalog rows for a category → no pick, not an error

**Privacy:**

- a why-this reason never cites a club fact below `CLUB_GEAR_MIN_COHORT`

**Component** (jsdom pragma line 1, `NextIntlClientProvider` with real
`messages/en.json`, `setIdentity()` for `activeName`, `afterEach(cleanup)`):

- the `IN YOUR KIT` flip and the `Why we picked it` relabel
- the parked card for an unsourced category
- add-from-`GearPickSheet` updates `Your kit` **and** the rail card in one pass
- **exactly one `GET /api/equipment/gear` per register mount**

**Gates:** full `npm test` and `npm run lint` between tasks, not only at the end;
`npx tsc --noEmit` before push. `components/stats` errors rather than warns on the
token guardrail, so new code there must be token-clean.

## Open questions

None blocking. Two noted for the follow-up:

- Whether the string recommender should reuse `racketRecommend`'s weighted-scorer
  shape or follow `pair_racket_string.py`'s pairing model, which is a different
  algorithm (it pairs a string *to a racket*, not to a player).
- ~~Whether `Your kit` should show the string's tension inline from advice or from
  a stored value. The data model has no per-item tension field.~~ **Corrected
  2026-08-20:** the field exists. `GearItem.tensionLbs` (`lib/types.ts:295`, "tension
  in lbs at last restring") is already accepted by the gear PUT at
  `app/api/equipment/gear/route.ts:349`. It has **no writer in the UI and no
  reader** — so the storage is there and nothing fills it.

  Resolved: `Your kit` renders `· NN lb` only when `tensionLbs` is present, and
  the string picker gains a small tension capture prefilled from
  `recommendTension` (`lib/tension.ts`). No schema or API work — without a writer
  the artboard's `BG65 · 24 lb` row is simply unreachable. This is a deliberate
  addition beyond the original scope, justified by it being the drawn state and
  costing one field on an existing sheet.

  **Do not conflate the two numbers.** `StringTensionCard` shows *advice* (what we
  suggest you string at, derived from level and format); `tensionLbs` is *fact*
  (what you actually strung at). They will often disagree, and that disagreement
  is meaningful — never backfill the fact from the advice.
