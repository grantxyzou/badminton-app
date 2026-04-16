// @vitest-environment jsdom
// @vitest-environment-options { "url": "http://localhost:3000/bpm" }
import { describe, it, expect, afterEach, vi } from 'vitest';
import { render, screen, cleanup, fireEvent, waitFor } from '@testing-library/react';
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
