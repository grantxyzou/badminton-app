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

  // With a way out it is the standing icon-over-text state, and NEUTRAL: a
  // server that did not answer is not the person's mistake (Grant,
  // 2026-11-11, "should not be red"). Red stays on the inline form above.
  it('with a "Try again", stands as icon over text, not in red', () => {
    render(<ErrorState message="Couldn't load your rackets." action={<button type="button">Try again</button>} />);
    const el = screen.getByRole('alert');
    expect(el.textContent).toBe("Couldn't load your rackets.");
    expect(el.className).toBe('error-state__message');
    expect(el.className).not.toContain('field-error');
    const icon = el.parentElement!.querySelector('.material-icons');
    expect(icon?.textContent?.trim()).toBe('cloud_off');
    expect(icon?.getAttribute('aria-hidden')).toBe('true');
    expect(screen.getByRole('button', { name: 'Try again' })).toBeDefined();
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
