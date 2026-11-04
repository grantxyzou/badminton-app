---
name: foldable-review
description: Review or build a screen for foldable phones — iPhone Duo, Galaxy Z Fold — against Apple's "Designing for iPhone Duo" guidance and this repo's own foldable rules, then LOOK at it at the real foldable sizes with the fold injected. Use this whenever a change touches Home, the tab bar, a sheet, a toast, the courtside scoreboard, anything positioned with `fixed`, or any new card or banner — even when nobody says "foldable": a card that spans the fold is the bug this skill exists to catch, and jsdom cannot see it. Also use it when asked whether something "works on the Duo / Fold / a tablet", to fact-check a layout claim with measurements, or to add two-pane behaviour to a new tab.
disable-model-invocation: false
---

# Foldable review

Check a screen the way Apple asks for the iPhone Duo, and the way this repo
decided to do it, then look at it on the sizes those phones report. The rules
are short; the looking is what finds the bugs.

## Why this exists

A foldable has a hinge down (or across) the middle of its inner screen. Apple's
guidance (`references/apple-iphone-duo-hig.md`, from
https://developer.apple.com/design/human-interface-guidelines/designing-for-iphone-duo,
published 2026-09-09) reduces to one sentence for a web app: **design for two
widths, keep every control out of the fold, and move as little as possible
when the phone folds.** Standard iOS components do this for Apple's apps
automatically; ours are drawn by a web page, so nothing moves unless we move
it.

This repo's answer is in `docs/plans/foldable-layout.md` and the
"Foldables get two panes" bullet of `CLAUDE.md`. Read those two before
touching the layout: the decisions below were argued once and the plan says
why. Don't restate them here, and don't relitigate them in a review unless
the owner asks.

## The rules, in checking order

1. **One screen is untouched.** Every foldable rule lives inside the LAST two
   `@media` blocks of `app/globals.css` (a touch screen ≥ 720 × 480, or two
   viewport segments; the side tab bar adds `landscape`). Nothing outside
   them may change a phone. `__tests__/foldable-layout-canary.test.ts` pins
   this; a before/after screenshot at 430 × 932 pins it harder (see
   "Prove a single screen is unchanged").
2. **Nothing crosses the fold — never a banner.** The gap between the two
   panes sits in the exact centre of the screen because that is where every
   hinge is, so the fold needs no detecting. Only the page background and a
   BOTTOM tab bar run across (its middle is the gap between tabs 2 and 3). A
   new card, nudge, toast or sheet goes in ONE pane. `grid-column: 1 / -1`
   inside the pane block is the regression; the canary refuses it.
3. **The week is the right-hand page.** Grant reads an open foldable as a
   book: the right page is the one that opens, so this week's session sits
   right and the nudges and balance sit left. Apple's Mail example has the
   primary list on the left; that is a convention, not a rule, and the
   owner's reading of his own phone won. Sheets and toasts open in the LEFT
   half as a consequence — raised from the week, they must not cover it.
4. **Side tab bar only when wide AND landscape.** Apple's "vertical
   controls": on the inner screen held sideways the tab bar runs down the
   right edge, tabs at the bottom of the strip, the three round buttons
   (theme, language, Notifications bell) stacked at its top; the page padding
   grows on BOTH sides so the gap stays on the hinge. Held upright it stays
   at the bottom. The Duo's OUTER screen also gets side bars in Apple's apps,
   but a web page cannot tell it (382 × ~600) from an iPhone SE, so we don't
   try — that waits on the native `BpmFold` plugin reporting the display.
5. **Where the fold IS comes from `lib/fold.ts`, and unknown is not flat.**
   Three sources in order: the store app's `BpmFold` plugin, the web Device
   Posture + Viewport Segments APIs, nothing. A source that cannot say leaves
   `posture: null`, and `splitForFold` takes the viewport's centre. Only the
   courtside scoreboard reads it today. Don't add a fourth reader of the
   browser APIs; add a consumer of `useFold()`.
6. **Motion is the system's recipes.** A reflow on fold/unfold CROSSFADES
   (`lib/paneMode.ts`, `data-pane-flip`), the scoreboard's split TRANSITIONS
   its grid tracks, things arriving FADE (`.motion-fade`), and only a
   consequential moment takes `.status-celebrate`. Reduced motion keeps the
   fades. Apple: "favor small adjustments over rearrangement".
7. **Both panes are equal and narrow on the Duo sideways (356 px each).**
   That is a known cost of keeping the gap on the hinge beside an 80 px side
   bar, recorded in the plan. A date wrapping there is expected; reclaiming
   the mirrored padding would only widen the secondary page, and an off-centre
   gap would leave the fold. Say so instead of "fixing" it.

## Review a change

Work through the rules above against the diff, then LOOK (next section).
Report in this shape, and keep it short — the owner reads on a phone:

