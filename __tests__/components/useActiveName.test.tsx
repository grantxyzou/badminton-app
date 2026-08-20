// @vitest-environment jsdom
import { describe, it, expect, afterEach, beforeEach } from 'vitest';
import { render, screen, cleanup, act } from '@testing-library/react';
import { useActiveName, STATS_PREVIEW_NAME_KEY } from '../../lib/useActiveName';
import { setIdentity, clearIdentity } from '../../lib/identity';

function Probe() {
  const { name, resolved } = useActiveName();
  return (
    <div>
      <span data-testid="name">{name ?? '(none)'}</span>
      <span data-testid="resolved">{String(resolved)}</span>
    </div>
  );
}

describe('useActiveName', () => {
  beforeEach(() => {
    localStorage.clear();
  });
  afterEach(() => {
    cleanup();
    localStorage.clear();
  });

  it('prefers a real identity over a preview name', () => {
    setIdentity({ name: 'Lin', token: 'tok', sessionId: 'session-2026-08-20' });
    localStorage.setItem(STATS_PREVIEW_NAME_KEY, 'Viktor');
    render(<Probe />);
    expect(screen.getByTestId('name').textContent).toBe('Lin');
  });

  it('falls back to the preview name when there is no identity', () => {
    localStorage.setItem(STATS_PREVIEW_NAME_KEY, 'Viktor');
    render(<Probe />);
    expect(screen.getByTestId('name').textContent).toBe('Viktor');
  });

  it('resolves to nobody when neither is set', () => {
    render(<Probe />);
    expect(screen.getByTestId('name').textContent).toBe('(none)');
    // Still resolved — "nobody" is a known answer, not an unknown one.
    expect(screen.getByTestId('resolved').textContent).toBe('true');
  });

  it('ignores a blank or whitespace-only preview name', () => {
    localStorage.setItem(STATS_PREVIEW_NAME_KEY, '   ');
    render(<Probe />);
    expect(screen.getByTestId('name').textContent).toBe('(none)');
  });

  it('trims the preview name', () => {
    localStorage.setItem(STATS_PREVIEW_NAME_KEY, '  Akane  ');
    render(<Probe />);
    expect(screen.getByTestId('name').textContent).toBe('Akane');
  });

  it('updates on sign-in in the SAME tab via IDENTITY_EVENT', () => {
    render(<Probe />);
    expect(screen.getByTestId('name').textContent).toBe('(none)');
    act(() => {
      setIdentity({ name: 'Kento', token: 'tok', sessionId: 'session-2026-08-20' });
    });
    expect(screen.getByTestId('name').textContent).toBe('Kento');
  });

  it('updates on sign-out in the SAME tab', () => {
    setIdentity({ name: 'Sindhu', token: 'tok', sessionId: 'session-2026-08-20' });
    render(<Probe />);
    expect(screen.getByTestId('name').textContent).toBe('Sindhu');
    act(() => {
      clearIdentity();
    });
    expect(screen.getByTestId('name').textContent).toBe('(none)');
  });
});
