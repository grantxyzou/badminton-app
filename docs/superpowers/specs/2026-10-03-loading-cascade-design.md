# Loading cascade — design (phase 1)

Intent: docs/plans/loading-cascade.md

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
  <RevealSlot ready={!!session} placeholder={<CardSkeleton height={108} />}>…</RevealSlot>
  <RevealSlot ready={kudos !== null} empty={kudos?.length === 0} placeholder={…}>…</RevealSlot>
</RevealGroup>
```

- `RevealGroup` holds the ordered list of slots (registration order = DOM order, via a counter
  assigned during render and stable across re-renders through a ref) and the index of the last
  slot revealed.
- `RevealSlot` props: `ready: boolean`, `placeholder: ReactNode`, optional `empty: boolean`.
  - Renders `placeholder` until `ready` AND every earlier slot has revealed (or resolved empty).
  - Then renders `children` in a wrapper carrying `.motion-fade` with
    `animation-delay: min(position-in-current-batch, 3) * 40ms`, where a batch is the run of
    slots that became revealable in the same commit.
  - `ready` already true on the slot's first render → no `.motion-fade`, no delay.
  - `ready && empty` → the placeholder closes through `<Collapse open={false}>` and the slot
    counts as revealed for the slots below it.
  - Once revealed, a slot never returns to its placeholder, even if `ready` goes false again
    (a refetch keeps its content — the existing `loadedRef` rule, enforced by the primitive).
- Outside a `RevealGroup`, `RevealSlot` behaves as an unordered single slot (placeholder until
  ready, then fade), so a card can adopt it before its screen does.
- Fetching is untouched: the primitive only decides what is rendered.

## Phase 1 cross-tab fixes

1. **Per-tab chunk fallbacks.** `HomeShell`'s `dynamic()` fallbacks stop borrowing Home's
   `TabSkeleton`. New `TabFallback({ title, children })` renders the real `<PageHeader>` with
   the tab's translated title, then a body skeleton shaped like that tab:
   - Stringing: one card (height measured from the live "Coming soon" card).
   - Stats: OverviewStrip row + segment control + the You register's first two cards.
   - Profile: the identity card + a settings list block (heights measured).
   - Admin: gets a fallback at all (today it has none), `PageHeader` + `AdminTabSkeleton`,
     identical to `AdminTab`'s own auth-check state so the hand-off does not change frame.
   Heights are measured from the running app at 390px, recorded in the component's comment.
2. **Splash fades out.** On `html[data-hydrated]` the splash goes to `opacity: 0;
   visibility: hidden` over 150ms instead of `display: none`.
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
- Real-browser screenshots at 390px of each tab's fallback and of a cold Home load — the suite
  cannot see layout.

## Out of scope for phase 1

Adopting `RevealSlot` on any screen; the lying loading states; Home's deep-link double mount;
Admin's `PageHeader` → `TopBar` switch. Each lands in its screen's phase.
