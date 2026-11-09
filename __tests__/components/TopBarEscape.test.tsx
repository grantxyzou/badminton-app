// @vitest-environment jsdom
import { afterEach, describe, expect, it, vi } from 'vitest';
import { cleanup, render } from '@testing-library/react';
import TopBar from '@/components/primitives/TopBar';

/**
 * Escape on a page goes Back, unless an open sheet already answered it: the
 * sheet listens on document and marks the key handled, so Escape closes the
 * sheet and leaves the page under it where it is.
 */
afterEach(cleanup);

describe('TopBar Escape', () => {
  it('goes back on a bare Escape', () => {
    const onBack = vi.fn();
    render(<TopBar title="Page" onBack={onBack} />);
    window.dispatchEvent(new KeyboardEvent('keydown', { key: 'Escape' }));
    expect(onBack).toHaveBeenCalledOnce();
  });

  it('leaves the page alone when a sheet handled the Escape', () => {
    const onBack = vi.fn();
    render(<TopBar title="Page" onBack={onBack} />);
    const sheet = (e: KeyboardEvent) => e.preventDefault();
    document.addEventListener('keydown', sheet);
    try {
      document.dispatchEvent(new KeyboardEvent('keydown', { key: 'Escape', bubbles: true, cancelable: true }));
    } finally {
      document.removeEventListener('keydown', sheet);
    }
    expect(onBack).not.toHaveBeenCalled();
  });
});
