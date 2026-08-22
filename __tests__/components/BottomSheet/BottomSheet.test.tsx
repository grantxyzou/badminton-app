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
    const header = document.body.querySelector('[role="dialog"] > div')!;
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
    const body = document.body.querySelector('[role="dialog"] > div')!;
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
    const header = document.body.querySelector('[role="dialog"] > div')!;
    expect(header.className).toBe('terminal-titlebar');
    expect(header.className).not.toContain('px-5');
  });

  it('bare body keeps the scroll contract but drops padding', () => {
    render(
      <BottomSheet open onClose={vi.fn()} ariaLabel="Test sheet">
        <BottomSheetBody bare>content</BottomSheetBody>
      </BottomSheet>,
    );
    const body = document.body.querySelector('[role="dialog"] > div')!;
    expect(body.className).toContain('overflow-y-auto');
    expect(body.className).not.toContain('p-5');
  });

  it('width maps to a max-width class, default being the reading width', () => {
    const { rerender } = render(
      <BottomSheet open onClose={vi.fn()} ariaLabel="Test sheet">
        <BottomSheetBody>content</BottomSheetBody>
      </BottomSheet>,
    );
    expect(document.body.querySelector('[role="dialog"]')!.className).toContain('max-w-lg');

    rerender(
      <BottomSheet open onClose={vi.fn()} ariaLabel="Test sheet" width="narrow">
        <BottomSheetBody>content</BottomSheetBody>
      </BottomSheet>,
    );
    expect(document.body.querySelector('[role="dialog"]')!.className).toContain('max-w-sm');

    rerender(
      <BottomSheet open onClose={vi.fn()} ariaLabel="Test sheet" width="full">
        <BottomSheetBody>content</BottomSheetBody>
      </BottomSheet>,
    );
    const cls = document.body.querySelector('[role="dialog"]')!.className;
    expect(cls).not.toContain('max-w-lg');
    expect(cls).not.toContain('max-w-sm');
  });
});
