// @vitest-environment jsdom
// @vitest-environment-options { "url": "http://localhost:3000/bpm" }
import { describe, it, expect, afterEach, vi } from 'vitest';
import { render, screen, cleanup, fireEvent, waitFor } from '@testing-library/react';
import { BottomSheet, BottomSheetBody, BottomSheetHeader } from '../../../components/BottomSheet';

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

  it('Escape still closes when closeOnEscape is omitted (default for every existing sheet)', () => {
    const onClose = vi.fn();
    render(
      <BottomSheet open={true} onClose={onClose} ariaLabel="x">
        <BottomSheetBody>content</BottomSheetBody>
      </BottomSheet>,
    );
    fireEvent.keyDown(document, { key: 'Escape' });
    expect(onClose).toHaveBeenCalledTimes(1);
  });

  it('closeOnEscape={false} makes the sheet un-dismissible by Escape', () => {
    // Opt-in only, for a sheet that must be ANSWERED rather than dismissed.
    const onClose = vi.fn();
    render(
      <BottomSheet open={true} onClose={onClose} ariaLabel="x" closeOnEscape={false}>
        <BottomSheetBody>content</BottomSheetBody>
      </BottomSheet>,
    );
    fireEvent.keyDown(document, { key: 'Escape' });
    expect(onClose).not.toHaveBeenCalled();
    expect(document.body.querySelector('[role="dialog"]')).not.toBeNull();
  });

  it('does NOT render a backdrop element (close icon + Escape only per spec)', () => {
    const onClose = vi.fn();
    render(
      <BottomSheet open={true} onClose={onClose} ariaLabel="x">
        <BottomSheetBody>content</BottomSheetBody>
      </BottomSheet>,
    );
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

  it('restores body scroll when closed', async () => {
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
    // Wait for state machine to reach 'closed' (220ms safety net, since
    // jsdom does not fire CSS transitionend events).
    await waitFor(
      () => {
        expect(document.body.style.position).toBe('');
      },
      { timeout: 500 },
    );
  });
});

describe('BottomSheet — baked-in defaults (issue #87)', () => {
  afterEach(cleanup);

  // These defaults used to be the consumer's job. 23 sheets each re-deciding
  // them meant two shipped with no header padding at all, and nothing caught
  // it — there was nothing to catch it against. That is what these pin.

  it('header carries the default layout + padding with no className', () => {
    render(
      <BottomSheet open onClose={vi.fn()} ariaLabel="Test sheet">
        <BottomSheetHeader>title</BottomSheetHeader>
      </BottomSheet>,
    );
    const header = document.body.querySelector('[role="dialog"] > div:not(.bottom-sheet-grab)')!;
    expect(header.className).toContain('px-5');
    expect(header.className).toContain('pt-4');
    expect(header.className).toContain('pb-3');
    expect(header.className).toContain('justify-between');
  });

  it('body carries the default padding with no className', () => {
    render(
      <BottomSheet open onClose={vi.fn()} ariaLabel="Test sheet">
        <BottomSheetBody>content</BottomSheetBody>
      </BottomSheet>,
    );
    const body = document.body.querySelector('[role="dialog"] > div:not(.bottom-sheet-grab)')!;
    expect(body.className).toContain('p-5');
    expect(body.className).toContain('pb-8');
    // The scroll contract must survive alongside the padding.
    expect(body.className).toContain('overflow-y-auto');
    expect(body.className).toContain('min-h-0');
  });

  it('bare drops the defaults so a real variant is not fighting them', () => {
    render(
      <BottomSheet open onClose={vi.fn()} ariaLabel="Test sheet">
        <BottomSheetHeader bare className="terminal-titlebar">title</BottomSheetHeader>
      </BottomSheet>,
    );
    const header = document.body.querySelector('[role="dialog"] > div:not(.bottom-sheet-grab)')!;
    expect(header.className).toBe('terminal-titlebar');
    expect(header.className).not.toContain('px-5');
  });

  it('bare body keeps the scroll contract but drops padding', () => {
    render(
      <BottomSheet open onClose={vi.fn()} ariaLabel="Test sheet">
        <BottomSheetBody bare>content</BottomSheetBody>
      </BottomSheet>,
    );
    const body = document.body.querySelector('[role="dialog"] > div:not(.bottom-sheet-grab)')!;
    expect(body.className).toContain('overflow-y-auto');
    expect(body.className).not.toContain('p-5');
  });

  // One size for every sheet: the primitive sets no size of its own, so the
  // width and height cap come only from `.bottom-sheet` in globals.css
  // (jsdom applies no stylesheet — sheet-size-canary pins the CSS itself).
  it('sets no width class and no inline height cap — the size is the stylesheet\'s', () => {
    render(
      <BottomSheet open onClose={vi.fn()} ariaLabel="Test sheet" className="terminal-sheet">
        <BottomSheetBody>content</BottomSheetBody>
      </BottomSheet>,
    );
    const dialog = document.body.querySelector('[role="dialog"]') as HTMLElement;
    expect(dialog.className).toContain('bottom-sheet');
    expect(dialog.className).toContain('terminal-sheet');
    expect(dialog.className).not.toMatch(/max-w-|mx-auto/);
    expect(dialog.style.maxHeight).toBe('');
  });
});

