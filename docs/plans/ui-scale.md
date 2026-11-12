# Cards scale with the phone's text size and the screen

**Track:** the Apple guideline pass (#906, #909, #911, #913): accessibility, Apple's Dynamic Type.
**Status:** in-flight
**Review on:** 2026-12-12 — on a real iPhone at Larger Text (xxxL) and an Android phone at its largest font, does every member screen still read and fit, with nothing clipped?

## Problem

The accessibility checker (axe-core) flags one thing on every screen: pinch-to-zoom
is off (`maximumScale: 1`, `userScalable: false` in `app/layout.tsx`, a recorded
product decision — accidental zoom in the home-screen app felt broken). Asked whether
to turn zoom back on, Grant (2026-11-12): **"no zoom, card should scale"**, and asked
which should drive it, **"Both"** — the phone's text size AND the screen size.

So a member who sets larger text on their phone gets a larger app, laid out as cards
that grow as a whole (text, padding, buttons together), with no pinch. Before this,
nothing in the app followed the phone's text size on iPhone: every size is a fixed
pixel token (`--fs-*`, `--space-*`, `--radius-*`, `--icon-*` in `app/globals.css`).

## Kill criterion

- At the phone's DEFAULT text size on a phone-width screen, any pixel changes on
  any screen (the scale must be exactly 1 there; checked by before/after shots).
- At Larger Text, a member screen clips text, overflows sideways, or crosses the
  fold on a foldable. Then the cap comes down, or the screen gets its own fix.

## Non-goals

- Turning pinch-to-zoom back on (Grant: no).
- Shrinking below the designed sizes when the phone is set SMALLER than default
  (the app's smallest text is already 10 px).
- Admin screens' hand-typed inline sizes (English-only, three admins); they scale
  where they use tokens or Tailwind and stay put where they type a number.

## Decisions

- **The root font size carries one factor, `--ui-scale`**, and the design tokens are
  in `rem`, so everything sized by a token or a Tailwind class grows together — a
  card, not just its text. Written `calc(12rem / 16)` so the designed pixel value is
  still readable and the canaries read it back as `12px`. CSS `zoom` was the other
  way to scale a card whole, and lost: zoomed viewport units overflow the screen
  (`88dvh` sheets), and zoom puts `getBoundingClientRect` and style lengths in
  different units, which the fold, the sheets and the pull-to-refresh all read.
- **Not scaled on purpose**: the optical hairlines (`--space-hair`, `--space-05`),
  the pill radius, 1 px borders and the 44 pt tap areas (a minimum, already met).
- **The factor is `text × screen`**, set by the pre-paint script in `app/layout.tsx`
  (beside `--launch-k`) and again on resize and on returning to the app:
  - **text**: iPhone and iPad publish Dynamic Type through the `-apple-system-body`
    font (17 px at the default size); the script measures it and divides by 17,
    clamped to 1–1.5 (the default to Larger Text's xxxL is 1–1.35; the accessibility
    sizes past that stop at 1.5 so a card still fits a phone). Elsewhere it is 1: an
    Android browser or WebView already applies the system font size to every font
    size, the root's included, so the rem tokens follow it with nothing added.
  - **screen**: 1 up to a 480 px page, rising to 1.12 at a 768 px page, measured per
    PAGE on a two-page foldable — so every phone and a foldable's pages (Z Fold 442,
    Duo 475) stay 1, and a tablet or a desktop grows a little. 430 (the widest
    phone) was the first cut, and grew the Z Fold's pages by 0.4%.
- `html { font-size: calc(100% * var(--ui-scale, 1)) }`: the 100% keeps a browser's
  own default text size setting working too.

## Shape

| Piece | Where |
|---|---|
| The factor | `app/layout.tsx` pre-paint script (`--ui-scale`) |
| Root size and the rem tokens | `app/globals.css` (`html` rule, the token ladders) |
| The rule, as code | `lib/uiScale.ts` (and `lib/paneQuery.ts`, the two-page query, so the server layout can read it) |
| Canaries | `__tests__/ui-scale.test.ts` (the factor, the script, the rem ladders, the px font-sizes kept on purpose, zoom off); `spacing-canary` and `design-canary` read `calc(Nrem / 16)` as N px; `touch-feel-canary` holds fields at `max(16px, 1rem)` |
| Swept onto rem | `.cc-btn-lg`, the `.icon-*` classes and `.icon-pin` / `-pin-lg` / `-status` / `-spin-lg`, `.cc-checkbox`, `MemberAvatar`, and the three sheets' success line (now `.sheet-success-line`) |

## Measured (2026-11-12, mock store)

- **Default text size, iPhone 13 width**: Welcome, Home, Stringing, Stats and Profile match the build before this change pixel for pixel (full-page shots, before taken from `git stash` on the same seeded data).
- **The factor**: 1 on a phone, an open Z Fold (884 → pages of 442) and the Duo sideways; 1.046 on an iPad landscape (two pages of 590); 1.12 on a 1280 px desktop.
- **At ×1.35 (Larger Text xxxL)**: no sideways overflow on any tab; on an open Z Fold no card crosses the fold. A text probe found only the tab bar, the header toggles, `.cc-btn-lg` and the avatar not growing; the last two were then swept. Home's address line clamps to two lines and ends in "…" at that size — kept.
- **Not yet seen**: a real iPhone at Larger Text, and an Android phone at its largest font (the Review on line).
