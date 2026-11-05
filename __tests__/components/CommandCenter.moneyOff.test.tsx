// @vitest-environment jsdom
// @vitest-environment-options { "url": "http://localhost:3000/bpm" }
import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import { render, screen, cleanup } from '@testing-library/react';
import { NextIntlClientProvider } from 'next-intl';
import { applyStyle, type ClubRun } from '../../lib/clubRun';
import { resetSharedReads } from '../../lib/sharedRead';
import enMessages from '../../messages/en.json';

/**
 * With money off, PaymentsCard is not rendered — and it was the only admin
 * list of who signed up. The session list takes its place below the session
 * card (docs/plans/money-off-session-list.md); a club that collects money
 * keeps Payments and never sees the list card.
 */
let run: ClubRun;
vi.mock('@/lib/useClubRun', () => ({
  useClubRun: () => ({ run, known: true }),
  CLUB_RUN_EVENT: 'badminton:club-run-changed',
  announceClubRun: () => {},
}));

import CommandCenter from '../../components/admin/CommandCenter/CommandCenter';

const SESSION = { id: 'session-2026-11-14', datetime: '2026-11-14T19:00:00-08:00', maxPlayers: 12 };
const PLAYERS = [{ id: 'p1', name: 'Lin', timestamp: '2026-11-08T10:00:00.000Z' }];

function answer(url: string): Response {
  const json = (body: unknown) => new Response(JSON.stringify(body), { status: 200 });
  if (url.includes('/api/stringing/jobs')) return json({ jobs: [] });
  if (url.includes('/api/birds')) return json({ currentStock: 20, burnPerSession: 2, purchases: [] });
  if (url.includes('/api/members')) return json([]);
  if (url.includes('/api/players')) return json(PLAYERS);
  if (url.includes('/api/sessions')) return json([]);
  if (url.includes('/api/session')) return json(SESSION);
  return json({});
}

beforeEach(() => {
  resetSharedReads();
  vi.stubGlobal('navigator', { ...global.navigator, onLine: true });
  vi.stubGlobal('fetch', vi.fn(async (input: RequestInfo | URL) => answer(String(input))));
});
afterEach(() => {
  cleanup();
  vi.unstubAllGlobals();
  resetSharedReads();
});

function renderCenter() {
  render(
    <NextIntlClientProvider locale="en" messages={enMessages}>
      <CommandCenter refreshKey={0} setView={() => {}} onExit={() => {}} />
    </NextIntlClientProvider>,
  );
}

describe('the Command Center with money off', () => {
  it('shows the week’s list under the session, and no Payments toggle', async () => {
    run = applyStyle('members_first');
    renderCenter();
    expect(await screen.findByRole('region', { name: "This week's list" })).toBeTruthy();
    expect(screen.queryByRole('tab', { name: 'Payments' })).toBeNull();
    expect(screen.queryByRole('region', { name: 'Payments' })).toBeNull();
  });

  it('a club that collects money keeps Payments and gets no list card', async () => {
    run = applyStyle('first_come');
    renderCenter();
    expect(await screen.findByRole('tab', { name: 'Payments' })).toBeTruthy();
    await screen.findByRole('button', { name: /How your club runs/i });
    expect(screen.queryByRole('region', { name: "This week's list" })).toBeNull();
  });
});
