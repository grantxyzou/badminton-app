// @vitest-environment jsdom
import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import { render, screen, cleanup, fireEvent } from '@testing-library/react';
import PreviewBanner from '@/components/PreviewBanner';

beforeEach(() => {
  process.env.NEXT_PUBLIC_ENV = 'next'; // PreviewBanner only renders in preview env
});
afterEach(() => {
  cleanup();
  delete process.env.NEXT_PUBLIC_ENV;
});

describe('PreviewBanner report menu — a11y', () => {
  const openMenu = () =>
    fireEvent.click(screen.getByRole('button', { name: /report a bug/i }));

  it('moves focus into the menu on open (focus management)', () => {
    render(<PreviewBanner />);
    openMenu();
    const menu = screen.getByRole('menu');
    expect(menu.contains(document.activeElement)).toBe(true);
  });

  it('Escape closes the menu', () => {
    render(<PreviewBanner />);
    openMenu();
    expect(screen.queryByRole('menu')).not.toBeNull();
    fireEvent.keyDown(window, { key: 'Escape' });
    expect(screen.queryByRole('menu')).toBeNull();
  });
});