```
## Foldable review — <screen or change>
Measured: <device: pane widths / what sits where>
Rules: <which hold, which break, one line each>
Seen: <what the screenshots show, including anything that wraps or clips>
Verdict: <fine / fix X / ask Grant about Y>
```

Numbers over adjectives. "Both panes 356 px, the date wraps to two lines" is
a finding; "the left looks narrow" is a guess. When the owner makes a layout
claim, measure before agreeing — the first pass through this work agreed that
"the left is too narrow" and the panes were equal.

## Look at it

The suite cannot see layout (jsdom applies no stylesheet), so a screenshot at
the real sizes is the verification, not a nicety. Boot the mock app the way
`.claude/skills/verify-ui/SKILL.md` says (`PORT=3100 npm run dev:next:mock`,
wait for `Ready`), then run the bundled script:

```bash
node .claude/skills/foldable-review/scripts/fold-shots.mjs --out /tmp/fold --as Lin:2468
```

It signs in, walks the presets below, injects a FOLD on the folded presets
(the web posture and segments APIs, which is what Chrome on a Z Fold and
Safari 27.1 behind its flag report), screenshots each, and prints the
measurements that matter: pane edges, the tab bar, the open sheet, and the
scoreboard's split. `--tab stats --open keep-score` lands on the scoreboard;
`--sizes duo-landscape,fold-inner` narrows the run; `--help` lists the rest.

| Preset | Viewport | Fold injected | What it stands for |
|---|---|---|---|
| `phone` | 430 × 932 | no | an iPhone; must be untouched |
| `duo-outer` | 382 × 618 | no | iPhone Duo closed (Safari 27.1's figure) |
| `duo-portrait` | 669 × 902 | horizontal | Duo open, held upright: one column, fold across |
| `duo-landscape` | 951 × 620 | vertical | Duo open, sideways: two panes, side tab bar |
| `duo-book` | 951 × 620 | vertical, 31 px | Duo half-open like a book (scoreboard: board left) |
| `fold-cover` | 412 × 915 | no | Galaxy Z Fold closed |
| `fold-inner` | 884 × 1000 | vertical | Z Fold open: two panes, bottom tab bar |
| `fold-laptop` | 884 × 1000 | horizontal, 24 px | Z Fold propped like a laptop (scoreboard: board above) |
| `tablet` | 1180 × 820 | no | a touch tablet sideways |
| `desktop` | 1280 × 800 | no | mouse, not touch: one column, must be untouched |

Then READ the screenshots. Things only eyes catch: a card straddling the
centre line, a sheet covering the week, the loading frame on the wrong side,
text wrapping that the measurement did not predict, the three round buttons
not stacked in the strip.

Three traps the script already dodges, worth knowing when you write your own:
sign-in is rate-limited 5/hour per (name, IP), so each browser context gets its
own `x-forwarded-for`; the mock server is shared between contexts, so a sign-up
in one run leaves "Cancel my spot" for the next; and a board that opens AFTER
the viewport is known must still receive its split — key the effect on `open`
(the first cut didn't, and jsdom could not tell).

## Prove a single screen is unchanged

Any foldable change must show zero pixels changed on a phone. Shoot the
`phone`, `duo-outer`, `duo-portrait` and `desktop` presets once on the
branch's BASE commit (`git stash`, or `git checkout <base> -- app/globals.css`,
then restore) and once on the change, then diff with Pillow:

```python
from PIL import Image, ImageChops
d = ImageChops.difference(Image.open(a).convert('RGB'), Image.open(b).convert('RGB'))
print(sum(1 for p in d.get_flattened_data() if max(p) > 16))   # expect 0
```

Compare against the branch's TRUE base, not the local `main`: a stale `main`
once showed 60k changed pixels that were somebody else's merged nudge.

## Add two-pane behaviour to another tab

Home is the only two-pane tab today, and that was a decision, not a gap: the
other tabs keep their 512 px column inside the wider padding. If a second tab
earns panes, follow Home's shape exactly — a stack with one `*-week`-style
primary group on the right, everything else on the left, three rows with the
last `1fr`, the gap `var(--fold-gap)` — inside the SAME media block, and extend
the canary. Never a new query with different thresholds: two definitions of
"a foldable" is how the next bug gets in.

## Don't

- Don't detect the fold to position the panes. The centre IS the fold.
- Don't move the gap off centre to buy width. See rule 7.
- Don't let a sheet or toast open in the right half; it covers the week.
- Don't read `innerWidth` to decide "is this a foldable" in JS; the CSS query
  is the one definition and `lib/paneMode.ts` reuses its string.
- Don't claim the native plugin works: `BpmFoldPlugin.swift` compiles only
  with Xcode 27.1+ and has not been built here. The simulator read on a Mac
  is the test.
