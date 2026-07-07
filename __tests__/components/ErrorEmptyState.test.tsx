// @vitest-environment jsdom
import { describe, it, expect, afterEach } from 'vitest';
import { render, screen, cleanup } from '@testing-library/react';
import ErrorState from '../../components/primitives/ErrorState';
import EmptyState from '../../components/primitives/EmptyState';

describe('ErrorState', () => {
  afterEach(() => cleanup());

  it('renders the message with role=alert (legible-fail contract)', () => {
    render(<ErrorState message="Couldn't load" />);
    const el = screen.getByRole('alert');
    expect(el.textContent).toBe("Couldn't load");
    expect(el.className).toContain('field-error');
  });
});

describe('EmptyState', () => {
  afterEach(() => cleanup());

  it('renders muted body copy on the --fs-base token, not role=alert', () => {
    render(<EmptyState>No data yet</EmptyState>);
    const el = screen.getByText('No data yet');
    expect(el.className).toContain('fs-base');
    expect(el.getAttribute('style') ?? '').toContain('var(--text-muted)');
    // empty != error: must not masquerade as an alert
    expect(screen.queryByRole('alert')).toBeNull();
  });
});
