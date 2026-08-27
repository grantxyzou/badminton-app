// @vitest-environment jsdom
import { describe, it, expect, beforeEach, afterEach, afterAll, vi } from 'vitest';
import { render, screen, cleanup } from '@testing-library/react';
import { NextIntlClientProvider } from 'next-intl';
import ProfileTab from '../../components/ProfileTab';
import enMessages from '../../messages/en.json';

/**
 * Design "Profile — hierarchy pass" (2026-08-27). The page was long because
 * nothing was collapsed, the admin console was expanded by default on a screen
 * a player opens to change their PIN, and money was duplicated from Home.
 *
 * These assert the five structural claims, because the rest of the suite
 * renders ProfileTab without looking at any of them — it stayed green through
 * the whole change.
 */

const originalEnv = { ...process.env };
const originalFetch = global.fetch;

const baseProps = {
  sessionId: 'session-2026-04-27',
  sessionLabel: 'Apr 27',
  isAdmin: false,
  onAdminTools: vi.fn(),
};

const renderWith = (props: Partial<typeof baseProps> = {}) =>
  render(
    <NextIntlClientProvider locale="en" messages={enMessages}>
      <ProfileTab {...baseProps} {...props} />
    </NextIntlClientProvider>,
  );

function signedIn() {
  localStorage.setItem(
    'badminton_identity',
    JSON.stringify({ name: 'Michael', token: 'tok', sessionId: 'session-2026-04-27' }),
  );
}

/** Admin signal fetches: 1 unpaid player, healthy birds, 0 dormant → 1 signal. */
function mockAdminFetch(opts: { fail?: boolean } = {}) {
  global.fetch = (async (input: RequestInfo | URL) => {
    const url = typeof input === 'string' ? input : (input as Request).url;
    if (opts.fail && (url.includes('/api/birds') || url.includes('/api/members?') || url.endsWith('/api/members'))) {
      return new Response('boom', { status: 500 });
    }
    if (url.includes('/api/members/me')) {
      return new Response(JSON.stringify({ hasPin: true, createdAt: '2026-01-01' }), { status: 200 });
    }
    if (url.includes('/api/players')) {
      return new Response(JSON.stringify([{ name: 'Michael', paid: false }]), { status: 200 });
    }
    if (url.includes('/api/birds')) {
      return new Response(JSON.stringify({ currentStock: 40, burnPerSession: 1 }), { status: 200 });
    }
    if (url.includes('/api/members')) {
      return new Response(JSON.stringify([{ active: true, sessionCount: 5, lastSeen: new Date().toISOString() }]), { status: 200 });
    }
    return new Response('[]', { status: 200 });
  }) as typeof fetch;
}

describe('ProfileTab — hierarchy pass', () => {
  beforeEach(() => {
    localStorage.clear();
    delete process.env.NEXT_PUBLIC_FLAG_COMMAND_CENTER;
    mockAdminFetch();
  });
  afterEach(() => {
    cleanup();
    global.fetch = originalFetch;
  });
  afterAll(() => {
    process.env = originalEnv;
  });

  // #3 — money leaves Profile entirely. Home's balance card owns it, so a
  // figure appearing here again means the two surfaces can disagree.
  it('shows no money at all when signed in', async () => {
    signedIn();
    renderWith();
    await screen.findByText('Michael');
    expect(screen.queryByText(/This week/i)).toBeNull();
    expect(screen.queryByText(/Estimated/i)).toBeNull();
    expect(screen.queryByText(/Final cost/i)).toBeNull();
    expect(screen.queryByText(/Last session/i)).toBeNull();
    expect(screen.queryByText(/^\$/)).toBeNull();
  });

  // #6 — the NAME eyebrow goes; it made a false parallel with the real
  // groupings, ADMIN and ACCOUNT.
  it('drops the NAME eyebrow above the identity card', async () => {
    signedIn();
    renderWith();
    await screen.findByText('Michael');
    expect(screen.queryByText(enMessages.profile.playerName)).toBeNull();
  });

  // #4 — seven rows in three groups, and "Admin access" is cut because it and
  // the console row were two doors to one place.
  it('groups settings under ACCOUNT and APP, with no Admin access row', async () => {
    signedIn();
    process.env.NEXT_PUBLIC_FLAG_COMMAND_CENTER = 'true';
    renderWith({ isAdmin: true });
    await screen.findByText('Michael');
    expect(screen.getByText(enMessages.profile.settings.title)).toBeDefined();
    expect(screen.getByText(enMessages.profile.settings.appGroup)).toBeDefined();
    expect(screen.queryByText(/Admin access/i)).toBeNull();
  });

  // #5 — log out stops pretending to navigate: out of the list, no chevron.
  it('renders Log out as a standalone control with no chevron', async () => {
    signedIn();
    const { container } = renderWith();
    await screen.findByText('Michael');
    const logout = screen.getByRole('button', { name: enMessages.profile.settings.logout });
    expect(logout.querySelector('.material-icons')).toBeNull();
    // and it is not one of the settings-list rows
    expect(logout.closest('ul')).toBeNull();
    expect(container.querySelector('ul')).not.toBeNull();
  });

  // #1 — admin becomes one row. The count survives; the tiles and the
  // full-width CTA do not.
  it('renders the admin console as one row carrying the count, not a hero', async () => {
    signedIn();
    process.env.NEXT_PUBLIC_FLAG_COMMAND_CENTER = 'true';
    renderWith({ isAdmin: true });
    expect(await screen.findByText('Admin console')).toBeDefined();
    expect(await screen.findByText('1 need you')).toBeDefined();
    // The hero's furniture is gone.
    expect(screen.queryByText(/Open admin home/i)).toBeNull();
    expect(screen.queryByText('Bird tubes')).toBeNull();
    expect(screen.queryByText('Dormant')).toBeNull();
  });

  it('hides the admin row entirely for a non-admin', async () => {
    signedIn();
    process.env.NEXT_PUBLIC_FLAG_COMMAND_CENTER = 'true';
    renderWith({ isAdmin: false });
    await screen.findByText('Michael');
    expect(screen.queryByText('Admin console')).toBeNull();
  });

  // Legible-fail: a dead signal fetch must not render "0 need you", which is
  // the lying-empty-state pattern. The row still opens admin.
  it('shows no count when the signal fetch fails, never a zero', async () => {
    signedIn();
    process.env.NEXT_PUBLIC_FLAG_COMMAND_CENTER = 'true';
    mockAdminFetch({ fail: true });
    renderWith({ isAdmin: true });
    expect(await screen.findByText('Admin console')).toBeDefined();
    // Let the three signal fetches actually settle first. Asserting absence
    // straight away would pass before any of them resolved — true of the
    // broken behaviour too, which is not a test. The success case above uses
    // the same settle and DOES find a count, so this absence is meaningful.
    await new Promise((r) => setTimeout(r, 120));
    expect(screen.queryByText(/need you/i)).toBeNull();
    expect(screen.queryByText(enMessages.profile.admin.allClear)).toBeNull();
    // The row still works — the count is decoration, opening admin is the job.
    expect(screen.getByRole('button', { name: /Admin console/ })).toBeDefined();
  });
});
