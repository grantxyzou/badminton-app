# Visual update: "Fields and card materials" — audit + plan

> **Status (2026-08-26): built, behind `NEXT_PUBLIC_FLAG_VISUAL_FIELDS`.**
> The Stage 4 track gate has been run. **One hue per tab won**; the one-hue-at-
> five-depths alternative was deleted rather than left behind a second switch.
>
> That choice spends four semantic hues, and two of them collide on their own
> tab. Both were measured rather than eyeballed — compositing the tint over
> the card over the field and computing WCAG ratios — and the numbers, the
> fixes and the rejected alternatives live in `app/globals.css` under
> **"Semantic hues displaced by the fields"**. Headline findings:
>
> - Sign-Ups amber-on-amber measured **1.086:1** against its own card
>   (1.000:1 is identical). Home green-on-green: 1.079:1. Fixed by moving the
>   row tints onto the field-card alpha ladder plus an inset edge.
> - Stats was a real **AA failure**: `--sev-low-text` at **3.10:1**. Three of
>   its five uses are gradient fills (WCAG 3:1 — pass) and two are 10px
>   category eyebrows (4.5:1 — fail). Only the text moved, via a new
>   `--sev-low-label`, dark-mode only.
>
> Two audit findings became real guardrails: `prefers-reduced-transparency`
> had never flattened `.glass-card` at all, and 30px radii were mechanically
> unguarded. Both are now covered.
>
> The sections below are the original audit and plan, kept as written.

## Context

`Visual Colours.dc.html` (Claude Design project `79ed25dd…`) proposes a new visual
direction built on two ideas the current system does not name:

- a **field** — a coloured radial-gradient ground that identifies which tab you're
  in, replacing the shared aurora background;
- a set of **card materials** — seven card states at **30px** radius on a much
  heavier frost, replacing the current 16px near-invisible glass.

The ask was *audit and plan how the app will look with this update*. Part 1 is the
audit; Part 2 is the staged plan.

**Decisions taken (2026-08-25):** plan **both** field tracks and choose on the
`/design` preview · **replace `.glass-card` outright** rather than adding a variant
· **migrate all five tabs**.

**Source of truth is `§06 · TOKENS` inside `Visual Colours.dc.html`.** Do **not**
port the design project's `lib/bpm-tokens.css` — see Conflict 1.

`support.js` in the bundle is the generated Design-Canvas runtime (`dc-runtime`:
`<x-dc>`, `<sc-if>`, `{{ }}` bindings, `DCLogic`) — a React template engine that
renders the prototype. It contains **no design decisions and nothing to port**.

---

# Part 1 — Audit

## 1.1 What already exists (the design under-credits this)

The per-tab background mechanism the design proposes **is already built**.
`components/HomeShell.tsx` writes `document.documentElement.setAttribute('data-tab', activeTab)`,
and `app/globals.css` already carries three per-tab overrides:

| `data-tab` | Today | globals.css |
|---|---|---|
| `players` (Sign-Ups) | **03 Court** — `radial-gradient(ellipse 120% 80% at 50% 115%, rgba(22,163,74,.18), transparent 60%)` on `background`, doubles-court SVG on `::before` | 915–968 |
| `skills` (Stats) | **05 Tempo Field** — flat `--page-bg` on `background`, 42px dot grid on `::before`; *plus* a tab-scoped `.glass-card` override at blur 22 / saturate 220% | 977–1003, 1023–1098 |
| `admin` | flat `var(--page-bg)` | 1009–1017 |
| `home`, `profile` | **no override** — fall through to the 3-blob aurora | 794–907 |

So "one field per tab" is an **extension of an established pattern**. Sign-Ups'
green ground is already a field in everything but name. Only Home and Profile
genuinely lack one. `DESIGN.md` §14 already blesses this: *"Adding a new per-tab
variant = one CSS block, no component changes."*

**Crucially, the existing rules split ground from motif:** the field goes on
`background`, the court SVG / dot grid live on `::before`. That is exactly the
seam a field needs, so Sign-Ups and Stats keep their identity — see Conflict 6.

## 1.2 What the design actually changes

**Dark mode:**

