// @vitest-environment jsdom
import { describe, it, expect, afterEach, vi } from 'vitest';
import { render, screen, cleanup } from '@testing-library/react';
import { NextIntlClientProvider } from 'next-intl';
import enMessages from '../../messages/en.json';
import RosterPage from '@/components/admin/CommandCenter/RosterPage';

/**
 * Loading cascade follow-up. A failed members read became `[]` — an empty
 * roster, a confident wrong answer on the screen an admin manages people
 * from. It is an error with Try again now.
 */
afterEach(() => {
  cleanup();
  vi.unstubAllGlobals();
});

function respond(membersOk: boolean) {
  return vi.fn().mockImplementation((url: string) => {
    const u = String(url);
    if (u.includes('/api/members')) {
      return Promise.resolve(
        membersOk
          ? ({ ok: true, json: async () => [{ id: 'm1', name: 'Lin', active: true, role: 'member' }] } as unknown as Response)
          : ({ ok: false, status: 500, json: async () => ({}) } as unknown as Response),
      );
    }
    const body = u.includes('/api/admin') ? { authed: true, name: 'Grant' } : [];
    return Promise.resolve({ ok: true, json: async () => body } as unknown as Response);
  });
}

describe('RosterPage when the members read fails', () => {
  it('says the roster could not load, with Try again — not an empty roster', async () => {
    vi.stubGlobal('fetch', respond(false));
    render(
      <NextIntlClientProvider locale="en" messages={enMessages}>
        <RosterPage onBack={() => {}} />
      </NextIntlClientProvider>,
    );
    expect(await screen.findByText("Couldn't load the roster.")).toBeDefined();
    expect(screen.getByRole('button', { name: 'Try again' })).toBeDefined();
  });

  it('shows the members when the read succeeds', async () => {
    vi.stubGlobal('fetch', respond(true));
    render(
      <NextIntlClientProvider locale="en" messages={enMessages}>
        <RosterPage onBack={() => {}} />
      </NextIntlClientProvider>,
    );
    expect(await screen.findByText('Lin')).toBeDefined();
    expect(screen.queryByText("Couldn't load the roster.")).toBeNull();
  });
});
