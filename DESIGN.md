# Design Principles — Badminton Sign-Up App

All CSS classes, tokens, and component styles live in `app/globals.css` and the component source files. This document captures the design intent — not the implementation details.

> **Formalized spec.** The canonical, reusable token bundle lives in [`docs/design-system/`](docs/design-system/) and can be previewed live at `/bpm/design` (flag-gated). The bundle was extracted from this codebase and codifies the rules below into importable CSS variables and utility classes (`.bpm-h1`, `.bpm-section-label`, etc.).

1. **Mobile-first, single-column layout.** All tab content renders in a single scrollable column. `max-w-lg` centers content on wider screens while remaining full-bleed on mobile.

2. **Bottom navigation for thumb reach.** The nav is pinned to the bottom of the viewport so primary actions are reachable with a thumb.

3. **High-contrast green on dark for accessibility.** Court-green accent (`#4ade80`) against near-black background (`#100F0F`) provides strong luminance contrast. Light mode uses `#16a34a` on warm cream. Green remains the *accent*; since the fields landed (#14) it is no longer the only hue in the system, and the cost of that is written down in `globals.css` under **Semantic hues displaced by the fields**.

4. **Glass morphism, not flat.** Every card and surface uses `backdrop-filter: blur()` + translucent gradients rather than opaque fills, keeping the tab-specific backdrop (02 Aurora on most tabs, 03 Court on Sign-Ups) visible. Radii capped at **16px** on rectangular surfaces per the corner-radii ladder — with exactly one exception: **field cards** use `--radius-3xl` (30px). The exception is scoped, not a new cap. Flat-field surfaces still stop at 16, and nothing may hardcode `border-radius: 30px`; it must go through the token, which `__tests__/design-canary.test.ts` enforces (the ESLint radius rule only catches raw numbers in JSX and does not read CSS at all).

   This reverses the earlier position that 24px was "a self-inflicted spec violation". That judgement was right at the time: 24px was drift, arrived at by nobody in particular. 30px here is a decision with a reason — it is the radius the field-card material was designed at, and it applies only to cards sitting on a field.

5. **Minimal chrome, content-forward.** Generous padding and border-radius. Section labels use `tracking-widest` all-caps micro-text to separate content areas without hard dividers.

6. **Semantic icon usage.** **Material Symbols Rounded** (subsetted webfont, ~43 glyphs) carry meaning alongside text and are colored contextually — green for success, red for errors, amber for waitlist, blue for dates, purple for admin. The brand `<ShuttleIcon />` replaces `sports_tennis` anywhere the UI references the sport itself (empty states, loaders, brand chrome). Call-sites use `.material-icons` class for backwards compat — the class is aliased to the new font.

7. **Consistent state feedback.** Every async operation disables buttons and shows inline text feedback. Errors surface via the `.field-error` class (`role="alert"`, `--sev-crit-text`, `--fs-sm`) immediately below the relevant input — the single, theme-aware home for the inline error message (replaces hand-written `text-red-400 text-xs`).

8. **Theme-aware.** Dark and light modes via `data-theme` attribute on `<html>`. CSS custom properties in `globals.css` drive all color values. Prefer existing Tailwind classes with light-mode overrides over new inline colors.

9. **Materials simplify inward — two surface tiers.** The outermost container is **Tier 1: `.glass-card`** — full material (backdrop blur, saturate 180%, 1px rim, layered shadow, inset highlight, radius 16). Nested groupings inside it are **Tier 2: `.glass-card-soft`** (alias `.inner-card` for backcompat) — flat tint + 1px border at radius 12, no backdrop-filter, no shadow, no rim. Tier 2 lives only inside Tier 1; nesting beyond Tier 2 is out-of-system — use inline rows per principle #12 instead. Inputs inside a `.glass-card` flatten further still to transparent + border, enforced in `globals.css` via the `.glass-card input, .glass-card select, .glass-card textarea` descendant selector; focus reinstates the full material to signal interactivity.

   **The fields did not add a third tier.** `.glass-card` is still Tier 1; on a field it is the *same tier wearing a different material* — heavier frost, no border, 30px, and the semantic variants `.is-pick / .is-good / .is-wait / .is-full / .is-error / .is-locked`. The class name is unchanged on purpose, so all ~124 call sites and the tests that use `.glass-card` as a render check keep working. Two composition rules ride with it that CSS cannot enforce: **at most one `.is-pick` per screen**, and **semantic fills stay rare** — three at once means the screen has stopped communicating. `.is-locked` is the one material that is not glass: it drops `backdrop-filter` entirely, which is what makes private data read as inert rather than merely dim.

10. **One-handed thumb zone.** Primary actions live at the bottom of their surface, not the top. HomeTab order is info-above-action (BPM/Date tile → Announcement → Sign-up card). Admin "Add Player / Add Purchase / Add Alias" forms sit below their respective lists. The BottomNav is pinned to the viewport bottom so tab switching is always in reach. Visual hierarchy and ergonomic hierarchy are not the same thing — on mobile, ergonomic wins.

11. **Body text under section titles.** Cards that do multiple things get a short body string under the title explaining what the card is for — e.g., "Venue, capacity, and sign-up controls" under "Session Details", "How much each player pays per session" under "Cost Details". Four to six words, no verbosity. The goal is to make the card's purpose legible at a glance without forcing the user to read every field to figure out what they're looking at.

12. **Inline list rows, no nested cards.** Lists of editable items (bird sources, players, aliases) use inline rows separated by 1px opacity dividers (`var(--glass-border)`), not nested `inner-card` wrappers. Card-in-card is visual noise; row-in-card is clean.

13. **Modal sheets cover the nav.** Bottom sheets must use `zIndex: 60` (inline style, not Tailwind class — JIT-independent) so they sit above `BottomNav` (`z-50`). The backdrop at `zIndex: 55` covers the nav too, so it visually dims and blurs along with the rest of the page. Sheet `maxHeight` is ~72vh so there's clear breathing room at the top that reads as "action sheet" rather than "full-screen modal". Drag zones use `touchAction: 'none'` to prevent the body scroll / pull-to-refresh fight that React's passive touch listeners can't stop via `preventDefault()`.

14. **Per-tab backgrounds.** `.court-bg` (rendered once in root layout) adapts to `html[data-tab=...]` — active tab is mirrored onto `<html>` by a `useEffect` in `app/page.tsx`. Default tabs get **02 Aurora** (3 breathing blobs, transform-only animation, no filter/blend-mode). **Sign-Ups gets 03 Court** — real badminton doubles proportions (13.40m × 6.10m → 100:220 viewBox), aspect-locked via `aspect-ratio: 100/220` + `background-size: contain` so it never stretches. Adding a new per-tab variant = one CSS block, no component changes.

    **Fields** (2026-08-26, behind `NEXT_PUBLIC_FLAG_VISUAL_FIELDS`) extend this rather than replace it. Each tab gets a coloured radial-gradient ground — Home green, Sign-Ups amber, Stats blue, Profile violet, Admin orange — and sheets inherit their tab's field, since a sheet opening as a flat slab over a coloured page reads as a different app. Two things make it work:

    - **Ground and motif stay separate.** The field is on `.court-bg { background }`; the Sign-Ups court etching and the Stats dot grid stay on `::before`. So a field slots *under* a motif and the two tabs with a hard-won identity keep it.
    - **The flag is read on the server** and stamped as `html[data-visual="field"]` in `app/layout.tsx`, not in a `useEffect` like `data-tab`. The field is the page's ground colour, so resolving it after hydration would flash on the LCP frame. Home is deliberately the *un-attributed* default, which is also what gives `/design/*` a correct ground.

    One hue per tab was chosen over one hue at five depths. It buys five tabs you can tell apart and it costs four hues that meant something else — see `globals.css`, **Semantic hues displaced by the fields**, where the two that collide on their own tab are re-pitched with the arithmetic shown.

15. **Type trio.** **Space Grotesk** for display (h1/h2/h3, wordmark, splash). **IBM Plex Sans** for body/UI (every non-headline `<body>` surface). **JetBrains Mono** for data moments (PINs, costs, timestamps, code). Self-hosted variable TTFs via `next/font/local` in `app/fonts/` — first paint never waits on Google Fonts.

16. **Tempo-dot brand mark.** The `<BpmWordmark />` component renders `bpm.` with four green tempo dots crescendoing into the period. Used as a standalone brand mark only — **never inline with other words** (the dots read as ellipsis between words instead of the period completing the mark). Headers use plain "BPM Badminton" text in Space Grotesk.
