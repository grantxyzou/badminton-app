# `<BottomSheet>` Primitive Refactor (Design Spec)

**Date:** 2026-04-16
**Roadmap item:** P1.6 ActionSheet refactor (post-R5)
**Status:** Design approved; awaiting plan

---

## 1. Purpose

The codebase has two bottom-sheet implementations (`SkillsRadar`, `ReleaseNotesSheet`) that re-derive the same scaffolding — portal mount, inline `zIndex`, `position: fixed` body lock, backdrop, accessibility primitives. The duplication is a known maintenance smell: when R5 hit a stacking-context bug, `ReleaseNotesSheet` got a portal-render fix that `SkillsRadar` didn't receive automatically. Future bugs will keep landing in one place and missing the other.

This spec extracts `<BottomSheet>` as a single primitive, migrates both consumers, and bakes in two a11y baselines (focus trap, Escape key) that neither sheet has today.

The primitive deliberately does **not** ship drag-to-dismiss, velocity physics, or iOS-style pill handles. Those features were considered and rejected — see Section 4 for the locked decisions.

## 2. Goals

- One implementation of "fluid snappy bottom sheet" replaces two.
- Both consumers gain a baseline focus trap + Escape-to-close (neither has either today).
- Stacking-context bugs are fixed once; no portal/zIndex pattern drift.
- All 194 existing tests stay green; ~8 new primitive tests land.
- Mobile and desktop animation feels snappy (≤180ms ease-out), not iOS-mimicry-but-worse.
- No accidental hardware/battery waste — explicit performance rules in Section 7.

## 3. Non-goals