describe('BottomSheet — drag to dismiss', () => {
  afterEach(cleanup);

  /** jsdom has no pointer-capture and no layout; supply both. */
  function openSheet(onClose = vi.fn()) {
    render(
      <BottomSheet open onClose={onClose} ariaLabel="Test sheet">
        <BottomSheetHeader>title</BottomSheetHeader>
        <BottomSheetBody>content</BottomSheetBody>
      </BottomSheet>,
    );
    const sheet = document.body.querySelector('[role="dialog"]') as HTMLElement;
    sheet.setPointerCapture = vi.fn();
    sheet.releasePointerCapture = vi.fn();
    // 600px tall: a quarter of it (150) clears the 88px floor, so the fraction
    // is what these cases are actually testing.
    vi.spyOn(sheet, 'getBoundingClientRect').mockReturnValue({ height: 600 } as DOMRect);
    return { sheet, onClose, grab: sheet.querySelector('.bottom-sheet-grab') as HTMLElement };
  }

  /** One gesture: down on `from`, a move per [y, ms] step, then up. The clock
   *  is driven rather than waited on — velocity is what separates a flick from
   *  a slow drag, and a synthetic event's own timeStamp cannot be set. */
  function drag(sheet: HTMLElement, from: HTMLElement, steps: Array<[number, number]>) {
    const clock = vi.spyOn(performance, 'now');
    clock.mockReturnValue(0);
    fireEvent.pointerDown(from, { pointerId: 1, clientY: 0 });
    let last: [number, number] = [0, 0];
    for (const [y, t] of steps) {
      clock.mockReturnValue(t);
      fireEvent.pointerMove(sheet, { pointerId: 1, clientY: y });
      last = [y, t];
    }
    fireEvent.pointerUp(sheet, { pointerId: 1, clientY: last[0] });
    clock.mockRestore();
  }

  it('a slow drag past a quarter of the sheet dismisses it', () => {
    const { sheet, grab, onClose } = openSheet();
    drag(sheet, grab, [[60, 100], [120, 200], [200, 400]]);
    expect(onClose).toHaveBeenCalledTimes(1);
  });

  it('a short drag springs back and dismisses nothing', () => {
    const { sheet, grab, onClose } = openSheet();
    drag(sheet, grab, [[20, 100], [40, 300], [50, 600]]);
    expect(onClose).not.toHaveBeenCalled();
    // Back under CSS control, not pinned where the finger left it.
    expect(sheet.style.transform).toBe('');
    expect(sheet.dataset.dragging).toBeUndefined();
  });

  it('a flick dismisses even though it never travelled far', () => {
    const { sheet, grab, onClose } = openSheet();
    // 60px in 50ms = 1.2px/ms, well past FLICK_VELOCITY, and nowhere near 150px.
    drag(sheet, grab, [[10, 10], [70, 60]]);
    expect(onClose).toHaveBeenCalledTimes(1);
  });

  it('follows the finger while dragging, and upward drags resist', () => {
    const { sheet, grab } = openSheet();
    fireEvent.pointerDown(grab, { pointerId: 1, clientY: 0, timeStamp: 0 });
    fireEvent.pointerMove(sheet, { pointerId: 1, clientY: 100, timeStamp: 100 });
    expect(sheet.style.transform).toBe('translateY(100px)');
    expect(sheet.dataset.dragging).toBe('true');
    fireEvent.pointerMove(sheet, { pointerId: 1, clientY: -100, timeStamp: 200 });
    // Rubber-banded, not followed: a sheet does not go up.
    expect(sheet.style.transform).toBe('translateY(-18px)');
  });

  it('the body is not a grab surface — it is the scroller', () => {
    const { sheet, onClose } = openSheet();
    const body = sheet.querySelector('.overflow-y-auto') as HTMLElement;
    drag(sheet, body, [[200, 100], [400, 300]]);
    expect(onClose).not.toHaveBeenCalled();
    expect(sheet.style.transform).toBe('');
  });

  it('a sheet that must be ANSWERED has no grabber and cannot be dragged', () => {
    const onClose = vi.fn();
    render(
      <BottomSheet open onClose={onClose} ariaLabel="Consent" closeOnEscape={false}>
        <BottomSheetHeader>title</BottomSheetHeader>
      </BottomSheet>,
    );
    const sheet = document.body.querySelector('[role="dialog"]') as HTMLElement;
    sheet.setPointerCapture = vi.fn();
    vi.spyOn(sheet, 'getBoundingClientRect').mockReturnValue({ height: 600 } as DOMRect);
    expect(sheet.querySelector('.bottom-sheet-grab')).toBeNull();
    drag(sheet, sheet.querySelector('[data-sheet-grab]') as HTMLElement, [[300, 100], [500, 300]]);
    expect(onClose).not.toHaveBeenCalled();
  });
});
