// @vitest-environment jsdom
import { describe, it, expect, afterEach, beforeEach, vi } from 'vitest';
import { render, screen, cleanup, waitFor, fireEvent, within } from '@testing-library/react';
import { NextIntlClientProvider } from 'next-intl';
import rawMessages from '../../messages/en.json';
import { brandMessages } from '../../i18n/request';
import NotificationsButton from '../../components/NotificationsButton';
import NotificationsPage from '../../components/NotificationsPage';
import { __resetNoticesForTests } from '../../lib/useNotices';
import type { UsePushResult } from '../../lib/usePush';

/**
 * The bell and the page (docs/plans/notification-center.md). One store feeds
 * both, so the page's "seen" is what clears the bell's dot.
 */
const enMessages = brandMessages(rawMessages);
vi.mock('@/lib/useOnline', () => ({ useOnline: () => true }));

const push = { state: { status: 'on' }, enable: vi.fn(), disable: vi.fn(), busy: false, error: null } as unknown as UsePushResult;

let listBody: unknown;
let listStatus = 200;
const seenPosts: string[] = [];

beforeEach(() => {
  __resetNoticesForTests();
  listStatus = 200;
  seenPosts.length = 0;
  vi.stubGlobal(
    'fetch',
    vi.fn().mockImplementation((url: string, init?: RequestInit) => {
      const u = String(url);
      if (u.endsWith('/api/notifications/seen') && init?.method === 'POST') {
        seenPosts.push(u);
        return Promise.resolve({ ok: true, json: async () => ({ seenAt: '2026-11-04T08:00:00.000Z' }) } as Response);
      }
      if (u.endsWith('/api/notifications')) {
        return Promise.resolve({ ok: listStatus === 200, status: listStatus, json: async () => listBody } as Response);
      }
      return Promise.resolve({ ok: true, json: async () => ({}) } as Response);
    }),
  );
});

afterEach(() => {
  cleanup();
  vi.unstubAllGlobals();
});

function wrap(ui: React.ReactNode) {
  return render(
    <NextIntlClientProvider locale="en" messages={enMessages} timeZone="UTC" now={new Date('2026-11-04T09:00:00Z')}>
      {ui}
    </NextIntlClientProvider>,
  );
}

const NOTICES = [
  { id: 'n3', type: 'stringing', stage: 'ready_for_you', racketLabel: 'Astrox 88D Pro', at: '2026-11-04T07:00:00.000Z' },
  { id: 'n2', type: 'settle_up', count: 2, at: '2026-11-03T07:00:00.000Z' },
  { id: 'n1', type: 'signups_open', sessionAt: '2026-11-06T03:00:00.000Z', at: '2026-11-01T07:00:00.000Z' },
];

describe('NotificationsButton', () => {
  it('shows the red dot only after a read that found something new', async () => {
    listBody = { notices: NOTICES, unread: 2, seenAt: '2026-11-02T00:00:00.000Z' };
    const { container } = wrap(<NotificationsButton onOpen={vi.fn()} />);
    await waitFor(() => expect(container.querySelector('.notif-dot')).not.toBeNull());
    // …and the bell rings once as it arrives.
    expect(container.querySelector('.notif-ring')).not.toBeNull();
    expect(screen.getByRole('button', { name: 'Notifications, 2 new' })).toBeDefined();
  });

  it('shows no dot when the read fails: unknown is not "new"', async () => {
    listStatus = 503;
    listBody = { error: 'read_failed' };
    const { container } = wrap(<NotificationsButton onOpen={vi.fn()} />);
    await waitFor(() => expect((globalThis.fetch as unknown as { mock: { calls: unknown[] } }).mock.calls.length).toBeGreaterThan(0));
    expect(container.querySelector('.notif-dot')).toBeNull();
    expect(screen.getByRole('button', { name: 'Notifications' })).toBeDefined();
  });
});