| Property | App today | Design | Delta |
|---|---|---|---|
| Card fill | `rgba(255,255,255,.03) → .01` | `rgba(255,255,255,.17) → .09` | **5–9× heavier** |
| Blur | `blur(10px) saturate(180%)` | `blur(16px) saturate(130%)` | +6px, less saturated |
| Inset | `rgba(255,255,255,.14)` | `rgba(255,255,255,.14)` | **identical** |
| Drop shadow | *none applied* | `0 8px 40px rgba(0,0,0,.25), 0 2px 8px rgba(0,0,0,.12)` | **identical to the unused `--glass-shadow`** |
| Radius | `16px` (hardcoded, not `var(--radius-xl)`) | `30px` | +14px |
| Border | `1px solid var(--glass-border)` | none — rim is the inset only | removed |

**Light mode:**

| Property | App today | Design | Delta |
|---|---|---|---|
| Card fill | `rgba(255,255,255,.72) → .55` | `rgba(255,255,255,.72) → .50` | negligible |
| Blur | `blur(16px) saturate(180%)` | `blur(20px) saturate(140%)` | +4px |
| Inset | `rgba(255,255,255,.50)` | `rgba(255,255,255,.90)` | brighter rim |
| Shadow | `0 8px 40px rgba(0,0,0,.06), 0 2px 8px …` (unused) | `0 8px 26px rgba(0,0,0,.06), 0 2px 6px …` | near-identical |

### The two headline findings

**1. The material change is a dark-mode change.** Cards go from an almost-invisible
film to a milky frosted panel — a 5–9× jump in fill. Light mode's *fill* barely
moves, but its **edge treatment changes completely**: the `rgba(0,0,0,0.08)` border
goes away and the top inset nearly doubles (`.50` → `.90`), so the card edge stops
being a drawn line and becomes a highlight. That is a real change, not a no-op —
**check light mode at the Stage 4 gate too.** The headline stands: dark is where
the material is decided.

**2. Three of the "new" values already exist in the app, unused.**
`--glass-shadow` is defined and never applied by `.glass-card`; `--forest-800:
#0a1f0e` is exactly the design's Stats-field core; and the whole `data-tab`
mechanism is built. Part of this direction is switching on things already paid for.

## 1.3 Surface-by-surface

| Surface | Field today | Field proposed (Track A) | Cards affected |
|---|---|---|---|
| **Home** — `components/HomeTab.tsx` (694 ln) | aurora | `--field-home`, green @42% | announcement, sign-up card, date/location tiles, `PrevPaymentReminder` |
| **Sign-Ups** — `components/PlayersTab.tsx` (268 ln) | 03 Court | `--field-signups` **under** the court SVG | roster rows, capacity card |
| **Stats** — `components/SkillsTab.tsx` → `components/stats/` (26 files, ~5.9k ln) | 05 Tempo Field | `--field-stats` **under** the dot grid | `OverviewStrip`, `SkillTrendCard`, `WhereYouSitCard`, `YourRecordCard`, `LearnRegister`, `GearRegister` |
| **Profile** — `components/ProfileTab.tsx` (769 ln) | aurora | `--field-profile`, cool blue-grey | identity card, `SettingsList`, `StatsPrivacyScreen` |
| **Admin** — `components/admin/` (~4.7k ln) | flat | `--field-admin`, warm sand | `.admin-hero`, `.cc-tile`, `.cc-dcard`, `PaymentsCard`, `AnomalyFeed` |
| **Sheets** — 13 `BottomSheet` consumers | inherit page | inherit the field (design rule 1) | the sheet surface itself |
| **`/design` preview** — 7 sub-pages | aurora; `data-tab` is *removed* on unmount | inherits the un-attributed default | `/design/backgrounds` gains the fields |

`.glass-card` appears **124 times across 54 files**. Because we are redefining the
class rather than adding one, **none of those call sites change.**

## 1.4 Conflicts, in severity order

### Conflict 1 — `lib/bpm-tokens.css` in the design project has a stale type scale. Do not port it.
It claims *"Extracted from app/globals.css"* but ships `--fs-xs: 14px`,
`--fs-sm: 16px`, `--fs-base: 16px`, `--fs-lg: 18px`. The app's real scale is
`--fs-2xs 10 / xs 11 / sm 12 / base 13 / md 14 / lg 16 / stat 20 / stat-lg 22 /
stat-xl 38`. Copying that file **re-bases every font size in the app**, and
`design-canary.test.ts` pins four of those values, so it fails loudly — but only
after the damage is in the diff. Port `§06` from the `.dc.html` only.

