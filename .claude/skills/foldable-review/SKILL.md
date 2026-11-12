---
name: foldable-review
description: Review or build a screen for foldable phones — iPhone Duo, Galaxy Z Fold — against Apple's "Designing for iPhone Duo" guidance and this repo's own foldable rules, then LOOK at it at the real foldable sizes with the fold injected. Use this whenever a change touches Home, the tab bar, a sheet, a toast, the courtside scoreboard, anything positioned with `fixed`, or any new card or banner — even when nobody says "foldable": a card that spans the fold is the bug this skill exists to catch, and jsdom cannot see it. Also use it when asked whether something "works on the Duo / Fold / a tablet", to fact-check a layout claim with measurements, to add two-pane behaviour to a new tab, or to PROPOSE foldable design patterns for a screen (its "Propose" mode: candidates grounded in Apple's rules and the repo's decisions, each shown as a screenshot at the real sizes, never as prose alone).
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
| `fold-laptop-offcentre` | 823 × 651 | horizontal, 0 px at y 297 | Z Fold 6 laptop pose under Chrome's toolbar: the crease is OFF the viewport's centre (325), so this is the one preset that tells hinge-tracking from the centre fallback |
| `fold-posture-only` | 823 × 707 | posture only, no segments | Older Chrome / Samsung Internet: "folded" with no segments, so `lib/fold.ts` picks the axis from orientation — and laptop pose is landscape, so the board splits SIDE BY SIDE with the crease through both halves (known gap, 2026-11-04) |
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

## Propose patterns for a screen

Reviewing checks a screen against the rules; proposing starts from the rules
and asks what the screen could DO with two pages. The failure mode is prose:
a list of plausible layouts nobody has seen at the real sizes, one of which
quietly undoes a recorded decision. So a proposal is a picture with numbers,
or it is not a proposal yet.

1. **Start from what exists.** Shoot the screen as it is today at `phone`,
   `duo-landscape`, `fold-inner` and `fold-laptop` (`--tab <tab>`; for Stats
   add `--register`). Measure what sits where. On every tab but Home that is
   one 512 px column inside wider padding — a decision, not a gap (next
   section) — so the question is what the second page would EARN.
2. **Generate candidates from the three sources, in this order.**
   Apple's patterns first (`references/apple-iphone-duo-hig.md`): two even
   columns, primary content on the page that opens, vertical controls in
   landscape, a sheet in one pane, "small adjustments over rearrangement".
   Then the repo's own shapes: Home's week-right stack, the scoreboard's split
   on the fold, sheets and toasts in the LEFT half. Then the screen's own
   data: which card is the thing the person came for (that goes RIGHT),
   which cards are context (LEFT), which pair is a before/after or a
   list/detail that a hinge naturally separates. Three to five candidates is
   plenty; name each in a few words.
3. **Rule every candidate out or in before drawing it.** Each must keep every
   rule above: nothing crosses the fold, one screen untouched, sheets left,
   no gap off centre. A candidate that breaks one is listed under "ruled out"
   with the rule's number, not quietly dropped — the owner should see what
   was considered.
4. **Draw the survivors, don't describe them.** Mock each one in the browser
   with injected CSS (a `<style>` added through `page.addStyleTag`, scoped to
   the tab's own classes and the pane media query) — no source edit, no
   commit — and shoot it at `duo-landscape`, `fold-inner` and `fold-laptop`
   with the same script. Measure the panes and anything that moved. Then
   shoot `phone` with the same injected CSS to show it changed nothing.
5. **Report pictures side by side**, one row per candidate: the three
   screenshots, the numbers, what it buys, what it costs, and which rule or
   decision it leans on. End with ONE recommendation and the question the
   owner has to answer to pick it (usually "which card is the page that
   opens?"). Don't build it; building is a separate change with its own
   review and the canary extended.

```
## Foldable proposals — <screen>
Today: <what it does now at the four sizes, with widths>
Ruled out: <candidate — rule N>
Candidates:
  1. <name> — <shots> — <numbers> — buys / costs — leans on <rule or decision>
  2. …
Recommend: <one>, because <one line>. Ask Grant: <the question>.
```

## Add two-pane behaviour to another tab

Home, Stats and Stringing are the two-pane tabs (Stats since 2026-11-12: the
overview left, the switch and the register right, `.stats-shell*`; Stringing
the same day: list-detail, the register left and what a tap opens on the right,
open by default, through a portal slot — `StringingAside` — because what
renders changes, not only where), and that was a decision per tab, not a gap:
Profile keeps its 512 px column inside the wider padding. When a foldable must
render something DIFFERENT (a detail beside its list instead of in place of
it), read `usePaneMode()` from `lib/paneMode.ts`; one screen must get `false`
and its old path. If another tab earns panes, follow the same shape — a
grid with the primary group on the right spanning its rows down to a last `1fr`
row, everything else on the left, the gap `var(--fold-gap)` — inside the SAME
media block, put the class on the tab's loading frame too, and extend the
canary. Never a new query with different thresholds: two definitions of "a
foldable" is how the next bug gets in. Never place ONE card of a group in the
other column with CSS: the two columns' rows tie together and open gaps; that
is a component change.

## Don't

- Don't detect the fold to position the panes. The centre IS the fold.
- Don't move the gap off centre to buy width. See rule 7.
- Don't let a sheet or toast open in the right half; it covers the week.
- Don't read `innerWidth` to decide "is this a foldable" in JS; the CSS query
  is the one definition and `lib/paneMode.ts` reuses its string.
- Don't claim the native plugin works: `BpmFoldPlugin.swift` compiles only
  with Xcode 27.1+ and has not been built here. The simulator read on a Mac
  is the test.
