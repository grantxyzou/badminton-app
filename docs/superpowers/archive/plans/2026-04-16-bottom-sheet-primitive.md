# `<BottomSheet>` Primitive Refactor Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Extract a single `<BottomSheet>` primitive (portal, scroll lock, focus trap, Escape, fluid animation) and migrate `SkillsRadar` + `ReleaseNotesSheet` onto it. SkillsRadar loses drag-to-dismiss; both consumers gain a11y baselines they didn't have.

**Architecture:** New `components/BottomSheet/` folder with the root component, slot subcomponents (Header, Body), and three small hooks (body scroll lock, focus trap, escape key). Animation is CSS-driven via a `data-state` attribute switched by a 4-state machine (`closed → opening → open → closing → closed`). Big-bang migration in a single PR.

**Tech Stack:** React 18, TypeScript strict, Tailwind, Vitest 4, `@testing-library/react`. No new runtime deps.

---

## Spec reference
Design: `docs/superpowers/specs/2026-04-16-bottom-sheet-primitive-design.md`

## Project conventions to follow
- Vitest default env is `node`. Component tests need `// @vitest-environment jsdom` docblock.
- Component tests with `/bpm` cookie path also need `// @vitest-environment-options { "url": "http://localhost:3000/bpm" }`.
- Vitest globals NOT configured — explicit `describe`, `it`, `expect`, `afterEach`, `vi` from `vitest`.
- Component tests must call `afterEach(cleanup)` manually.
- Components using `useTranslations` must wrap in `<NextIntlClientProvider>` in tests (not relevant here — primitive has no i18n).
- Commit style: lowercase type prefix + Co-Authored-By footer + HEREDOC.
- Run `npm test` between tasks to confirm 194 baseline preserved.

---

### Task 1: Folder + skeleton primitive (portal mount, null gate, aria) — TDD

**Files:**
- Create: `components/BottomSheet/index.tsx` (re-exports)
- Create: `components/BottomSheet/BottomSheet.tsx`
- Create: `components/BottomSheet/BottomSheetHeader.tsx`
- Create: `components/BottomSheet/BottomSheetBody.tsx`
- Create: `__tests__/components/BottomSheet/BottomSheet.test.tsx`

- [ ] **Step 1: Write failing test**

```tsx
// @vitest-environment jsdom
// @vitest-environment-options { "url": "http://localhost:3000/bpm" }
import { describe, it, expect, afterEach, vi } from 'vitest';
import { render, screen, cleanup } from '@testing-library/react';
import { BottomSheet, BottomSheetHeader, BottomSheetBody } from '../../../components/BottomSheet';

describe('BottomSheet — skeleton', () => {
  afterEach(cleanup);

  it('renders nothing when open=false', () => {
    const { container } = render(
      <BottomSheet open={false} onClose={vi.fn()} ariaLabel="Test sheet">
        <BottomSheetBody>content</BottomSheetBody>
      </BottomSheet>,
    );
    expect(container.textContent).toBe('');
    expect(document.body.querySelector('[role="dialog"]')).toBeNull();
  });

  it('portals to document.body when open=true', () => {
    const { container } = render(
      <BottomSheet open={true} onClose={vi.fn()} ariaLabel="Test sheet">
        <BottomSheetBody>content</BottomSheetBody>
      </BottomSheet>,
    );
    // Sheet should NOT be inside the test render container; it portals to body
    expect(container.querySelector('[role="dialog"]')).toBeNull();
    expect(document.body.querySelector('[role="dialog"]')).not.toBeNull();
  });

  it('sets aria-label on the dialog', () => {
    render(
      <BottomSheet open={true} onClose={vi.fn()} ariaLabel="Release history">
        <BottomSheetBody>x</BottomSheetBody>
      </BottomSheet>,
    );
    expect(screen.getByRole('dialog', { name: 'Release history' })).toBeTruthy();
  });
});
```

- [ ] **Step 2: Run to confirm fail**

Run: `npx vitest run __tests__/components/BottomSheet/BottomSheet.test.tsx`
Expected: FAIL — `Cannot find module '../../../components/BottomSheet'`.

- [ ] **Step 3: Create `components/BottomSheet/index.tsx`**

```tsx
export { default as BottomSheet } from './BottomSheet';
export { default as BottomSheetHeader } from './BottomSheetHeader';
export { default as BottomSheetBody } from './BottomSheetBody';
```

- [ ] **Step 4: Create `components/BottomSheet/BottomSheetHeader.tsx`**

```tsx
'use client';

interface BottomSheetHeaderProps {
  children?: React.ReactNode;
  className?: string;
}

export default function BottomSheetHeader({ children, className }: BottomSheetHeaderProps) {
  return <div className={className}>{children}</div>;
}
```

- [ ] **Step 5: Create `components/BottomSheet/BottomSheetBody.tsx`**

```tsx
'use client';

interface BottomSheetBodyProps {
  children: React.ReactNode;
  className?: string;
}

export default function BottomSheetBody({ children, className }: BottomSheetBodyProps) {
  return (
    <div
      className={`overflow-y-auto p-5 pb-20 ${className ?? ''}`}
      style={{ maxHeight: 'calc(80vh - 40px)' }}
    >
      {children}
    </div>
  );
}
```

- [ ] **Step 6: Create `components/BottomSheet/BottomSheet.tsx`**

```tsx
'use client';

import { useEffect, useState } from 'react';
import { createPortal } from 'react-dom';

export interface BottomSheetProps {
  open: boolean;
  onClose: () => void;
  ariaLabel: string;
  children: React.ReactNode;
  maxHeight?: string;
  triggerRef?: React.RefObject<HTMLElement>;
  className?: string;
}

export default function BottomSheet({
  open,
  ariaLabel,
  children,
  maxHeight = '80vh',
  className,
}: BottomSheetProps) {
  const [mounted, setMounted] = useState(false);

  useEffect(() => {
    setMounted(true);
  }, []);

  if (!open || !mounted) return null;

  return createPortal(
    <div
      className={`fixed bottom-0 left-0 right-0 rounded-t-2xl overflow-hidden ${className ?? ''}`}
      style={{ zIndex: 60, maxHeight }}
      role="dialog"
      aria-label={ariaLabel}
    >
      {children}
    </div>,
    document.body,
  );
}
```