- **No drag-to-dismiss** of any kind. SkillsRadar loses this feature; admin users have the close button.
- **No velocity/spring physics.** Avoids the "uncanny valley" where a hand-rolled gesture is ~80% of native iOS feel and reads worse than a clean snap-open.
- **No iOS pill handle.** Without drag, the handle is decoration with no affordance.
- **No backdrop-click dismiss** (per the user's "close icon + Escape only" decision). Aligns with the "you clicked in, you click out" model — explicit dismissal, no accidental losses of in-progress work.
- **No DatePicker migration.** DatePicker is a popover anchored to an input, not a bottom sheet — different primitive, stays as-is.
- **No new runtime dependencies.** Hand-rolled focus trap; CSS-driven animation.

## 4. Locked decisions (from brainstorm)

| Decision | Choice |
|---|---|
| Scope | `SkillsRadar` + `ReleaseNotesSheet` (DatePicker stays separate) |
| Drag-to-dismiss | Not in v1 — eliminates the "iOS feel" risk entirely |
| Animations | Always on (`fluid snappy` is the baseline feel, not opt-in) |
| Dismiss paths | Close icon (consumer-rendered) + Escape key. NO backdrop tap. |
| Focus management | Trap + return-focus-to-trigger baked in |
| Migration strategy | Big-bang single PR (primitive + both consumers) |
| Runtime dependencies | None |

## 5. Architecture

```
components/BottomSheet/
  index.tsx                  re-exports public API
  BottomSheet.tsx            ~110 LOC — root: portal, lifecycle, animation state machine
  BottomSheetHeader.tsx      ~15 LOC — slot for consumer title/close
  BottomSheetBody.tsx        ~15 LOC — scrollable content area
  useBodyScrollLock.ts       ~20 LOC — position:fixed freeze + restore
  useFocusTrap.ts            ~30 LOC — focus trap + return on close
  useEscapeKey.ts            ~10 LOC — single keydown listener that fires onClose
```

**Why split into hooks vs. one file:** each concern is independently testable. A 250-line `BottomSheet.tsx` would be hard to reason about; isolated hooks support targeted unit tests and could be reused if some future modal needs only one piece.

**Why no `useDragToDismiss`:** drag is out of scope (Section 3). Removing the drag hook from the original Section 1 plan saves ~60 LOC of physics code and ~2 tests.

**Why no `useAnimationState`:** the open/close animation state machine is small (~20 LOC) and tightly coupled to `BottomSheet.tsx`. Splitting it into a hook would obscure the lifecycle. Inline.

## 6. API contract

```ts
// BottomSheet.tsx
interface BottomSheetProps {
  /** Controlled open state. */
  open: boolean;

  /** Called on Escape key or consumer-rendered close button. */
  onClose: () => void;

  /** Required for screen readers. */
  ariaLabel: string;

  /** Sheet content. Conventionally <BottomSheetHeader> + <BottomSheetBody>. */
  children: React.ReactNode;

  /** Maximum sheet height. Default: '80vh'. */
  maxHeight?: string;

  /** Element to return focus to on close.
   *  Falls back to document.activeElement at open-time if omitted. */
  triggerRef?: React.RefObject<HTMLElement>;

  /** Passed through to the sheet wrapper. Lets ReleaseNotesSheet
   *  add `terminal-sheet` styling without the primitive knowing. */
  className?: string;
}

interface BottomSheetHeaderProps {
  children?: React.ReactNode;
  className?: string;
}

interface BottomSheetBodyProps {
  children: React.ReactNode;
  className?: string;
}
```

**API invariants:**
- `ariaLabel` is required (TypeScript enforces). No a11y-free escape hatch.
- Close button stays consumer-rendered. Different consumers want different icons / labels (`×` terminal glyph vs. Material `close` vs. `Done` text).
- `className` on the root `<BottomSheet>` passes to the sheet wrapper element, not the backdrop. Consumer styling wins for visual concerns.
- Children are free-form. `<BottomSheetHeader>` and `<BottomSheetBody>` are conventions, not required slots.

## 7. Performance hygiene rules (mandatory)

| Rule | Implementation | Why |
|---|---|---|
| **GPU-only animation** | `transform: translateY()` + `opacity` only. Never `top`/`width`/`height`. | First two are GPU-composited; others trigger layout + paint on the main thread. |
| **`will-change` lifecycle** | Apply `will-change: transform, opacity` only when `state === 'opening' \|\| 'closing'`. Strip when settled. | `will-change` permanently allocates compositor memory. |
| **Zero rAF, zero scroll listeners** | Animation is CSS-driven. Scroll lock uses `position: fixed` set-once. | No per-frame work. |
| **Single Escape listener** | One module-level `useEffect` adds the listener; cleanup removes. | No per-render leak. |
| **All cleanups run on unmount** | `useEffect` cleanup unconditionally restores `body.style`, removes listeners, clears pending timeouts, returns focus. | Survives mid-animation unmounts (e.g., user navigates back). |
| **Children unmount when closed** | Primitive returns `null` after exit animation completes. | Frees consumer state (charts, images) when sheet hidden. |
| **No expensive observers** | Zero `IntersectionObserver`, `ResizeObserver`, `MutationObserver`. | None needed. |
| **`prefers-reduced-motion` honored** | Skip transitions entirely under reduced-motion. | Battery + accessibility win. |
| **No new runtime deps** | ~210 LOC of project code total. | Bundle size flat. |

**Specific traps pre-empted:**
1. **Body scroll lock idempotency** — React Strict Mode double-mounts in dev. The lock-then-restore pattern (record `scrollY`, set `body.style`, restore on cleanup) handles double-application naturally; a counter-based approach would not.
2. **Focus trap teardown** — focus trap registers listeners; teardown must run even if user closes the sheet via back button (component unmounts). `useEffect` cleanup handles this.
3. **`transitionend` race** — if the sheet unmounts before the close animation finishes, the `transitionend` handler never fires. Mitigation: `setTimeout(220ms)` fallback that's cleared on real `transitionend`.

## 8. Animation specification

**Open:**
```css
transform: translateY(100%) → translateY(0)
opacity: 0 → 1
duration: 180ms
easing: cubic-bezier(0.16, 1, 0.3, 1)  /* "ease-out-quart" — snappy */
```

**Close:** reverse.

**Backdrop:** opacity-only fade, same duration/easing.

**State machine** (in `BottomSheet.tsx`):
- `closed` → unmounted (returns null)
- `opening` → mounted with translateY(100%), `requestAnimationFrame` flips to translateY(0)
- `open` → fully visible, `will-change` removed, animation done
- `closing` → translateY(0) → translateY(100%); on `transitionend` (or 220ms fallback) → `closed`

**`prefers-reduced-motion: reduce`:** skip the transition; instant state change. State machine collapses to `closed ↔ open`.

## 9. Migration plan

Single PR includes all of the following changes:

### `components/BottomSheet/` — new
Files per Section 5.

### `components/SkillsRadar.tsx` — refactor
- Remove portal/backdrop/body-lock/inline-zIndex scaffolding (~150 LOC)
- Remove drag-to-dismiss state and handlers (`dragY`, `setDragY`, touch handlers, drag transform) (~50 LOC)
- Replace with `<BottomSheet open={...} onClose={...} ariaLabel={...} animated maxHeight="72vh">` wrapping the existing content
- Keep all chart/save/player logic intact
- **Expected delta: -200 LOC**

### `components/ReleaseNotesSheet.tsx` — refactor
- Remove portal/backdrop/body-lock/zIndex scaffolding (~50 LOC)
- Remove `mounted` gate (primitive handles)
- Replace outer wrapper with `<BottomSheet open={...} onClose={...} ariaLabel={t('sheetLabel')} className="terminal-sheet">`
- Keep terminal-styled content (titlebar, prompt line, version list) inside `<BottomSheetHeader>` + `<BottomSheetBody>`
- **Expected delta: -50 LOC**

### Tests
- New: `__tests__/components/BottomSheet.test.tsx` (~8 tests — Section 10)
- New: `__tests__/components/BottomSheet.hooks.test.ts` (~4 tests for body-lock + focus-trap in isolation)
- Existing `SkillsRadar` and `ReleaseNotesSheet` test suites stay green:
  - SkillsRadar tests for drag may be removed (drag is gone)
  - All other tests pass unchanged (behavior-preserved refactor)

## 10. Testing

### `__tests__/components/BottomSheet.test.tsx` — ~8 tests
1. Returns `null` and renders nothing when `open=false`
2. Portals to `document.body` when `open=true`
3. Sets `role="dialog"` and `aria-label` on the sheet element
4. Backdrop click does NOT close (per locked decision — close icon + Escape only)
5. Escape key calls `onClose`
6. Tabbing wraps within the sheet (focus trap)
7. Closes (calls `onClose`) when `transitionend` fires after `open` flips to `false`
8. Restores body scroll on close (no leak)

### `__tests__/components/BottomSheet.hooks.test.ts` — ~4 tests
1. `useBodyScrollLock` applies `position: fixed` on mount, restores on unmount
2. `useBodyScrollLock` idempotent under React Strict Mode double-mount
3. `useFocusTrap` moves focus into the trap on mount
4. `useFocusTrap` returns focus to `triggerRef` on unmount

### Existing test suites stay green
- `__tests__/components/ReleaseNotesSheet.test.tsx` (4 tests) — pass unchanged
- `__tests__/components/ReleaseNotesTrigger.test.tsx` (5 tests) — unaffected
- `__tests__/api/releases.test.ts` (7 tests) — unaffected
- All other 178 tests — unaffected

**Test count after refactor:** 194 (current) − 0 + 12 (new) = **~206 tests**.
(SkillsRadar's drag tests, if any, are removed — net could be slightly lower.)

### Not tested (deliberate)
- Real-device drag feel (drag is removed)
- Visual animation correctness in jsdom (jsdom doesn't run CSS transitions)
- Touch gesture handling (not needed, no drag)

## 11. Rollout

Single PR. No feature flag. Behavior-preserved for both consumers; users see:
- **SkillsRadar:** loses drag-to-dismiss (admin-only feature; admins use close button)
- **ReleaseNotesSheet:** unchanged behavior; gains Escape-to-close + focus trap (new keyboard wins, no visual change)
- **Both:** consistent fluid snappy animation; no more pattern drift

If something regresses post-merge:
- Revert the PR; both consumers return to their pre-refactor implementations.
- No data migration; nothing in Cosmos changes.

## 12. Out of scope / future

- **Drag-to-dismiss** — explicitly rejected. If admin users miss SkillsRadar's drag, revisit with a battle-tested dep (`framer-motion` or `@react-spring/web`) rather than hand-rolling physics.
- **`<BottomSheet.Close>` convenience component** — current convention is consumer-rendered close button. If pattern proves error-prone, add later.
- **Backdrop blur effect** — primitive uses solid `bg-black/50` backdrop. If ever wanted, add via `className` pass-through.
- **DatePicker migration** — different primitive (popover, not sheet). Separate refactor if worth it later.
- **`<Modal>` for non-bottom-anchored dialogs** — confirmation dialogs, alerts, etc. Could share hooks (`useFocusTrap`, `useEscapeKey`, `useBodyScrollLock`) but is a different layout primitive. Future spec.