### Conflict 2 — the design's tokens reference `--bpm-*` variables that do not exist in the app.
`--field-base: var(--bpm-night)`, `--fcard-title: var(--bpm-ink)`, and the light
`var(--bpm-cream)`. Confirmed by grep: **no `--bpm-*` token is defined anywhere in
`app/globals.css`.** They exist only in `docs/design-system/colors_and_type.css`,
which is deliberately never imported (cascade-clobber trap; `app/design/layout.tsx:6`
carries an explicit "Do NOT import" comment). Ported verbatim these resolve to
nothing and the field renders transparent.

**Rewrite table — apply to every `§06` value:**

| Design writes | Port as |
|---|---|
| `var(--bpm-night)` / `var(--bpm-cream)` | `var(--page-bg)` |
| `var(--bpm-ink)` | `var(--text-primary)` |
| `#0a1f0e` | `var(--forest-800)` |
| `#4ade80` / `#16a34a` | `var(--accent)` / `var(--accent-dark)` |
| `#fbbf24` / `#d97706` | `var(--accent-amber)` |
| bare `rgba(...)` in a gradient | keep the literal **inside `globals.css` only** — it is a token *definition*; never let it reach a `.tsx` inline style |

### Conflict 3 — the 16px radius cap.
`DESIGN.md` §4 and §9 cap rectangular surfaces at 16px, and `CLAUDE.md:63` calls
the historic 24px glass-card *"a self-inflicted spec violation."* Replacing
`.glass-card` at 30px **reverses a written principle**, so `DESIGN.md` and
`CLAUDE.md` must be amended in the same PR, not after. Quote the design's own
reconciliation verbatim beside the token:

> "the 16px radius cap now holds for flat-field surfaces and `--radius-3xl` (30px)
> is scoped to field cards only"

Worth knowing the ladder is **already violated** in live CSS: `.btn-primary`,
`.btn-ghost`, `.cc-btn-lg` and `.cc-tile` all hardcode **14px**;
`--rail-indicator-radius` is **15px**. Neither is a rung (the ladder jumps 12→16).
And `.glass-card` hardcodes `16px` rather than `var(--radius-xl)`.

⚠️ **30px radii are mechanically unguarded.** The ESLint rule is
`Property[key.name='borderRadius'] > Literal[raw=/^[0-9]/]` — a *raw number* in
JSX. `borderRadius: 'var(--radius-3xl)'` never matches, and ESLint doesn't parse
CSS at all. Nothing but prose stops the next person reading 30px as the new cap.
Stage 1 adds the missing guardrail.

### Conflict 4 — `.glass-card` is load-bearing in tests and cannot be renamed.
`design-canary.test.ts` asserts the literal strings `.glass-card` and
`.glass-card-soft` appear in `globals.css`. `UnpaidSessionsCard.test.tsx` and
`WhereYouSitCard.test.tsx` assert `container.querySelector('.glass-card')` is
`null` in the hidden state — the class name is how they detect "did it render".
`glass-card-nesting.test.ts` forbids `.glass-card` inside `.glass-card`.
**Redefine the rule; never rename the class.** This is what makes "replace
outright" cheap.

### Conflict 5 — the design's Profile/Admin hues come from dead tokens.
It sources them from "aurora blob 1/2" (`#8FA2B0`, `#BEB293`) — the values in
`--aurora-blob1` / `--aurora-blob2`. Those tokens are **vestigial**: the live
`.aurora-blob-N` rules (globals.css:823–862) hardcode entirely different colours
(`rgba(120,158,196,…)`, `rgba(74,222,128,…)`, `rgba(232,210,160,…)`) and never
read the vars. The hues are still fine — just don't defend them as continuity, and
delete the four dead `--aurora-blob*` / three `--aurora-opacity-*` tokens when the
aurora goes.

### Conflict 6 — Sign-Ups and Stats have identities a naive field would erase. Resolved.
The court SVG *is* the Sign-Ups tab; the dot grid *is* Stats. Both already live on
`::before` while the ground lives on `background`, so the field slots underneath
with a one-line change and the motif survives:

