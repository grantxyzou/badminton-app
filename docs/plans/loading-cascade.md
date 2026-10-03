# Loading cascade

**Track:** design-system standardization program (PRODUCT.md → Design Principle #5, "the details are the product"); follow-on to `docs/plans/motion-pass.md`; requested directly by the owner on 2026-10-03
**Status:** in-flight
**Review on:** 2026-10-24 — did phases 2–5 (Home, Stats, Profile + Stringing, Admin) each land, or did the cascade stop at the primitive?

## Problem

Grant, 2026-10-03: "all of the loading states review them and update the loading and display order." Asked which "order" he meant, he chose **arrival choreography**: cards should arrive in a deliberate top-to-bottom order on skeletons that match the final layout, so nothing jumps.

No player has reported it. A read-only audit of every loading branch (HEAD `09478c9`) found:

- **Cards arrive in network order.** Independent fetches resolve whenever they like, and many cards render `null` until then, so they INSERT above or between cards already on screen. Worst cases: Stats → You (the trend skeleton lands above WhereYouSit's, then the greeting lands at the very top), Gear (a NextRacket skeleton lands mid-stack), Home's account group (three cards in arbitrary order).
- **Skeletons don't match.** Stringing, Stats and Profile show Home's `TabSkeleton` as their chunk fallback; Admin shows nothing at all. Home's own skeleton reserves an announcement slot that may not exist and renders the full-size header while the loaded page uses the compact one, so the title shrinks at reveal. `AdminTabSkeleton` uses a different header component and heights from the console it stands in for.
- **Loaders stack.** Cold start cuts from the splash with no fade. A deep link to Stats shows Home's skeleton, the Home-shaped chunk fallback, a blank frame, then card skeletons.
- **Some loading states lie** (the forbidden "lying empty state"): Stringing says "Coming soon" while (and if it fails) loading; Payments says "No active players yet" before players load; Announcements says "No announcements posted" while loading.
- **Reduced motion keeps the splash forever if hydration stalls**: the reduced-motion wildcard zeroes the splash's 5.4s failsafe animation.

## Kill criterion

This failed if, after phase 2, a cold load of Home on a phone still shows any card appearing ABOVE one already on screen, or if the reveal makes a warm tab switch feel slower (content that was already cached waits for a stagger). Checked by recording a cold and a warm load on device.

## Non-goals

- Changing what is fetched or when (no prefetching, no fetch reordering, no cache changes). Only how and in what order content is revealed.
- Keeping tabs mounted across switches. Remount-on-switch is the reason revisits show skeletons; changing it is a separate decision with memory costs.
- Rearranging which cards sit on which screen.

## Decisions

- **Ordered cascade over one gate per screen.** A per-screen gate is simpler but makes the slowest fetch hold the whole screen; the cascade reveals each card as soon as it AND everything above it are ready, so the top of the screen is never held up by the bottom.
- **Opacity only, 150ms, 40ms stagger capped at 4 slots.** Tab switches happen tens of times a day; motion has to be near-invisible at that frequency (`emil-design-eng`: frequency decides). Matches the motion-pass rule that content arriving into a surface already on screen does not rise.
- **Instant data skips the animation.** A slot whose data is ready within 100ms of the screen mounting renders without a fade, so a warm switch is not slowed by choreography.
- **An empty slot collapses through `<Collapse>`** rather than vanishing, because a skeleton that disappears in one frame is the same jump the cascade exists to remove.
- **The card stays MOUNTED behind its skeleton** (hidden), and reports readiness itself with `useRevealReady()`. The first cut rendered the placeholder INSTEAD of the card, so a card that fetches inside itself — most of the ones the audit named — would never have mounted, never fetched, and kept its skeleton forever. Lifting every fetch into the screen was the alternative, and is a non-goal.
- **"Instant" is time-based: ready within 100ms of the screen mounting.** The first cut meant "ready on first render", which never happens in practice (tabs remount on every switch and data always arrives after an async fetch), so every warm switch would have played the stagger — this plan's own kill criterion.
- **A staggered slot keeps its skeleton until its turn.** Holding the card at opacity 0 for its delay showed a blank gap where the skeleton had just been.
- **The splash spinner is stopped after load.** Fading the splash to `visibility: hidden` instead of `display: none` left its spinner running invisibly for the whole session (measured: `spin` still "running" after hydration).

## Shape

| Piece | File |
|---|---|
| Reveal primitive | `components/primitives/Reveal.tsx` |
| Per-tab chunk fallbacks (`StringingFallback`, `StatsFallback`, `ProfileFallback`, `AdminFallback`) | `components/TabFallbacks.tsx`, wired in `components/HomeShell.tsx` |
| Splash fade, spinner stop, reduced-motion failsafe | `app/globals.css` |
| Canaries | `__tests__/components/Reveal.test.tsx`, `__tests__/tab-fallback-canary.test.ts`, `__tests__/design-canary.test.ts` |
| Spec | `docs/superpowers/specs/2026-10-03-loading-cascade-design.md` |
