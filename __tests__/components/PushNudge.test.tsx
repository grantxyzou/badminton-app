// @vitest-environment jsdom
import { describe, it, expect, afterEach, beforeEach, vi } from 'vitest';
import { render, screen, cleanup, fireEvent } from '@testing-library/react';
import { NextIntlClientProvider } from 'next-intl';
import enMessages from '../../messages/en.json';
import type { PushState } from '../../lib/usePush';

const env = vi.hoisted(() => ({ native: false, migrate: true, state: { status: 'off' } as PushState }));
const enable = vi.fn(async () => {});

vi.mock('../../lib/native', () => ({ isNative: () => env.native }));
vi.mock('../../lib/flags', () => ({ isFlagOn: () => env.migrate }));
vi.mock('../../lib/useOnline', () => ({ useOnline: () => true }));
vi.mock('../../lib/usePush', () => ({
  usePush: () => ({ state: env.state, enable, disable: vi.fn(), busy: false, error: null }),
}));
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
    env.state = { status: 'off' };
    enable.mockClear();
  });
  afterEach(() => cleanup());

  it('in the store app with push off, turns notifications on and never shows again', () => {
    env.native = true;
    renderNudge();
    fireEvent.click(screen.getByRole('button', { name: 'Turn on notifications →' }));
    expect(enable).toHaveBeenCalledTimes(1);
    expect(localStorage.getItem(PUSH_NUDGE_KEY)).toBe('1');
    expect(screen.queryByText('Turn on notifications')).toBeNull();
  });

  it.each(['on', 'denied', 'loading'] as const)('in the store app shows nothing when push is %s', (status) => {
    env.native = true;
    env.state = { status } as PushState;
    renderNudge();
    expect(screen.queryByText('Turn on notifications')).toBeNull();
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

  it('dismissing is remembered', () => {
    renderNudge();
    fireEvent.click(screen.getByRole('button', { name: 'Dismiss' }));
    expect(localStorage.getItem(PUSH_NUDGE_KEY)).toBe('1');
    cleanup();
    renderNudge();
    expect(screen.queryByRole('button', { name: 'Get the app →' })).toBeNull();
  });
});