```css
/* Sign-Ups — was: radial-gradient(…rgba(22,163,74,.18)…), var(--page-bg) */
html[data-tab="players"] .court-bg { background: var(--field-signups), var(--field-base); }
/* ::before (court SVG) unchanged */

/* Stats — was: var(--page-bg) */
html[data-tab="skills"]  .court-bg { background: var(--field-stats),   var(--field-base); }
/* ::before (42px dot grid) unchanged */
```

Check the dot grid's `rgba(74,222,128,.22)` against the deeper Stats field — it may
need to drop toward `.14`, since it was tuned against flat `--page-bg`.

### Conflict 7 — first paint has no field.
`data-tab` is set in a `useEffect`, so SSR and first paint carry no attribute.
Today that means "aurora, then swap." With fields it means a visible flash on the
LCP frame. **Fix: make Home's field the un-attributed default on `.court-bg`
itself**, so no-attribute → Home. That also gives `/design/*` a sane ground (its
layout renders `.court-bg` with `data-tab` absent — `HomeShell`'s cleanup removes it).

### Conflict 8 — the ESLint token guardrail is at `error` in four directories.
`components/stats` errors on `DESIGN_TOKEN_SELECTORS` (bare hex + raw inline
`borderRadius`). `components/{primitives,home,BottomSheet}` error on the **full**
set — numeric inline `fontSize`, bare `rgba()`, bare Tailwind `text-xs|sm|base`.
The design spec is saturated with bare `rgba()`.

> **Hard rule for this whole change: every value lands as a token in `globals.css`
> and is consumed via `var()`. Inlining a gradient is the obvious shortcut and it
> is a build error in four directories.**

(Flat config *replaces* rather than merges, so `components/stats` is stricter on
hex/radius but — a real gap — **unguarded** on `fontSize`/`rgba()`/text-size.)

### Conflict 9 — `theme_color` is hardcoded in three places and tested in none.
`app/manifest.ts:28–29` (`background_color`, `theme_color`) and
`app/layout.tsx:104` (`themeColor`) all hardcode `#100F0F`. Fields tint the top of
the page, so the iOS status bar and PWA splash will mismatch. Update by hand.

### Conflict 10 — `docs/design-system/README.md` is stale and appears to bless this.
It says *"rounded-3xl-ish (24px) card corners"* and *"System font stack… no web
fonts for body copy"* — both contradict the enforced contract. It is **also** the
only doc that states the *"One brand accent / No third brand color"* rule that
Track B would break. Treat it as stale reference, and fix it in Stage 8 rather
than citing it either way.

## 1.5 Left explicitly undecided

- **Photographic fields.** The design's closing note: frames 5a/5b of
  `Stats Tab.dc.html` drop a photo behind the cards, and *"a photo overrides every
  value here."* Out of scope; do not chase it.
- **Track A vs Track B** — resolved by Stage 4's gate, not up front.

---

# Part 2 — Plan

Nine stages. Stages 1–3 are additive and reversible; **Stage 5 is the one-way
door**. Stage 4 is a look-at-it-on-a-phone gate that sits deliberately between them.

Everything from Stage 2 on is gated by one new flag, `NEXT_PUBLIC_FLAG_VISUAL_FIELDS`.

### The flag mechanic (CSS can't call `isFlagOn()`)

Precedent: `NEXT_PUBLIC_FLAG_NAV_RAIL`, described in `lib/flags.ts` as *"Purely
presentational — same Tab ids / routing / i18n / aria."* Mirror it.

Because `NEXT_PUBLIC_*` vars are inlined server-side too, read the flag in the
**root layout** and stamp the attribute on `<html>` during SSR — no flash, unlike
`data-tab`:

```tsx
// app/layout.tsx
<html lang={locale} data-visual={isFlagOn('NEXT_PUBLIC_FLAG_VISUAL_FIELDS') ? 'field' : undefined}>
```

then every new rule is scoped `html[data-visual="field"] …`. Flipping the flag off
restores the current look with zero component changes.

**Adding the flag is four coordinated edits or CI goes red** (`dev-next-flag-parity.test.ts`
asserts set equality in both directions, and the `PostToolUse` hook runs
`scripts/check-flag-sync.mjs` on every edit):
1. the `FlagName` union · 2. the `FLAGS` record · 3. a `case` in the `readFlag`
switch (its `default` has `const unhandled: never = name`) · 4. **both**
`package.json`'s `dev:next` script **and** `.github/workflows/deploy-next.yml`,
each with the literal `=true`.

---

## Stage 1 — Tokens + the missing radius guardrail

**`app/globals.css`** — add one new section after the radius ladder (block D, ~line 444).

- `--radius-3xl: 30px`, with the design's reconciliation sentence quoted as a
  comment. **Leave `--radius-xl: 16px` untouched** — `design-canary` pins it.
- The `§06` token set, both tracks, put through the Conflict-2 rewrite table:
  `--field-base`, `--field-{home,signups,stats,profile,admin}`, `--field-scrim`,
  and `--field-b-{home,signups,stats,profile,admin}` for Track B.
- `--fcard-{radius,bg,blur,inset,shadow}`, the five state fills
  (`-pick-bg`, `-pick-inset`, `-good-bg`, `-wait-bg`, `-full-bg`, `-error-bg`,
  `-locked-bg`), the ink trio (`-title`, `-label`, `-footnote`), and
  `--ink-button` / `--ink-button-fg` (`#131313` in **both** modes — the design
  calls this constant "what makes the direction recognisable").
- Full `[data-theme="light"]` counterparts for every one of the above.

**`__tests__/design-canary.test.ts`** — add the guardrail that doesn't exist:
- `--radius-3xl: 30px` is present and `--radius-xl: 16px` still is;
- **`globals.css` contains zero literal `border-radius: 30px`** — every 30px corner
  must go through the token. That is the only mechanically checkable form of
  "scoped to field cards only," and it's the guardrail Conflict 3 flags as missing.
- the new `--field-*` / `--fcard-*` names are present (same `toContain` pattern as
  the existing 40 tokens).

*Additive. Nothing renders differently. Fully reversible by deletion.*

## Stage 2 — Fields on `.court-bg`, all five tabs

**`app/globals.css`**, in the background section (~783–1017), all scoped
`html[data-visual="field"]`:

- **Base / Home / `/design`** — `.court-bg { background: var(--field-home), var(--field-base); }`
  and hide the three aurora blobs. Un-attributed default, per Conflict 7.
- **Sign-Ups, Stats** — swap `background` only; leave `::before` alone (Conflict 6).
  Retune the dot grid alpha against the new Stats ground.
- **Profile, Admin** — two new blocks, same shape.
- **`--field-scrim`** — a `::after` on `.court-bg` so text at the top and bottom
  edges keeps contrast over the brightest part of the gradient. ⚠️ `.court-bg` has
  `contain: strict` and `z-index: -1`, and `::before` is already taken by the
  motif. Verify the stacking resolves as *ground → motif (`::before`) → scrim
  (`::after`)* before building on it; `contain: strict` establishes containment
  that can surprise here.
- Keep the existing `prefers-reduced-motion` / `prefers-reduced-transparency`
  blocks intact — `design-canary` asserts `.aurora-blob-1`, `.ring-spinner`,
  `.shimmer-line`, `.splash` and `will-change: auto !important` all still appear
  there, so **do not delete the aurora rules**, only stop showing them.

**`app/layout.tsx`** — stamp `data-visual` (see the flag mechanic above).

## Stage 3 — Put both tracks on the `/design` preview

- **`app/design/backgrounds/page.tsx`** + `backgrounds.module.css` — append
  variants `07`–`11` (Track A fields) and `12`–`16` (Track B), each with the
  existing `.glass-card` sample laid on top for legibility judgment, exactly as
  variants `01`–`06` already do. Note this page's CSS is **sandboxed** — it
  deliberately does not read the live rules, so mirror the values.
- **`app/design/components/page.tsx`** — add a field-card specimen showing all
  seven materials (base / pick / good / wait / full / error / locked) in both
  themes, plus the ink button.
- **`app/design/tokens/page.tsx`** — list the new token families.
- `__tests__/design-preview-route.test.ts` pins the `SUBPAGES` href order exactly
  — **don't add a sub-page**, extend the existing ones.

## Stage 4 — 🚦 Track decision gate

Run `/run-badminton-app`, open `/bpm/design/backgrounds` on a real phone, both
themes, and pick. Then **delete the losing token set** — do not ship both.

Concrete input for the call, from the audit: Track B spends four hues that are
load-bearing here — amber (`--pill-waitlist-*`, `--list-amber-*`), orange
(`--banner-orange-*`, session-full), blue (`--sev-low-text`, dates/info) and
violet (`--pill-admin-*`). **An orange "session full" banner on an orange Admin
field is invisible.** If Track B wins, the same PR must reassign those four
semantic roles to new hues.

## Stage 5 — 🚪 The new card material takes over `.glass-card`

**Not an in-place rewrite — a flag-scoped rule that shadows the old one.** The
original rule at globals.css:1100 stays until Stage 9. That is what keeps the
"flip the flag off" rollback in the Verification section honest; an in-place
redefinition would have no CSS-level off switch. The user-facing result is
identical (there is one card material at a time), and Stage 9 collapses the two.

It is still the one-way door in *product* terms: once it ships there is no
per-surface control — every `.glass-card` on every tab changes together.

**`app/globals.css`** — add after the existing rule. Class name unchanged, so all
124 call sites and every test in Conflict 4 keep passing:

```css
html[data-visual="field"] .glass-card {
  background: var(--fcard-bg);
  -webkit-backdrop-filter: var(--fcard-blur);
          backdrop-filter: var(--fcard-blur);
  border: none;
  border-radius: var(--radius-3xl);
  box-shadow: var(--fcard-inset), var(--fcard-shadow);
}
```

Keep the `--mx`/`--my` pointer-tracking radial from `GlassPhysics` layered above
`--fcard-bg` — it is the app's signature interaction and costs nothing.

⚠️ Because the old rule is still live, its `border: 1px solid var(--glass-border)`
and `border-radius: 16px` must be **explicitly overridden**, not assumed absent.
`border: none` and `border-radius: var(--radius-3xl)` above do exactly that — don't
drop either line thinking it's redundant.

⚠️ **Check `prefers-reduced-transparency` before writing this rule.** The block at
globals.css:899–907 handles the aurora; verify it also flattens `.glass-card`'s
`backdrop-filter`. The new material triples the fill and adds 6px of blur, so if
that block only hides blobs, the new material ships with **no reduced-transparency
path** — a one-line addition if missing, an accessibility regression if not.

Then reconcile the two rules that assume the old material:

- **`html[data-tab="skills"] .glass-card`** (1023–1098) — currently overrides
  background, `backdrop-filter` (blur 22 / saturate 220% / contrast 1.05 /
  hue-rotate 3°) and box-shadow because Stats sits on the dot grid. Either fold
  its four documented "levers" into `--fcard-*` for the Stats field, or delete it
  if the new material already reads correctly there. **Decide by looking, not by
  reasoning** — it was hand-tuned.
- **`.glass-card:hover`** — the 2px lift and `--glass-inset-hover` still apply;
  confirm the brighter inset still reads against the heavier fill.

## Stage 6 — Semantic card materials + the off-ladder radii

- Add `.glass-card.is-pick / .is-good / .is-wait / .is-full / .is-error /
  .is-locked` mapping to the six state tokens. `.is-locked` **must** drop
  `backdrop-filter` — the design is explicit that flatness is what makes private
  data read as inert, and it's the one material that isn't glass.
- Enforce the design's two composition rules in review (they are prose, not
  lintable): *at most one solid `.is-pick` per screen*, and *semantic cards stay
  rare — three at once means the screen has stopped communicating*.
