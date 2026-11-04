// @vitest-environment jsdom
import { describe, it, expect, afterEach, beforeEach, vi } from 'vitest';
import { render, screen, cleanup, fireEvent } from '@testing-library/react';
import { NextIntlClientProvider } from 'next-intl';
import enMessages from '../../messages/en.json';
import type { PushState } from '../../lib/usePush';

const env = vi.hoisted(() => ({ native: false, migrate: true, installUp: false, state: { status: 'off' } as PushState }));
const enable = vi.fn(async () => {});

vi.mock('../../lib/native', () => ({ isNative: () => env.native }));
vi.mock('../../lib/flags', () => ({ isFlagOn: () => env.migrate }));
vi.mock('../../lib/useOnline', () => ({ useOnline: () => true }));
vi.mock('../../lib/usePush', () => ({
  usePush: () => ({ state: env.state, enable, disable: vi.fn(), busy: false, error: null }),
}));
vi.mock('../../components/InstallBanner', () => ({ shouldNudge: () => env.installUp }));
vi.mock('../../components/MigrateSheet', () => ({
  default: ({ open }: { open: boolean }) => (open ? <div>migrate-sheet</div> : null),
}));

import PushNudge, { PUSH_NUDGE_KEY } from '../../components/PushNudge';

function renderNudge() {
  return render(
    <NextIntlClientProvider locale="en" messages={enMessages}>
      <PushNudge />
    </NextIntlClientProvider>,
  );
}

describe('PushNudge', () => {
  beforeEach(() => {
    localStorage.clear();
    env.native = false;
    env.migrate = true;
    env.installUp = false;
    env.state = { status: 'off' };
    enable.mockClear();
  });
  afterEach(() => cleanup());

  it('in the store app with push off, turns notifications on and never shows again', () => {
    env.native = true;
    renderNudge();
    expect(screen.getByText('Get a ping when sign-ups open')).toBeTruthy();
    fireEvent.click(screen.getByRole('button', { name: 'Turn on notifications →' }));
    expect(enable).toHaveBeenCalledTimes(1);
    expect(localStorage.getItem(PUSH_NUDGE_KEY)).toBe('1');
    expect(screen.queryByText('Get a ping when sign-ups open')).toBeNull();
  });

  it.each(['on', 'denied', 'loading'] as const)('in the store app shows nothing when push is %s', (status) => {
    env.native = true;
    env.state = { status } as PushState;
    const { container } = renderNudge();
    expect(container.textContent).toBe('');
  });

  it('on the web points to the app and keeps the sheet open after remembering', () => {
    renderNudge();
    fireEvent.click(screen.getByRole('button', { name: 'Get the app →' }));
    expect(localStorage.getItem(PUSH_NUDGE_KEY)).toBe('1');
    expect(screen.getByText('migrate-sheet')).toBeTruthy();
    expect(screen.queryByRole('button', { name: 'Get the app →' })).toBeNull();
  });

  it('on the web shows nothing while the migration link is off', () => {
    env.migrate = false;
    renderNudge();
    expect(screen.queryByRole('button', { name: 'Get the app →' })).toBeNull();
  });

  it('on the web waits while the install banner is up — one nudge at a time', () => {
    env.installUp = true;
    renderNudge();
    expect(screen.queryByRole('button', { name: 'Get the app →' })).toBeNull();
    expect(localStorage.getItem(PUSH_NUDGE_KEY)).toBeNull();
  });

  it('in the store app is not held back by the install banner', () => {
    env.native = true;
    env.installUp = true;
    renderNudge();
    expect(screen.getByText('Get a ping when sign-ups open')).toBeTruthy();
  });

  it('dismissing is remembered', () => {
    renderNudge();
    fireEvent.click(screen.getByRole('button', { name: 'Dismiss' }));
    expect(localStorage.getItem(PUSH_NUDGE_KEY)).toBe('1');
    cleanup();
    renderNudge();
    expect(screen.queryByRole('button', { name: 'Get the app →' })).toBeNull();
  });
});