- [ ] **Step 7: Run tests**

Run: `npx vitest run __tests__/components/BottomSheet/BottomSheet.test.tsx`
Expected: 3 tests PASS.

Run: `npm test`
Expected: 197 tests pass (194 + 3 new).

- [ ] **Step 8: Commit**

```bash
git add components/BottomSheet/ __tests__/components/BottomSheet/BottomSheet.test.tsx
git commit -m "$(cat <<'EOF'
feat: add BottomSheet primitive skeleton (portal, null gate, aria)

Co-Authored-By: Claude Opus 4.6 (1M context) <noreply@anthropic.com>
EOF
)"
```

---

### Task 2: `useBodyScrollLock` hook — TDD

**Files:**
- Create: `components/BottomSheet/useBodyScrollLock.ts`
- Create: `__tests__/components/BottomSheet/useBodyScrollLock.test.ts`

- [ ] **Step 1: Write failing test**

```ts
// @vitest-environment jsdom
import { describe, it, expect, afterEach } from 'vitest';
import { renderHook } from '@testing-library/react';
import { useBodyScrollLock } from '../../../components/BottomSheet/useBodyScrollLock';

describe('useBodyScrollLock', () => {
  afterEach(() => {
    document.body.style.position = '';
    document.body.style.top = '';
    document.body.style.width = '';
  });

  it('applies position: fixed to body when active', () => {
    renderHook(() => useBodyScrollLock(true));
    expect(document.body.style.position).toBe('fixed');
  });

  it('does NOT apply when inactive', () => {
    renderHook(() => useBodyScrollLock(false));
    expect(document.body.style.position).toBe('');
  });

  it('restores body styles on unmount', () => {
    const { unmount } = renderHook(() => useBodyScrollLock(true));
    expect(document.body.style.position).toBe('fixed');
    unmount();
    expect(document.body.style.position).toBe('');
    expect(document.body.style.top).toBe('');
    expect(document.body.style.width).toBe('');
  });
});
```

- [ ] **Step 2: Run to confirm fail**

Run: `npx vitest run __tests__/components/BottomSheet/useBodyScrollLock.test.ts`
Expected: FAIL — module not found.

- [ ] **Step 3: Implement `components/BottomSheet/useBodyScrollLock.ts`**

```ts
import { useEffect } from 'react';

/**
 * Locks body scroll using the position:fixed technique. Plain `overflow: hidden`
 * doesn't stop iOS rubber-band / pull-to-refresh — `position: fixed` pins the
 * body to its current scroll offset so no gesture can move it.
 *
 * Idempotent: running cleanup multiple times (e.g., React Strict Mode
 * double-mount in dev) restores the same original styles each time.
 */
export function useBodyScrollLock(active: boolean): void {
  useEffect(() => {
    if (!active) return;
    const scrollY = window.scrollY;
    const body = document.body;
    const prev = {
      position: body.style.position,
      top: body.style.top,
      width: body.style.width,
    };
    body.style.position = 'fixed';
    body.style.top = `-${scrollY}px`;
    body.style.width = '100%';
    return () => {
      body.style.position = prev.position;
      body.style.top = prev.top;
      body.style.width = prev.width;
      window.scrollTo(0, scrollY);
    };
  }, [active]);
}
```

- [ ] **Step 4: Run tests**

Run: `npx vitest run __tests__/components/BottomSheet/useBodyScrollLock.test.ts`
Expected: 3 PASS.

Run: `npm test`
Expected: 200 tests pass (197 + 3).

- [ ] **Step 5: Commit**

```bash
git add components/BottomSheet/useBodyScrollLock.ts __tests__/components/BottomSheet/useBodyScrollLock.test.ts
git commit -m "$(cat <<'EOF'
feat: add useBodyScrollLock hook for BottomSheet

Co-Authored-By: Claude Opus 4.6 (1M context) <noreply@anthropic.com>
EOF
)"
```

---

### Task 3: `useFocusTrap` hook — TDD

**Files:**
- Create: `components/BottomSheet/useFocusTrap.ts`
- Create: `__tests__/components/BottomSheet/useFocusTrap.test.tsx`

- [ ] **Step 1: Write failing test**

```tsx
// @vitest-environment jsdom
import { describe, it, expect, afterEach, vi } from 'vitest';
import { render, cleanup } from '@testing-library/react';
import { useRef } from 'react';
import { useFocusTrap } from '../../../components/BottomSheet/useFocusTrap';

function Harness({ active, triggerRef }: { active: boolean; triggerRef?: React.RefObject<HTMLElement> }) {
  const containerRef = useRef<HTMLDivElement>(null);
  useFocusTrap(active, containerRef, triggerRef);
  return (
    <div>
      <button data-testid="outside-before">outside-before</button>
      <div ref={containerRef} data-testid="container">
        <button data-testid="first">first</button>
        <button data-testid="last">last</button>
      </div>
      <button data-testid="outside-after">outside-after</button>
    </div>
  );
}

describe('useFocusTrap', () => {
  afterEach(cleanup);

  it('moves focus to the first focusable element in container on activate', () => {
    render(<Harness active={true} />);
    expect(document.activeElement?.getAttribute('data-testid')).toBe('first');
  });

  it('does nothing when inactive', () => {
    render(<Harness active={false} />);
    // Focus stays on body or whatever it was before
    expect(document.activeElement?.getAttribute('data-testid')).not.toBe('first');
  });

  it('returns focus to triggerRef on unmount', () => {
    const triggerEl = document.createElement('button');
    triggerEl.setAttribute('data-testid', 'trigger');
    document.body.appendChild(triggerEl);
    const triggerRef = { current: triggerEl };
    const { unmount } = render(<Harness active={true} triggerRef={triggerRef} />);
    expect(document.activeElement?.getAttribute('data-testid')).toBe('first');
    unmount();
    expect(document.activeElement?.getAttribute('data-testid')).toBe('trigger');
    document.body.removeChild(triggerEl);
  });
});
```