describe('NotificationsPage', () => {
  it('renders each notice in words, marks them seen, and the bell loses its dot', async () => {
    listBody = { notices: NOTICES, unread: 2, seenAt: '2026-11-02T00:00:00.000Z' };
    const { container } = wrap(
      <>
        <NotificationsButton onOpen={vi.fn()} />
        <NotificationsPage onBack={vi.fn()} onNavigate={vi.fn()} push={push} isAdmin={false} migrateOn={false} />
      </>,
    );
    expect(await screen.findByText('Your racket is ready')).toBeDefined();
    expect(screen.getByText('Astrox 88D Pro, ready to pick up.')).toBeDefined();
    expect(screen.getByText("You've got 2 sessions to settle up.")).toBeDefined();
    expect(screen.getByText('Sign-ups are open')).toBeDefined();
    // The two newer than the old stamp sit under "New" for this visit, the
    // rest under "Earlier" — a label, never a red dot per row.
    await waitFor(() => expect(within(screen.getByRole('list', { name: 'New' })).getAllByRole('listitem')).toHaveLength(2));
    expect(within(screen.getByRole('list', { name: 'Earlier' })).getAllByRole('listitem')).toHaveLength(1);
    expect(container.querySelector('.notice-new-dot')).toBeNull();
    await waitFor(() => expect(seenPosts).toHaveLength(1));
    await waitFor(() => expect(container.querySelector('.notif-dot')).toBeNull());
  });

  it('sends a racket notice to the Stringing tab and the rest Home', async () => {
    listBody = { notices: NOTICES, unread: 0, seenAt: '2026-11-05T00:00:00.000Z' };
    const onNavigate = vi.fn();
    wrap(<NotificationsPage onBack={vi.fn()} onNavigate={onNavigate} push={push} isAdmin={false} migrateOn={false} />);
    fireEvent.click((await screen.findByText('Your racket is ready')).closest('button')!);
    fireEvent.click(screen.getByText('Time to settle up').closest('button')!);
    expect(onNavigate.mock.calls).toEqual([['stringing'], ['home']]);
    // Nothing unread: nothing to mark, and one "Recent" group, no "New".
    expect(seenPosts).toHaveLength(0);
    expect(screen.getByRole('list', { name: 'Recent' })).toBeDefined();
    expect(screen.queryByRole('list', { name: 'New' })).toBeNull();
  });

  it('shows the bell pressed while its page is open, and a tap closes it', async () => {
    listBody = { notices: [], unread: 0, seenAt: null };
    const onOpen = vi.fn();
    const onClose = vi.fn();
    wrap(<NotificationsButton onOpen={onOpen} onClose={onClose} active />);
    const bell = await screen.findByRole('button', { name: 'Notifications' });
    expect(bell.getAttribute('aria-pressed')).toBe('true');
    fireEvent.click(bell);
    expect(onClose).toHaveBeenCalledTimes(1);
    expect(onOpen).not.toHaveBeenCalled();
  });

  it('moves focus onto the page when it opens', async () => {
    listBody = { notices: [], unread: 0, seenAt: null };
    wrap(<NotificationsPage onBack={vi.fn()} onNavigate={vi.fn()} push={push} isAdmin={false} migrateOn={false} />);
    await screen.findByText(/Nothing yet/);
    expect(document.activeElement?.getAttribute('aria-label')).toBe('Back');
  });

  it('says so plainly when there is nothing, and when the read failed', async () => {
    listBody = { notices: [], unread: 0, seenAt: null };
    wrap(<NotificationsPage onBack={vi.fn()} onNavigate={vi.fn()} push={push} isAdmin={false} migrateOn={false} />);
    expect(await screen.findByText(/Nothing yet/)).toBeDefined();
    cleanup();
    __resetNoticesForTests();
    listStatus = 503;
    wrap(<NotificationsPage onBack={vi.fn()} onNavigate={vi.fn()} push={push} isAdmin={false} migrateOn={false} />);
    expect(await screen.findByText("Couldn't load your notifications.")).toBeDefined();
  });

  it('leads with the push switch in the store app, and no app card', async () => {
    listBody = { notices: [], unread: 0, seenAt: null };
    const off = { ...push, state: { status: 'off' } } as unknown as UsePushResult;
    wrap(<NotificationsPage onBack={vi.fn()} onNavigate={vi.fn()} push={off} isAdmin={false} migrateOn={false} />);
    expect(await screen.findByRole('button', { name: /turn on notifications/i })).toBeDefined();
    expect(screen.queryByRole('button', { name: /get the app/i })).toBeNull();
  });

  it('on the web leads with the app card and offers no way to turn push on', async () => {
    listBody = { notices: [], unread: 0, seenAt: null };
    const off = { ...push, state: { status: 'off' } } as unknown as UsePushResult;
    wrap(<NotificationsPage onBack={vi.fn()} onNavigate={vi.fn()} push={off} isAdmin={false} migrateOn />);
    expect(await screen.findByRole('button', { name: /get the app/i })).toBeDefined();
    expect(screen.queryByRole('button', { name: /turn on notifications/i })).toBeNull();
  });

  it('on the web still lets a browser that already has push turn it off', async () => {
    listBody = { notices: [], unread: 0, seenAt: null };
    wrap(<NotificationsPage onBack={vi.fn()} onNavigate={vi.fn()} push={push} isAdmin={false} migrateOn />);
    expect(await screen.findByRole('button', { name: /get the app/i })).toBeDefined();
    expect(screen.getByRole('button', { name: /turn off notifications/i })).toBeDefined();
  });
});
