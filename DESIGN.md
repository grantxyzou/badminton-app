# Design Principles — Badminton Sign-Up App

All CSS classes, tokens, and component styles live in `app/globals.css` and the component source files. This document captures the design intent — not the implementation details.

1. **Mobile-first, single-column layout.** All tab content renders in a single scrollable column. `max-w-lg` centers content on wider screens while remaining full-bleed on mobile.

2. **Bottom navigation for thumb reach.** The nav is pinned to the bottom of the viewport so primary actions are reachable with a thumb.

3. **High-contrast green on dark for accessibility.** Court-green accent (`#4ade80`) against near-black background (`#100F0F`) provides strong luminance contrast. Light mode uses `#16a34a` on warm cream.

4. **Glass morphism, not flat.** Every card and surface uses `backdrop-filter: blur()` + translucent gradients rather than opaque fills, keeping the animated aurora background visible.

5. **Minimal chrome, content-forward.** Generous padding and border-radius. Section labels use `tracking-widest` all-caps micro-text to separate content areas without hard dividers.

6. **Semantic icon usage.** Material Icons carry meaning alongside text and are colored contextually — green for success, red for errors, blue for dates, purple for courts.

7. **Consistent state feedback.** Every async operation disables buttons and shows inline text feedback. Errors surface as `text-red-400 text-xs` immediately below the relevant input.

8. **Theme-aware.** Dark and light modes via `data-theme` attribute on `<html>`. CSS custom properties in `globals.css` drive all color values. Prefer existing Tailwind classes with light-mode overrides over new inline colors.