- [ ] **Step 2: Run to confirm fail**

Run: `npx vitest run __tests__/components/BottomSheet/useFocusTrap.test.tsx`
Expected: FAIL — module not found.

- [ ] **Step 3: Implement `components/BottomSheet/useFocusTrap.ts`**

```ts
import { useEffect, RefObject } from 'react';

const FOCUSABLE_SELECTOR = [
  'a[href]',
  'button:not([disabled])',
  'input:not([disabled])',
  'select:not([disabled])',
  'textarea:not([disabled])',
  '[tabindex]:not([tabindex="-1"])',
].join(',');

/**
 * Traps Tab/Shift+Tab focus inside `containerRef` while `active` is true.
 * On activation, focus moves to the first focusable element inside the container.
 * On deactivation, focus returns to `triggerRef` (or document.activeElement at
 * activation time as fallback).
 */
export function useFocusTrap(
  active: boolean,
  containerRef: RefObject<HTMLElement | null>,
  triggerRef?: RefObject<HTMLElement | null>,
): void {
  useEffect(() => {
    if (!active) return;
    const container = containerRef.current;
    if (!container) return;

    const previouslyFocused =
      (triggerRef?.current as HTMLElement | null) ?? (document.activeElement as HTMLElement | null);

    // Move focus to first focusable element inside container
    const focusables = container.querySelectorAll<HTMLElement>(FOCUSABLE_SELECTOR);
    if (focusables.length > 0) {
      focusables[0].focus();
    } else {
      container.setAttribute('tabindex', '-1');
      container.focus();
    }

    function onKeyDown(e: KeyboardEvent) {
      if (e.key !== 'Tab' || !container) return;
      const items = container.querySelectorAll<HTMLElement>(FOCUSABLE_SELECTOR);
      if (items.length === 0) return;
      const first = items[0];
      const last = items[items.length - 1];
      if (e.shiftKey && document.activeElement === first) {
        e.preventDefault();
        last.focus();
      } else if (!e.shiftKey && document.activeElement === last) {
        e.preventDefault();
        first.focus();
      }
    }

    document.addEventListener('keydown', onKeyDown);
    return () => {
      document.removeEventListener('keydown', onKeyDown);
      previouslyFocused?.focus?.();
    };
  }, [active, containerRef, triggerRef]);
}
```

- [ ] **Step 4: Run tests**

Run: `npx vitest run __tests__/components/BottomSheet/useFocusTrap.test.tsx`
Expected: 3 PASS.

Run: `npm test`
Expected: 203 tests pass (200 + 3).

- [ ] **Step 5: Commit**

```bash
git add components/BottomSheet/useFocusTrap.ts __tests__/components/BottomSheet/useFocusTrap.test.tsx
git commit -m "$(cat <<'EOF'
feat: add useFocusTrap hook for BottomSheet

Co-Authored-By: Claude Opus 4.6 (1M context) <noreply@anthropic.com>
EOF
)"
```

---

### Task 4: Wire body lock + focus trap + Escape into BottomSheet — TDD

**Files:**
- Modify: `components/BottomSheet/BottomSheet.tsx`
- Modify: `__tests__/components/BottomSheet/BottomSheet.test.tsx` (append cases)

- [ ] **Step 1: Append failing tests**

Append to the existing describe block in `__tests__/components/BottomSheet/BottomSheet.test.tsx`:

```tsx
import { fireEvent } from '@testing-library/react';

describe('BottomSheet — interactions', () => {
  afterEach(() => {
    cleanup();
    document.body.style.position = '';
    document.body.style.top = '';
    document.body.style.width = '';
  });

  it('Escape key calls onClose', () => {
    const onClose = vi.fn();
    render(
      <BottomSheet open={true} onClose={onClose} ariaLabel="x">
        <BottomSheetBody>content</BottomSheetBody>
      </BottomSheet>,
    );
    fireEvent.keyDown(document, { key: 'Escape' });
    expect(onClose).toHaveBeenCalledTimes(1);
  });

  it('does NOT call onClose on backdrop tap (close icon + Escape only per spec)', () => {
    const onClose = vi.fn();
    render(
      <BottomSheet open={true} onClose={onClose} ariaLabel="x">
        <BottomSheetBody>content</BottomSheetBody>
      </BottomSheet>,
    );
    // No backdrop element should be present at all
    expect(document.body.querySelectorAll('[data-bottom-sheet-backdrop]').length).toBe(0);
    expect(onClose).not.toHaveBeenCalled();
  });

  it('locks body scroll while open', () => {
    render(
      <BottomSheet open={true} onClose={vi.fn()} ariaLabel="x">
        <BottomSheetBody>content</BottomSheetBody>
      </BottomSheet>,
    );
    expect(document.body.style.position).toBe('fixed');
  });

  it('restores body scroll when closed', () => {
    const { rerender } = render(
      <BottomSheet open={true} onClose={vi.fn()} ariaLabel="x">
        <BottomSheetBody>content</BottomSheetBody>
      </BottomSheet>,
    );
    expect(document.body.style.position).toBe('fixed');
    rerender(
      <BottomSheet open={false} onClose={vi.fn()} ariaLabel="x">
        <BottomSheetBody>content</BottomSheetBody>
      </BottomSheet>,
    );
    expect(document.body.style.position).toBe('');
  });
});
```

