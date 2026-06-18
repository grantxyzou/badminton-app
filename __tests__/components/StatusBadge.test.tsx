// @vitest-environment jsdom
import { describe, it, expect, afterEach } from 'vitest';
import { render, screen, cleanup } from '@testing-library/react';
import StatusBadge from '../../components/primitives/StatusBadge';

describe('StatusBadge', () => {
  afterEach(() => {
    cleanup();
  });

  it('renders its label', () => {
    render(<StatusBadge>Beta</StatusBadge>);
    expect(screen.getByText('Beta')).toBeTruthy();
  });

  it('accent variant (default) uses the accent token, pill radius, no hardcoded hex border', () => {
    render(<StatusBadge>Live</StatusBadge>);
    const style = screen.getByText('Live').getAttribute('style') ?? '';
    expect(style).toContain('var(--accent');
    expect(style).toContain('var(--radius-pill)');
  });

  it('muted variant uses the muted tokens', () => {
    render(<StatusBadge variant="muted">Coming soon</StatusBadge>);
    const style = screen.getByText('Coming soon').getAttribute('style') ?? '';
    expect(style).toContain('var(--inner-card-border)');
    expect(style).toContain('var(--text-muted)');
  });

  it('phase variant tones: amber for switch, accent otherwise', () => {
    render(<StatusBadge variant="phase" tone="amber">Switch</StatusBadge>);
    expect(screen.getByText('Switch').getAttribute('style') ?? '').toContain('var(--accent-amber)');
    cleanup();
    render(<StatusBadge variant="phase" tone="accent">Refine</StatusBadge>);
    expect(screen.getByText('Refine').getAttribute('style') ?? '').toContain('var(--accent)');
  });
});
