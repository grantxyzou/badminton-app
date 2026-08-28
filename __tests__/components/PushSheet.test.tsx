// @vitest-environment jsdom
import { describe, it, expect, afterEach, vi, beforeEach } from 'vitest';
import { render, screen, cleanup } from '@testing-library/react';
import { NextIntlClientProvider } from 'next-intl';
import enMessages from '../../messages/en.json';
import PushSheet from '../../components/PushSheet';
import type { UsePushResult, PushState } from '../../lib/usePush';

/**
 * The sheet's job is to be HONEST about each terminal state — a user who can
 * act is told how, and a user who cannot is told plainly rather than being
 * shown a button that silently does nothing.
 */

const online = vi.fn(() => true);
vi.mock('@/lib/useOnline', () => ({ useOnline: () => online() }));

// Vitest globals aren't configured, so cleanup is manual (several cases render
// overlapping text).
afterEach(() => cleanup());

function makePush(state: PushState, overrides: Partial<UsePushResult> = {}): UsePushResult {
  return {
    state,
    enable: vi.fn(),
    disable: vi.fn(),
    busy: false,
    error: null,
    ...overrides,
  };
}

function renderSheet(push: UsePushResult, onOpenInstall = vi.fn()) {
  return render(
    <NextIntlClientProvider locale="en" messages={enMessages}>
      <PushSheet open onClose={vi.fn()} onOpenInstall={onOpenInstall} push={push} />
    </NextIntlClientProvider>,
  );
}

describe('PushSheet', () => {
  beforeEach(() => {
    online.mockReturnValue(true);
  });

  it('offers a turn-on button when off', () => {
    renderSheet(makePush({ status: 'off' }));
    expect((screen.getByRole('button', { name: /turn on notifications/i }) as HTMLButtonElement).disabled).toBe(false);
  });

  it('offers a turn-off button when on', () => {
    renderSheet(makePush({ status: 'on' }));
    expect((screen.getByRole('button', { name: /turn off notifications/i }) as HTMLButtonElement).disabled).toBe(false);
  });

  it('renders the blocked dead end with NO action button', () => {
    // requestPermission() resolves 'denied' immediately without prompting —
    // offering a button here would be a lie.
    renderSheet(makePush({ status: 'denied' }));
    expect(screen.getByText(/blocked for BPM in your browser settings/i)).toBeDefined();
    expect(screen.queryByRole('button', { name: /turn on notifications/i })).toBeNull();
  });

  it('gives iOS browser-tab users an actionable install CTA', () => {
    const onOpenInstall = vi.fn();
    renderSheet(makePush({ status: 'unsupported', reason: 'ios-not-installed' }), onOpenInstall);

    expect(screen.getByText(/only work once BPM is on your Home Screen/i)).toBeDefined();
    const cta = screen.getByRole('button', { name: /show me how/i });
    cta.click();
    expect(onOpenInstall).toHaveBeenCalled();
  });

  it('does not offer an install CTA for a genuinely unsupported browser', () => {
    renderSheet(makePush({ status: 'unsupported', reason: 'no-push' }));
    expect(screen.queryByRole('button', { name: /show me how/i })).toBeNull();
    expect(screen.getByText(/can't do notifications/i)).toBeDefined();
  });

  it('says so plainly when the server has no VAPID keys', () => {
    renderSheet(makePush({ status: 'unsupported', reason: 'not-configured' }));
    expect(screen.getByText(/aren't set up on this server yet/i)).toBeDefined();
  });

  it('disables the toggle while offline and explains why', () => {
    online.mockReturnValue(false);
    renderSheet(makePush({ status: 'off' }));

    expect((screen.getByRole('button', { name: /turn on notifications/i }) as HTMLButtonElement).disabled).toBe(true);
    expect(screen.getByText(/You're offline/i)).toBeDefined();
  });

  it('disables the toggle while a request is in flight', () => {
    renderSheet(makePush({ status: 'off' }, { busy: true }));
    expect((screen.getByRole('button', { name: /just a moment/i }) as HTMLButtonElement).disabled).toBe(true);
  });

  it('surfaces a sign-in error as recovery advice', () => {
    renderSheet(makePush({ status: 'off' }, { error: 'auth' }));
    const alert = screen.getByRole('alert');
    expect(alert.textContent).toMatch(/Sign in first/i);
  });

  it('shows a neutral checking state while probing', () => {
    renderSheet(makePush({ status: 'loading' }));
    expect(screen.getByText(/checking/i)).toBeDefined();
    expect(screen.queryByRole('button', { name: /turn on/i })).toBeNull();
  });
});