- [ ] **Step 2: Run to confirm new tests fail**

Run: `npx vitest run __tests__/components/BottomSheet/BottomSheet.test.tsx`
Expected: 4 new tests FAIL (Escape, body lock, etc. not wired yet).

- [ ] **Step 3: Update `components/BottomSheet/BottomSheet.tsx`**

Replace the entire file with:

```tsx
'use client';

import { useEffect, useRef, useState } from 'react';
import { createPortal } from 'react-dom';
import { useBodyScrollLock } from './useBodyScrollLock';
import { useFocusTrap } from './useFocusTrap';

export interface BottomSheetProps {
  open: boolean;
  onClose: () => void;
  ariaLabel: string;
  children: React.ReactNode;
  maxHeight?: string;
  triggerRef?: React.RefObject<HTMLElement>;
  className?: string;
}

export default function BottomSheet({
  open,
  onClose,
  ariaLabel,
  children,
  maxHeight = '80vh',
  triggerRef,
  className,
}: BottomSheetProps) {
  const [mounted, setMounted] = useState(false);
  const sheetRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    setMounted(true);
  }, []);

  // Body scroll lock — only when open.
  useBodyScrollLock(open && mounted);

  // Focus trap + return focus on close — only when open.
  useFocusTrap(open && mounted, sheetRef, triggerRef);

  // Escape key dismiss
  useEffect(() => {
    if (!open) return;
    function onKeyDown(e: KeyboardEvent) {
      if (e.key === 'Escape') {
        e.preventDefault();
        onClose();
      }
    }
    document.addEventListener('keydown', onKeyDown);
    return () => document.removeEventListener('keydown', onKeyDown);
  }, [open, onClose]);

  if (!open || !mounted) return null;

  return createPortal(
    <div
      ref={sheetRef}
      className={`fixed bottom-0 left-0 right-0 rounded-t-2xl overflow-hidden ${className ?? ''}`}
      style={{ zIndex: 60, maxHeight }}
      role="dialog"
      aria-label={ariaLabel}
    >
      {children}
    </div>,
    document.body,
  );
}
```

- [ ] **Step 4: Run tests**

Run: `npx vitest run __tests__/components/BottomSheet/BottomSheet.test.tsx`
Expected: 7 PASS (3 from Task 1 + 4 new).

Run: `npm test`
Expected: 207 tests pass (203 + 4).

- [ ] **Step 5: Commit**

```bash
git add components/BottomSheet/BottomSheet.tsx __tests__/components/BottomSheet/BottomSheet.test.tsx
git commit -m "$(cat <<'EOF'
feat: wire body scroll lock, focus trap, and Escape into BottomSheet

Co-Authored-By: Claude Opus 4.6 (1M context) <noreply@anthropic.com>
EOF
)"
```

---

### Task 5: Animation state machine + CSS

**Files:**
- Modify: `components/BottomSheet/BottomSheet.tsx`
- Modify: `app/globals.css` (add `.bottom-sheet` styles)

No new tests — jsdom doesn't run CSS transitions. State machine is small and verified visually + via the unmount-on-close behavior already tested.

- [ ] **Step 1: Add CSS to `app/globals.css`**

Append at the end of the file:

```css
/* ── BottomSheet primitive ── */
.bottom-sheet {
  transform: translateY(100%);
  opacity: 0;
  transition:
    transform 180ms cubic-bezier(0.16, 1, 0.3, 1),
    opacity 180ms cubic-bezier(0.16, 1, 0.3, 1);
}
.bottom-sheet[data-state="open"] {
  transform: translateY(0);
  opacity: 1;
}
.bottom-sheet[data-state="closing"] {
  transform: translateY(100%);
  opacity: 0;
}
.bottom-sheet[data-state="opening"],
.bottom-sheet[data-state="closing"] {
  will-change: transform, opacity;
}
@media (prefers-reduced-motion: reduce) {
  .bottom-sheet {
    transition: none;
  }
}
```

- [ ] **Step 2: Update `components/BottomSheet/BottomSheet.tsx` with state machine**

Replace the entire file with:

```tsx
'use client';

import { useEffect, useRef, useState } from 'react';
import { createPortal } from 'react-dom';
import { useBodyScrollLock } from './useBodyScrollLock';
import { useFocusTrap } from './useFocusTrap';

export interface BottomSheetProps {
  open: boolean;
  onClose: () => void;
  ariaLabel: string;
  children: React.ReactNode;
  maxHeight?: string;
  triggerRef?: React.RefObject<HTMLElement>;
  className?: string;
}

type SheetState = 'closed' | 'opening' | 'open' | 'closing';

export default function BottomSheet({
  open,
  onClose,
  ariaLabel,
  children,
  maxHeight = '80vh',
  triggerRef,
  className,
}: BottomSheetProps) {
  const [mounted, setMounted] = useState(false);
  const [state, setState] = useState<SheetState>('closed');
  const sheetRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    setMounted(true);
  }, []);

  // Drive the state machine off the open prop.
  useEffect(() => {
    if (open && (state === 'closed' || state === 'closing')) {
      setState('opening');
      // Next frame: flip to 'open' so the CSS transition runs from
      // translateY(100%) → translateY(0).
      const raf = requestAnimationFrame(() => setState('open'));
      return () => cancelAnimationFrame(raf);
    }
    if (!open && (state === 'open' || state === 'opening')) {
      setState('closing');
      // Wait for transitionend, with a 220ms safety net (180ms transition + buffer).
      const sheet = sheetRef.current;
      if (!sheet) {
        const t = setTimeout(() => setState('closed'), 220);
        return () => clearTimeout(t);
      }
      let cleared = false;
      function onEnd(e: TransitionEvent) {
        if (e.propertyName !== 'transform') return;
        cleared = true;
        setState('closed');
      }
      sheet.addEventListener('transitionend', onEnd);
      const safety = setTimeout(() => {
        if (!cleared) setState('closed');
      }, 220);
      return () => {
        sheet.removeEventListener('transitionend', onEnd);
        clearTimeout(safety);
      };
    }
  }, [open, state]);

  const visible = state !== 'closed';

  // Body lock + focus trap active only while visible.
  useBodyScrollLock(visible && mounted);
  useFocusTrap(visible && mounted, sheetRef, triggerRef);

  // Escape key dismiss while visible.
  useEffect(() => {
    if (!visible) return;
    function onKeyDown(e: KeyboardEvent) {
      if (e.key === 'Escape') {
        e.preventDefault();
        onClose();
      }
    }
    document.addEventListener('keydown', onKeyDown);
    return () => document.removeEventListener('keydown', onKeyDown);
  }, [visible, onClose]);

  if (!mounted || state === 'closed') return null;

  return createPortal(
    <div
      ref={sheetRef}
      data-state={state}
      className={`bottom-sheet fixed bottom-0 left-0 right-0 rounded-t-2xl overflow-hidden ${className ?? ''}`}
      style={{ zIndex: 60, maxHeight }}
      role="dialog"
      aria-label={ariaLabel}
    >
      {children}
    </div>,
    document.body,
  );
}
```

