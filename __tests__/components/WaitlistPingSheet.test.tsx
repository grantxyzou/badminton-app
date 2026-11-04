// @vitest-environment jsdom
import { describe, it, expect, afterEach, vi } from 'vitest';
import { render, screen, cleanup, fireEvent } from '@testing-library/react';
import { NextIntlClientProvider } from 'next-intl';
import rawMessages from '../../messages/en.json';
import { brandMessages } from '../../i18n/request';
import WaitlistPingSheet, { waitlistPingKind } from '../../components/home/WaitlistPingSheet';
import type { PushState, UsePushResult } from '../../lib/usePush';

/**
 * The ask a waitlist join earns (docs/plans/waitlist-push-ask.md; Grant,
 * 2026-11-04: a sheet after the join, the app on the web, "You'll get a ping"
 * once push is on).
 */
const enMessages = brandMessages(rawMessages);
vi.mock('@/lib/useOnline', () => ({ useOnline: () => true }));
afterEach(cleanup);

const s = (status: PushState['status']) =>
  (status === 'unsupported' ? { status, reason: 'no-push' } : { status }) as PushState;
const pushOf = (status: PushState['status'], extra: Partial<UsePushResult> = {}) =>
  ({ state: s(status), enable: vi.fn(), disable: vi.fn(), busy: false, error: null, ...extra }) as unknown as UsePushResult;

describe('waitlistPingKind', () => {
  it('asks nothing of someone already on, or while the answer is unknown', () => {
    expect(waitlistPingKind(s('on'), false)).toBeNull();
    expect(waitlistPingKind(s('on'), true)).toBeNull();
    expect(waitlistPingKind(s('loading'), false)).toBeNull();
    expect(waitlistPingKind(s('loading'), true)).toBeNull();
  });

  it('points the web to the app, whatever the browser could do itself', () => {
    for (const st of ['off', 'denied', 'unsupported'] as const) expect(waitlistPingKind(s(st), true)).toBe('app');
  });

  it('turns it on in the store app only when a tap can work', () => {
    expect(waitlistPingKind(s('off'), false)).toBe('enable');
    expect(waitlistPingKind(s('denied'), false)).toBeNull();
    expect(waitlistPingKind(s('unsupported'), false)).toBeNull();
  });
});

function wrap(ui: React.ReactNode) {
  return render(<NextIntlClientProvider locale="en" messages={enMessages}>{ui}</NextIntlClientProvider>);
}

describe('WaitlistPingSheet', () => {
  it('turns notifications on with one tap in the store app', () => {
    const push = pushOf('off');
    wrap(<WaitlistPingSheet kind="enable" onClose={vi.fn()} onGetApp={vi.fn()} push={push} />);
    expect(screen.getByText('Want a ping if a spot opens?')).toBeDefined();
    fireEvent.click(screen.getByRole('button', { name: 'Turn on notifications' }));
    expect(push.enable).toHaveBeenCalledTimes(1);
  });

  it('closes itself once push is on', () => {
    const onClose = vi.fn();
    wrap(<WaitlistPingSheet kind="enable" onClose={onClose} onGetApp={vi.fn()} push={pushOf('on')} />);
    expect(onClose).toHaveBeenCalled();
  });

  it('on the web offers the app and no push switch', () => {
    const onGetApp = vi.fn();
    wrap(<WaitlistPingSheet kind="app" onClose={vi.fn()} onGetApp={onGetApp} push={pushOf('off')} />);
    expect(screen.queryByRole('button', { name: 'Turn on notifications' })).toBeNull();
    fireEvent.click(screen.getByRole('button', { name: 'Get the app' }));
    expect(onGetApp).toHaveBeenCalledTimes(1);
  });

  it('renders nothing without an ask', () => {
    wrap(<WaitlistPingSheet kind={null} onClose={vi.fn()} onGetApp={vi.fn()} push={pushOf('off')} />);
    expect(screen.queryByText('Want a ping if a spot opens?')).toBeNull();
  });
});
