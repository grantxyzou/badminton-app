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