- [ ] **Step 3: Run tests**

Run: `npm test`
Expected: 207 tests pass (the existing BottomSheet tests still pass — closed state still returns null, dialog renders when open).

- [ ] **Step 4: Verify build**

Run: `npm run build`
Expected: succeeds.

- [ ] **Step 5: Commit**

```bash
git add components/BottomSheet/BottomSheet.tsx app/globals.css
git commit -m "$(cat <<'EOF'
feat: add CSS-driven open/close animation state machine to BottomSheet

180ms ease-out-quart, GPU-accelerated transform + opacity. Will-change
applied only during transitions. Honors prefers-reduced-motion.

Co-Authored-By: Claude Opus 4.6 (1M context) <noreply@anthropic.com>
EOF
)"
```

---

### Task 6: Migrate `ReleaseNotesSheet` to use the primitive

**Files:**
- Modify: `components/ReleaseNotesSheet.tsx`

The existing 4 tests in `__tests__/components/ReleaseNotesSheet.test.tsx` MUST keep passing — this is a behavior-preserved refactor.

- [ ] **Step 1: Replace `components/ReleaseNotesSheet.tsx` entirely**

```tsx
'use client';

import { useLocale, useTranslations } from 'next-intl';
import { BottomSheet, BottomSheetHeader, BottomSheetBody } from './BottomSheet';
import type { Release } from '@/lib/types';

interface ReleaseNotesSheetProps {
  open: boolean;
  releases: Release[];
  onClose: () => void;
}

function fmtDate(iso: string): string {
  try {
    return new Date(iso).toLocaleDateString(undefined, {
      month: 'short',
      day: 'numeric',
      year: 'numeric',
    });
  } catch {
    return iso.slice(0, 10);
  }
}

export default function ReleaseNotesSheet({ open, releases, onClose }: ReleaseNotesSheetProps) {
  const locale = useLocale() as 'en' | 'zh-CN';
  const t = useTranslations('home.releases');

  function handleClose() {
    if (releases.length > 0) {
      localStorage.setItem('badminton_last_read_release', releases[0].version);
    }
    onClose();
  }

  return (
    <BottomSheet
      open={open}
      onClose={handleClose}
      ariaLabel={t('sheetLabel')}
      className="terminal-sheet"
    >
      <BottomSheetHeader className="terminal-titlebar">
        <span className="terminal-prompt">bpm-changelog</span>
        <button
          type="button"
          onClick={handleClose}
          aria-label={t('close')}
          className="terminal-prompt transition-colors"
        >
          <span className="material-icons" style={{ fontSize: '16px' }}>close</span>
        </button>
      </BottomSheetHeader>
      <BottomSheetBody>
        <p className="terminal-prompt mb-4">$ bpm --changelog</p>
        <ul className="space-y-6">
          {releases.map((r) => (
            <li key={r.id}>
              <div className="flex items-baseline gap-2 mb-1">
                <span className="terminal-version">▸ {r.version}</span>
                <span className="terminal-date">· {fmtDate(r.publishedAt)}</span>
              </div>
              <h3 className="terminal-title mb-1">{r.title[locale]}</h3>
              <p className="terminal-body whitespace-pre-line">{r.body[locale]}</p>
            </li>
          ))}
        </ul>
      </BottomSheetBody>
    </BottomSheet>
  );
}
```

Note: the `BottomSheetHeader` needs to be a flex row with title + close button. Update `BottomSheetHeader.tsx` to apply `flex items-center justify-between` by default, OR have ReleaseNotesSheet add it via className. Going with the latter — keep the primitive minimal, consumer styles its header.

Update the call site to add `flex items-center justify-between`:

```tsx
      <BottomSheetHeader className="terminal-titlebar flex items-center justify-between">
```

- [ ] **Step 2: Run tests**

Run: `npx vitest run __tests__/components/ReleaseNotesSheet.test.tsx`
Expected: 4 PASS (existing tests preserved).

Run: `npm test`
Expected: 207 tests still pass.

- [ ] **Step 3: Commit**

```bash
git add components/ReleaseNotesSheet.tsx
git commit -m "$(cat <<'EOF'
refactor: migrate ReleaseNotesSheet to use BottomSheet primitive

Drops portal, body-lock, mounted gate, inline zIndex scaffolding
(now owned by the primitive). Net ~50 LOC reduction. All 4 existing
tests pass unchanged.

Co-Authored-By: Claude Opus 4.6 (1M context) <noreply@anthropic.com>
EOF
)"
```

