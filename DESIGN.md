# Design Principles — Badminton Sign-Up App

All CSS classes, tokens, and component styles live in `app/globals.css` and the component source files. This document captures the design intent — not the implementation details.

> **Formalized spec.** The canonical, reusable token bundle lives in [`docs/design-system/`](docs/design-system/) and can be previewed live at `/bpm/design` (flag-gated). The bundle was extracted from this codebase and codifies the rules below into importable CSS variables and utility classes (`.bpm-h1`, `.bpm-section-label`, etc.).

1. **Mobile-first, single-column layout.** All tab content renders in a single scrollable column. `max-w-lg` centers content on wider screens while remaining full-bleed on mobile.

2. **Bottom navigation for thumb reach.** The nav is pinned to the bottom of the viewport so primary actions are reachable with a thumb.

3. **High-contrast green on dark for accessibility.** Court-green accent (`#4ade80`) against near-black background (`#100F0F`) provides strong luminance contrast. Light mode uses `#16a34a` on warm cream.

4. **Glass morphism, not flat.** Every card and surface uses `backdrop-filter: blur()` + translucent gradients rather than opaque fills, keeping the tab-specific backdrop (02 Aurora on most tabs, 03 Court on Sign-Ups) visible. Radii capped at **16px** on rectangular surfaces per the corner-radii ladder.

5. **Minimal chrome, content-forward.** Generous padding and border-radius. Section labels use `tracking-widest` all-caps micro-text to separate content areas without hard dividers.

6. **Semantic icon usage.** **Material Symbols Rounded** (subsetted webfont, ~43 glyphs) carry meaning alongside text and are colored contextually — green for success, red for errors, amber for waitlist, blue for dates, purple for admin. The brand `<ShuttleIcon />` replaces `sports_tennis` anywhere the UI references the sport itself (empty states, loaders, brand chrome). Call-sites use `.material-icons` class for backwards compat — the class is aliased to the new font.

7. **Consistent state feedback.** Every async operation disables buttons and shows inline text feedback. Errors surface as `text-red-400 text-xs` immediately below the relevant input.

8. **Theme-aware.** Dark and light modes via `data-theme` attribute on `<html>`. CSS custom properties in `globals.css` drive all color values. Prefer existing Tailwind classes with light-mode overrides over new inline colors.

9. **Materials simplify inward.** The outermost container provides the heaviest material (glass card with blur, border, inset highlight). Nested elements — inputs, list rows, secondary groupings — use progressively lighter materials. Inputs inside a `.glass-card` automatically flatten to transparent + subtle border so they don't read as "cards inside a card". This is enforced in `globals.css` via the `.glass-card input, .glass-card select, .glass-card textarea` descendant selector. Focus state reinstates the full material to signal interactivity.

10. **One-handed thumb zone.** Primary actions live at the bottom of their surface, not the top. HomeTab order is info-above-action (BPM/Date tile → Announcement → Sign-up card). Admin "Add Player / Add Purchase / Add Alias" forms sit below their respective lists. The BottomNav is pinned to the viewport bottom so tab switching is always in reach. Visual hierarchy and ergonomic hierarchy are not the same thing — on mobile, ergonomic wins.

11. **Body text under section titles.** Cards that do multiple things get a short body string under the title explaining what the card is for — e.g., "Venue, capacity, and sign-up controls" under "Session Details", "How much each player pays per session" under "Cost Details". Four to six words, no verbosity. The goal is to make the card's purpose legible at a glance without forcing the user to read every field to figure out what they're looking at.

12. **Inline list rows, no nested cards.** Lists of editable items (bird sources, players, aliases) use inline rows separated by 1px opacity dividers (`var(--glass-border)`), not nested `inner-card` wrappers. Card-in-card is visual noise; row-in-card is clean.

13. **Modal sheets cover the nav.** Bottom sheets must use `zIndex: 60` (inline style, not Tailwind class — JIT-independent) so they sit above `BottomNav` (`z-50`). The backdrop at `zIndex: 55` covers the nav too, so it visually dims and blurs along with the rest of the page. Sheet `maxHeight` is ~72vh so there's clear breathing room at the top that reads as "action sheet" rather than "full-screen modal". Drag zones use `touchAction: 'none'` to prevent the body scroll / pull-to-refresh fight that React's passive touch listeners can't stop via `preventDefault()`.

14. **Per-tab backgrounds.** `.court-bg` (rendered once in root layout) adapts to `html[data-tab=...]` — active tab is mirrored onto `<html>` by a `useEffect` in `app/page.tsx`. Default tabs get **02 Aurora** (3 breathing blobs, transform-only animation, no filter/blend-mode). **Sign-Ups gets 03 Court** — real badminton doubles proportions (13.40m × 6.10m → 100:220 viewBox), aspect-locked via `aspect-ratio: 100/220` + `background-size: contain` so it never stretches. Adding a new per-tab variant = one CSS block, no component changes.

15. **Type trio.** **Space Grotesk** for display (h1/h2/h3, wordmark, splash). **IBM Plex Sans** for body/UI (every non-headline `<body>` surface). **JetBrains Mono** for data moments (PINs, costs, timestamps, code). Self-hosted variable TTFs via `next/font/local` in `app/fonts/` — first paint never waits on Google Fonts.

16. **Tempo-dot brand mark.** The `<BpmWordmark />` component renders `bpm.` with four green tempo dots crescendoing into the period. Used as a standalone brand mark only — **never inline with other words** (the dots read as ellipsis between words instead of the period completing the mark). Headers use plain "BPM Badminton" text in Space Grotesk.
