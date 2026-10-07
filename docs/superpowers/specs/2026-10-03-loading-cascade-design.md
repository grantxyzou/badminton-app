# Loading cascade — design (phase 1)

Intent: docs/plans/loading-cascade.md

> **Record of the phase-1 design.** What changed after it — readiness meaning an ANSWER, the slot
> detecting an empty card from the DOM, re-ordering deferred past a commit, placeholder-less slots
> taking no space, and every phase's specifics — is in the plan's Decisions, which is the current
> account. The splash rules here were taken over by the launch screen (#511).

## Goal

Every screen fills top to bottom on skeletons that match its final layout. Phase 1 builds the
primitive and fixes the loaders every tab shares; phases 2–5 adopt the primitive per screen
(Home + cold start → Stats → Profile + Stringing → Admin), each fixing that screen's lying
loading states in the same change.

## Motion rules (shared by every phase)

| Rule | Value | Why |
|---|---|---|
| Property | opacity only | Content arriving into a surface already on screen does not rise (motion-pass recipe 1). |
| Duration | `--duration-fast` (150ms), `--ease-glass` — i.e. the existing `.motion-fade` | One fade in the app, not two. |
| Stagger | 40ms per slot, capped at 4 (slot 5+ shares slot 4's delay) | Tab switches are tens-per-day; anything longer reads as slow. |
| Instant data | A slot ready at its first render reveals with NO fade and no delay | A warm switch must not wait on choreography. |
| Reduced motion | Fade kept, stagger dropped | Fade is comprehension, delay is decoration. |

## The primitive — `components/primitives/Reveal.tsx`

```tsx
<RevealGroup>
  {/* data the parent owns */}
  <RevealSlot ready={!!session} placeholder={<CardSkeleton height={108} />}>…</RevealSlot>
  {/* a card that fetches inside itself */}
  <RevealSlot canBeEmpty placeholder={<CardSkeleton height={160} />}><KudosReceivedCard /></RevealSlot>
</RevealGroup>

// inside KudosReceivedCard
useRevealReady(kudos !== null || !!error, kudos?.length === 0);
```

- `RevealGroup` orders its slots by DOM position (`compareDocumentPosition`) and reveals, in
  order, every slot that is ready with nothing unrevealed above it.
- `RevealSlot` props: `ready?`, `placeholder`, `empty?`, `canBeEmpty?`.
  - The card is MOUNTED from the start, hidden while the placeholder shows, so a card that
    fetches inside itself still fetches. It reports with `useRevealReady(ready, empty)`;
    a `ready` prop overrides that for data the parent owns. A hidden card measures 0.
  - Ready within `INSTANT_MS` (100ms) of the group mounting → shown with no fade.
  - Later → the batch revealed together staggers 40ms apart (capped at the 4th); each slot
    keeps its PLACEHOLDER until its turn, then the card appears with `.motion-fade`.
    Reduced motion: no stagger, fade kept.
  - `empty` → the placeholder closes through `<Collapse>` and the slot leaves the layout;
    empty within `INSTANT_MS` → never takes space. Pass `canBeEmpty` (implied by `empty`) so
    the placeholder is wrapped to be able to close.
  - Once revealed, a slot never returns to its placeholder.
- Outside a `RevealGroup`, a slot is its own ordering.

## Phase 1 cross-tab fixes

1. **Per-tab chunk fallbacks.** `HomeShell`'s `dynamic()` fallbacks stop borrowing Home's
   `TabSkeleton`. `components/TabFallbacks.tsx` exports one per tab, each a copy of that
   tab's OWN first loading frame (real `<PageHeader>` + its skeletons), so the chunk arriving
   changes nothing. `SkillsTab` also shows `StatsFallback` (not `null`) while the active name
   resolves:
   - Stringing: one card (height measured from the live "Coming soon" card).
   - Stats: OverviewStrip row + segment control + the You register's first two cards.
   - Profile: the identity card + a settings list block (heights measured).
   - Admin: gets a fallback at all (today it has none), `PageHeader` + `AdminTabSkeleton`,
     identical to `AdminTab`'s own auth-check state so the hand-off does not change frame.
   Heights are measured from the running app at 400px, recorded in the component's comment.
2. **Splash fades out.** On `html[data-hydrated]` the splash animates to `opacity: 0;
   visibility: hidden` over 150ms instead of `display: none`, and its spinner is stopped
   (`visibility` alone left it spinning invisibly all session).
3. **Reduced-motion splash failsafe.** Under `prefers-reduced-motion` the failsafe keeps a
   `steps(1, end)` 5.4s animation, so the splash still disappears if hydration stalls (today it
   stays forever for those users). Specificity + `!important` outranks the wildcard rule.
4. **Home header.** The loading branch renders `<PageHeader compact>` like the loaded branch, so
   the title no longer shrinks at reveal.

## Testing

- `__tests__/components/Reveal.test.tsx`: reveals in order when data arrives out of order;
  instant-ready renders without `.motion-fade`; empty slot collapses and unblocks the next;
  revealed slot ignores `ready` going false; stagger delay caps at 3 × 40ms; standalone slot.
- Canary: every `dynamic()` tab import in `HomeShell` passes a `loading` fallback that is not
  `TabSkeleton` (except Home itself, which is eager).
- `design-canary` updated for the splash rules.
- Real-browser screenshots at 400px of each tab's fallback and of a cold Home load — the suite
  cannot see layout.

## Out of scope for phase 1

Adopting `RevealSlot` on any screen; the lying loading states; Home's deep-link double mount;
Admin's `PageHeader` → `TopBar` switch. Each lands in its screen's phase.