- Apply the states at the obvious call sites: waitlist rows (`PlayersTab`),
  session-full banners (`HomeTab`), `ErrorState` surfaces, the Gear "our pick"
  card (`GearRegister`), locked/private cards (`StatsPrivacyScreen`,
  `WhereYouSitCard`'s off state).
- Resolve the off-ladder radii the audit found, as follows — these are
  instructions, not open questions:
  - `.btn-primary`, `.btn-ghost`, `.cc-btn-lg` (full-width CTAs, 14px) →
    `var(--radius-xl)` (16). They sit *on* cards and should share the card rung.
  - `.cc-tile` (compact stat tile, 14px) → `var(--radius-lg)` (12), matching the
    inner-row spec in CLAUDE.md ("inner rows + stat tiles: 12px radius + 12px padding").
  - `--rail-indicator-radius` (15px) → **keep**, and add a comment saying why: it's
    a sliding pill indicator sized to its own 30px track, not a rectangular
    surface, so the ladder doesn't apply. Documenting the exception is the point.

## Stage 7 — Sheets, nav, chrome

- **13 `BottomSheet` consumers** — the sheet surface inherits the field per design
  rule 1. Update `components/BottomSheet/` (⚠️ full-ESLint `error` directory) and
  the shared sheet CSS at globals.css:2133.
- **`.rail-bar` / `.nav-glass`** — `--rail-blur` and `--rail-indicator-radius: 15px`
  against the new material. `BottomNav.test.tsx` is flag-branched: rail mode must
  have **no** `.nav-glass` and must render `.rail-icon-wrap .material-icons.rail-icon`;
  legacy mode must render `.nav-glass`. **Satisfy both branches.**
- **`app/manifest.ts:28–29` + `app/layout.tsx:104`** — the three hardcoded
  `#100F0F` values (Conflict 9).
- **`components/admin/` — decided: the field ships, the `cc-*` card system does not.**
  Admin *does* migrate: it gets `--field-admin`, and its **26 `.glass-card` uses**
  (`AdminDashboard` 10, `BirdInventoryView` 8, `SetupPage` 4, `BirdsPage` 4) pick up
  the new material automatically. What stays put is the parallel `cc-*` system —
  `.admin-hero`, `.cc-tile`, `.cc-dcard`, `.cc-mini-card`, `.cc-session-chip`. Three
  reasons: it is a genuinely separate design language built for dense admin tables,
  not a `.glass-card` variant; it is ~4.7k lines and the largest single surface in
  the app; and `docs/plans/design-audit-remediation.md` already deferred item #6
  (the `btn-primary` → `cc-btn` sweep) on the finding that *"there is no safe
  mechanical transform"* here. Log it as a named follow-up —
  **"Admin `cc-*` on the field material"** — rather than folding it into this pass.
  If you want it in scope, it is its own plan, not a bullet in Stage 7.

## Stage 8 — Documentation (same PR as Stage 5, not after)

- **`DESIGN.md`** §4 (16px cap), §9 (two surface tiers), §14 (per-tab backgrounds)
  — amend to describe fields and the 30px field-card exception.
- **`CLAUDE.md`** — the "Corner radii ladder" bullet at line 63, the Design System
  section's background paragraph, and the per-tab-backgrounds gotcha.
- **`docs/design-system/README.md`** — fix the two stale claims (24px corners,
  system font stack) flagged in Conflict 10.
- **New `docs/plans/visual-fields-direction.md`** — this document, plus the Stage 4
  track decision and its reasoning.
- **`docs/design-system/colors_and_type.css`** — the pristine mirror. Update it,
  and keep the "never imported" comment in `app/design/layout.tsx:6` accurate.

## Stage 9 — Flag retirement

`NEXT_PUBLIC_FLAG_VISUAL_FIELDS` gets a real `plannedRemoval` **date** — note that
13 of the 14 existing flags carry prose instead, which is why they never retire.
Two weeks after it ships, delete the flag, the `data-visual` attribute, the
`html[data-visual="field"]` scoping on every rule, and the aurora blob rules and
their dead `--aurora-blob*` / `--aurora-opacity-*` tokens.

---

## Files touched

| File | Stages |
|---|---|
| `app/globals.css` | 1, 2, 5, 6, 7 — the bulk of the work |
| `app/layout.tsx` | 2 (`data-visual`), 7 (`themeColor`) |
| `app/manifest.ts` | 7 |
| `lib/flags.ts` · `package.json` · `.github/workflows/deploy-next.yml` | flag, 4 coordinated edits |
| `app/design/{backgrounds,components,tokens}/page.tsx` + `backgrounds.module.css` | 3 |
| `components/BottomSheet/**` | 7 ⚠️ full-ESLint `error` |
| `components/{stats,primitives,home}/**` | 6 ⚠️ ESLint `error` |
| `components/admin/**` | 7 |
| `__tests__/design-canary.test.ts` | 1 |
| `DESIGN.md` · `CLAUDE.md` · `docs/design-system/README.md` · `docs/design-system/colors_and_type.css` · `docs/plans/visual-fields-direction.md` | 8 |

## Reuse — do not rebuild these

- **`data-tab` per-tab CSS switching** — `components/HomeShell.tsx`, already wired.
- **The ground/motif split** — `.court-bg { background }` vs `::before`, globals.css:915–1003.
- **`--glass-shadow`** — already defined at the design's exact values; just apply it.
- **`--forest-800: #0a1f0e`** — the Stats field core, already a token.
- **`NEXT_PUBLIC_FLAG_NAV_RAIL`** — the purely-presentational flag precedent.
- **`/design/backgrounds`** — the six-variant comparison page already exists.
- **`components/primitives/*`** — `CardHeader`, `StatusBadge`, `ListRow`,
  `EmptyState`, `ErrorState`, `CardSkeleton`. They bake in the spec; don't fork them.

---

## Verification

**Per stage, non-negotiable** — a per-task review scoped to its own diff cannot see
cross-file breakage, and this has bitten this repo twice:

```bash
npm test          # baseline 1762 tests / 194 suites — a DROP means files failed to load
npm run lint      # baseline 0 errors / ~371 warnings; a new ERROR is unambiguous
npx tsc --noEmit  # vitest's surface is narrower than next build
```

**Visual, after Stages 3, 5 and 7** — run the `/run-badminton-app` skill (offline
mock store; it encodes the `NEXT_PUBLIC_BASE_PATH=/bpm` trap), then on a real phone:

1. `/bpm/design/backgrounds` — all fields, **both themes**. This is Stage 4's gate.
2. Walk all five tabs in both themes. Watch specifically for the first-paint flash
   (Conflict 7) and for the Sign-Ups court SVG / Stats dot grid still reading
   through their fields (Conflict 6).
3. Open a `BottomSheet` on each tab — confirm it inherits the field.
4. Check contrast where the field is brightest (top-right, `at 78% 4%`) —
   `--text-muted` at `.55` was already a documented AA fix at `.35`, so the
   brightest corner of a field is exactly where it will fail again.
5. System Settings → Reduce Motion **and** Reduce Transparency — confirm both
   still degrade.
6. iOS PWA: status bar colour against the field (Conflict 9).

**Specific regressions to watch**

| Check | Why |
|---|---|
| `design-canary` still green | pins `--radius-xl: 16px`, four `--fs-*` values, `.glass-card`, `.glass-card-soft`, `.field-error`, `.cc-btn` |
| `glass-card-nesting` still green | scans `components/` only — an `app/` regression is invisible to it |
| `dev-next-flag-parity` still green | set equality in **both** directions, literal `=true` |
| `icon-subset` still green | any new Material glyph needs `app/layout.tsx`'s `icon_names=` updated — **and the list must stay alphabetically sorted or the whole font request 404s** |
| `BottomNav.test.tsx` both branches | rail *and* legacy `.nav-glass` |

**Rollback.** Stages 1–4: delete the tokens. Stages 5+: set
`NEXT_PUBLIC_FLAG_VISUAL_FIELDS` to anything but `'true'` in the Azure App Settings
for `vnext-badminton-app` and redeploy — no code revert needed. Beyond that,
`gh workflow run deploy-next.yml --ref <sha>`.

---

## Two things a reader should not lose

1. **The material is decided in dark mode.** Light mode's fill barely moves —
   but its edge treatment changes completely (border removed, inset nearly
   doubled), so it still needs looking at. Anyone judging the *fill* in light mode
   will wonder what the fuss was.
2. **Stage 5 is the one-way door in product terms, not in code terms.** The new
   rule shadows the old one under `html[data-visual="field"]`, so CSS-level
   rollback stays free until Stage 9 collapses them. What is irreversible is the
   product decision: every `.glass-card` on every tab changes together, with no
   per-surface control. Stage 4 exists to be a real gate in front of that — don't
   collapse it into Stage 5 to save a round-trip.