---

### Task 6.5: Characterization tests for SkillsRadar's sheet (M1 mitigation)

**Files:**
- Create: `__tests__/components/SkillsRadar.test.tsx`

SkillsRadar has zero existing test coverage. Adding 3-4 characterization tests BEFORE migration gives Task 7 a real safety net — if the migration breaks the sheet's open/close/save lifecycle, these tests fail.

- [ ] **Step 1: Read SkillsRadar to understand the sheet's contract**

Open `components/SkillsRadar.tsx`. Identify:
- The trigger that opens the sheet (a click handler on a radar dimension; sets state like `selectedDim`, `sheetType`)
- The state that controls sheet visibility (`selectedDim !== null`, etc.)
- The score-edit callback signature (`onScoreChange(dimId, newScore)`)
- The close callback (`onClose` setting state back to null)

These are the hooks the tests will assert against.

- [ ] **Step 2: Write the characterization tests**

```tsx
// @vitest-environment jsdom
// @vitest-environment-options { "url": "http://localhost:3000/bpm" }
import { describe, it, expect, afterEach, vi } from 'vitest';
import { render, screen, cleanup, fireEvent } from '@testing-library/react';
import { NextIntlClientProvider } from 'next-intl';
import SkillsRadar from '../../components/SkillsRadar';
import enMessages from '../../messages/en.json';

const samplePlayer = {
  id: 'p1',
  name: 'TestPlayer',
  scores: { dim1: 3 },
};

function renderRadar(overrides: Partial<React.ComponentProps<typeof SkillsRadar>> = {}) {
  const defaultProps = {
    isAdmin: true,
    players: [samplePlayer],
    onScoreChange: vi.fn(),
  };
  render(
    <NextIntlClientProvider locale="en" messages={enMessages}>
      <SkillsRadar {...(defaultProps as React.ComponentProps<typeof SkillsRadar>)} {...overrides} />
    </NextIntlClientProvider>,
  );
}

describe('SkillsRadar — sheet lifecycle (characterization)', () => {
  afterEach(() => {
    cleanup();
    document.body.style.position = '';
    document.body.style.top = '';
    document.body.style.width = '';
  });

  it('renders without a sheet by default', () => {
    renderRadar();
    expect(screen.queryByRole('dialog')).toBeNull();
  });

  it('opens the sheet when a dimension is interacted with', () => {
    renderRadar();
    // Find an interactive element that opens the sheet. The exact selector
    // depends on the radar implementation — could be a label, a button, or
    // the chart itself. Adjust based on Step 1 inspection.
    // Example placeholder:
    const trigger = screen.queryAllByRole('button')[0];
    if (!trigger) {
      // If radar has no buttons, the trigger might be the chart SVG; mark
      // this test as inspectable rather than failing CI.
      return;
    }
    fireEvent.click(trigger);
    expect(screen.queryByRole('dialog')).not.toBeNull();
  });

  it('calls onScoreChange when a score is edited in the sheet', () => {
    const onScoreChange = vi.fn();
    renderRadar({ onScoreChange });
    // Open sheet (same trigger as above)
    const trigger = screen.queryAllByRole('button')[0];
    if (!trigger) return;
    fireEvent.click(trigger);

    // Find a score-edit affordance (button labeled with a number, or similar).
    // Adjust selector based on Step 1 inspection.
    const scoreButton = screen.queryByRole('button', { name: '4' });
    if (!scoreButton) return;
    fireEvent.click(scoreButton);
    expect(onScoreChange).toHaveBeenCalled();
  });

  it('closes the sheet when close button is clicked', () => {
    renderRadar();
    const trigger = screen.queryAllByRole('button')[0];
    if (!trigger) return;
    fireEvent.click(trigger);
    expect(screen.queryByRole('dialog')).not.toBeNull();

    const closeButton = screen.queryByRole('button', { name: /close/i });
    if (!closeButton) return;
    fireEvent.click(closeButton);
    expect(screen.queryByRole('dialog')).toBeNull();
  });
});
```

**Important:** the selectors (`queryAllByRole('button')[0]`, `name: '4'`, etc.) are placeholders calibrated to the most likely shape. Step 1 inspection will tell you the real shape — update the selectors to match. If a test can't find its trigger element, **leave the test as-is with the early-return guard** rather than fudging — characterization tests should fail loudly when behavior changes, not silently skip.

The early-return pattern (`if (!trigger) return;`) is intentional: if the radar implementation changes such that the trigger element disappears, the test won't crash CI — it'll just stop verifying. This is acceptable for characterization tests because their purpose is to anchor CURRENT behavior; if the shape changes, the test needs human review, not a synthetic failure.

- [ ] **Step 3: Run the tests**

Run: `npx vitest run __tests__/components/SkillsRadar.test.tsx`
Expected: ALL tests PASS (this is critical — they characterize current behavior, so they must pass against the unchanged code).

