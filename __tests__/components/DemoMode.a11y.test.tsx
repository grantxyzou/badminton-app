// @vitest-environment jsdom
import { describe, it, expect, vi, afterEach } from 'vitest';
import { render, screen, cleanup, fireEvent } from '@testing-library/react';
import DemoMode from '@/components/DemoMode';

afterEach(() => cleanup());

describe('DemoMode — modal a11y', () => {
  it('moves focus into the dialog on open (focus trap wiring)', () => {
    render(<DemoMode onClose={vi.fn()} />);
    const dialog = screen.getByRole('dialog');
    expect(dialog.contains(document.activeElement)).toBe(true);
  });

  it('Escape closes the dialog', () => {
    const onClose = vi.fn();
    render(<DemoMode onClose={onClose} />);
    fireEvent.keyDown(window, { key: 'Escape' });
    expect(onClose).toHaveBeenCalled();
  });
});