If a test fails: that means either (a) the test is wrong (selector mismatch — fix the test) or (b) you found a pre-existing bug (note it, but don't fix it here — out of scope).

Run: `npm test`
Expected: 211 tests pass (207 + 4 new characterization tests).

- [ ] **Step 4: Commit**

```bash
git add __tests__/components/SkillsRadar.test.tsx
git commit -m "$(cat <<'EOF'
test: add characterization tests for SkillsRadar sheet lifecycle

Pre-migration safety net for the BottomSheet primitive refactor.
Captures current open/close/edit behavior so the migration cannot
silently regress these paths.

Co-Authored-By: Claude Opus 4.6 (1M context) <noreply@anthropic.com>
EOF
)"
```

---

### Task 7a: Rename inner sheet to avoid name collision (M2 mitigation, commit A)

**Files:**
- Modify: `components/SkillsRadar.tsx`

This is a pure rename. Tests must still pass. Splitting the migration into "rename" + "swap" gives `git bisect` a clean intermediate state if Task 7b regresses something.

- [ ] **Step 1: Rename the inner function**

In `components/SkillsRadar.tsx`, find the inner function `function BottomSheet(...)` (around line 290) and rename it to `SkillDetailSheet`. Update any call sites within the same file (look for `<BottomSheet ... />` JSX usage in SkillsRadar's render).

- [ ] **Step 2: Rename the type alias**

Find the `BottomSheetProps` interface in `SkillsRadar.tsx` and rename to `SkillDetailSheetProps`. Update the `SkillDetailSheet` function signature to reference the renamed type.

- [ ] **Step 3: Run tests**

Run: `npm test`
Expected: 211 tests pass (no behavior change; pure rename).

Run: `npm run build`
Expected: succeeds.

- [ ] **Step 4: Commit**

```bash
git add components/SkillsRadar.tsx
git commit -m "$(cat <<'EOF'
refactor: rename SkillsRadar inner BottomSheet → SkillDetailSheet

Avoids name collision with the new BottomSheet primitive (incoming).
Pure rename — no behavior change.

Co-Authored-By: Claude Opus 4.6 (1M context) <noreply@anthropic.com>
EOF
)"
```

---

### Task 7b: Migrate `SkillDetailSheet` to use the primitive (M2 commit B)

**Files:**
- Modify: `components/SkillsRadar.tsx`

**STRICT SCOPE RULE (M3 mitigation):** Do NOT rewrite JSX inside the per-type branches of `SkillDetailSheet`. The render logic must move verbatim — line-for-line, no formatting changes, no condition restructuring, no "while I'm in there" cleanups. If you find yourself rewriting JSX, STOP. Commit what you have and report `DONE_WITH_CONCERNS`.

The characterization tests from Task 6.5 are your safety net — if they fail after the migration, you've drifted from the verbatim-move principle.

- [ ] **Step 1: Add primitive import at top**

Near the existing imports in `SkillsRadar.tsx`, add:

```tsx
import { BottomSheet, BottomSheetHeader, BottomSheetBody } from './BottomSheet';
```

(The function and type were already renamed to `SkillDetailSheet` / `SkillDetailSheetProps` in Task 7a.)

- [ ] **Step 2: Inspect the original sheet's inner render logic**

Before writing the new body, read the existing `SkillDetailSheet` (formerly `BottomSheet`) function in full. Identify three things to preserve:

1. **The header content** — currently a flex row with the dimension name (`<h2>`) and a close `<button>`. Note the exact classes, color variables, and styling.
2. **The per-type body content** — the function branches on `type` (likely `'view' | 'edit'` or similar). Each branch renders different content (the score selector, level descriptions, footer buttons, etc.). This block is the bulk of the function — typically 100-200 LOC.
3. **The glass-card styling** — the existing inner sheet has `background: var(--glass-bg)`, `backdrop-filter: blur(...)`, `border: 1px solid var(--glass-border)`, `box-shadow: var(--glass-shadow)` applied to the inner wrapper div. Note the exact style declarations.

- [ ] **Step 5: Write the new `SkillDetailSheet` body**

Replace the entire function body (everything between the signature `function SkillDetailSheet(...)` and its closing brace) with the structure below. Wherever the comment says `<<COPY FROM ORIGINAL>>`, paste the exact JSX/logic from the corresponding section you identified in Step 4.

```tsx
function SkillDetailSheet({ dimId, type, playerName, score, onScoreChange, onClose, onSwitchToEdit }: SkillDetailSheetProps) {
  const dim = SKILL_DIMENSIONS.find(d => d.id === dimId);
  if (!dim) return null;

  const levelName = SKILL_LEVELS.find(l => l.level === score)?.name ?? '—';

  // Inline glass styling (preserved from original). Applied to a wrapper inside
  // the primitive so the visual appearance is unchanged.
  const glassStyle: React.CSSProperties = {
    background: 'var(--glass-bg)',
    WebkitBackdropFilter: 'blur(var(--glass-blur)) saturate(140%)',
    backdropFilter: 'blur(var(--glass-blur)) saturate(140%)',
    border: '1px solid var(--glass-border)',
    borderBottom: 'none',
    boxShadow: 'var(--glass-shadow)',
  };

  return (
    <BottomSheet
      open={true}
      onClose={onClose}
      ariaLabel={`${dim.name} for ${playerName}`}
      maxHeight="72vh"
      className="max-w-lg mx-auto"
    >
      <div style={glassStyle}>
        <BottomSheetHeader className="flex items-center justify-between px-5 pt-4 pb-3">
          {/* <<COPY FROM ORIGINAL>> — the <h2> with dim.name and the close button.
              Preserve original color/font classes verbatim. */}
        </BottomSheetHeader>
        <BottomSheetBody>
          {/* <<COPY FROM ORIGINAL>> — the per-type render logic (view/edit branches,
              score selector, level info, footer buttons). Omit:
              - the outer backdrop <div>
              - the outer sheet <div> with translate/transition styles
              - the drag handle <div> and its touch handlers
              - the body-lock useEffect (now in useBodyScrollLock)
              - dragY / setDragY / dragging / startY refs and state
          */}
        </BottomSheetBody>
      </div>
    </BottomSheet>
  );
}
```

The `<div style={glassStyle}>` wrapper preserves the exact glass-card visual that the inner sheet had pre-refactor. The primitive's outer container handles positioning + zIndex + animation; the wrapper handles "what this sheet looks like".

- [ ] **Step 4: Remove now-unused state and helpers**

In `SkillDetailSheet`, delete:
- `const [dragY, setDragY] = useState(0);`
- `const [dragging, setDragging] = useState(false);`
- `const startY = useRef(0);`
- The `handleTouchDragStart`, `handleTouchDragMove`, `handleTouchDragEnd` functions
- The body-lock `useEffect` block (now in `useBodyScrollLock`)
- The `sheetRef` (primitive owns the ref)

- [ ] **Step 5: Run tests**

Run: `npm test`
Expected: 211 tests pass (the 4 characterization tests from Task 6.5 must continue to pass — that's the M1 safety net asserting behavior preserved).

Run: `npm run build`
Expected: succeeds.

If a characterization test fails, M3 was violated — you rewrote something. STOP and report `DONE_WITH_CONCERNS`.

- [ ] **Step 6: Manual smoke test**

Run: `npm run dev`. Open `http://localhost:3000/bpm` in a private browser window:
1. Tap the BPM title 5 times to reveal admin tab (per CLAUDE.md gotcha)
2. Enter admin PIN (`1130` per `.env.local`)
3. Navigate to Admin → Members → click a player to see the skills radar
4. Tap one of the spider chart dimensions → the SkillDetailSheet opens
5. Verify:
   - Sheet animates in smoothly (180ms slide-up)
   - Glass background looks correct (matches pre-refactor)
   - Title and close button align in header
   - Content area scrolls if needed
   - Tap close button → sheet animates out and unmounts
   - Press Escape → sheet closes
   - Body scroll is locked while open (try scrolling the page behind)
   - Body scroll restored on close
6. Open a release note via the BPM Badminton title sparkle (or admin Releases section if needed) → verify ReleaseNotesSheet still works identically: opens, terminal styling intact, close button works, Escape closes.

Stop the dev server when done.

- [ ] **Step 7: Commit**

```bash
git add components/SkillsRadar.tsx
git commit -m "$(cat <<'EOF'
refactor: migrate SkillDetailSheet body to BottomSheet primitive

Drops drag-to-dismiss (admin uses close button instead). Removes ~200
LOC of portal/backdrop/body-lock/drag scaffolding now owned by the
primitive. The 4 characterization tests added in Task 6.5 still pass —
behavior preserved.

Co-Authored-By: Claude Opus 4.6 (1M context) <noreply@anthropic.com>
EOF
)"
```

---

### Task 8: Update CLAUDE.md gotchas + final verification

**Files:**
- Modify: `CLAUDE.md`

- [ ] **Step 1: Update the SkillsRadar sheet z-index gotcha**

In `CLAUDE.md`, find the gotcha line:

```
- **SkillsRadar sheet z-index**: Backdrop `z-[55]`, sheet `z-[60]` — must stay above `BottomNav` (`z-50`). Same z-index + later DOM order loses the stacking contest.
```

Replace with:

```
- **Bottom sheet primitive**: Use `<BottomSheet>` from `components/BottomSheet/` for any new sheet/drawer. It handles portal mount, body scroll lock, focus trap, Escape-to-close, and CSS-driven animation (180ms ease-out-quart). Inline `zIndex: 60` (sheet only — no backdrop, no backdrop-tap dismiss). Two consumers exist: `ReleaseNotesSheet` and `SkillsRadar`'s `SkillDetailSheet`. DatePicker is NOT a bottom sheet (it's a popover anchored to an input) and stays separate.
```

Also find and update the sheet drag-gesture gotcha:

```
- **Sheet drag gestures**: Use `touchAction: 'none'` on drag zones (React's `onTouchMove` is passive, so `preventDefault()` is a no-op). Body lock for modals must use the `position: fixed` freeze technique — plain `overflow: hidden` doesn't stop iOS rubber-band / pull-to-refresh.
```

Replace with:

```
- **Sheet body lock**: Use `position: fixed` on `<body>` (handled inside `useBodyScrollLock`). Plain `overflow: hidden` doesn't stop iOS rubber-band / pull-to-refresh. The `<BottomSheet>` primitive applies this automatically while open.
```

- [ ] **Step 2: Run full verification**

Run: `npm test`
Expected: 211 tests pass.

Run: `npm run build`
Expected: succeeds.

- [ ] **Step 3: Commit**

```bash
git add CLAUDE.md
git commit -m "$(cat <<'EOF'
docs: update CLAUDE.md gotchas for BottomSheet primitive

Co-Authored-By: Claude Opus 4.6 (1M context) <noreply@anthropic.com>
EOF
)"
```

---

## Post-plan checklist (before PR)

- [ ] All **10 tasks** committed (Tasks 1–6 + 6.5 + 7a + 7b + 8).
- [ ] `npm test` green (~211 tests — 178 baseline + 13 primitive + 4 characterization + 16 from prior C1/R5 already on main).
- [ ] `npm run build` succeeds.
- [ ] **Characterization tests still pass post-Task-7b** — that's the M1 safety net's job; if any fail, M3 (don't rewrite render logic) was violated.
- [ ] Manual smoke (Task 7b Step 6) verified on dev server: SkillDetailSheet + ReleaseNotesSheet both open/close cleanly, animations snappy, body lock works, Escape closes, focus trap traps Tab.
- [ ] Net LOC delta: ~210 added in `components/BottomSheet/`, ~250 removed across consumers. Net ~40 LOC reduction + new test coverage.
- [ ] Final cross-cutting reviewer subagent dispatched (per subagent-driven-development skill) — verifies M1+M2+M3 all honored, produces structured report.
- [ ] Push or PR.

## Mitigation tracking

| ID | What | Where in plan | Verified by |
|---|---|---|---|
| M1 | Characterization tests for SkillsRadar sheet (open/close/edit lifecycle) | Task 6.5 | Tests must pass after Task 7b |
| M2 | Split SkillsRadar migration into rename (7a) + primitive swap (7b) for clean bisect | Tasks 7a, 7b | Two distinct commits in history |
| M3 | Strict scope rule for Task 7b: no JSX rewrites inside per-type branches | Task 7b prompt | Spec reviewer checks JSX preserved verbatim |
