// @vitest-environment jsdom
// @vitest-environment-options { "url": "http://localhost:3000/bpm" }
import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import { render, screen, cleanup } from '@testing-library/react';
import { NextIntlClientProvider } from 'next-intl';
import CommandCenter from '../../components/admin/CommandCenter/CommandCenter';
import { resetSharedReads } from '../../lib/sharedRead';
import enMessages from '../../messages/en.json';

/**
 * The Command Center's first screen mounts several cards in one commit, and
 * three of them used to ask for the same thing: the Needs-you card and the
 * stat tiles each read `/api/members` and `/api/birds`, and the Needs-you card
 * and the bench menu row each read `/api/stringing/jobs`. Three extra round
 * trips on every open of the admin screen, for answers already on their way.
 *
 * They go through `sharedFetch` now (lib/sharedRead.ts), which shares one
 * request while it is in flight and nothing after — so a refetch after a
 * payment or a move on the bench still reaches the server. This test counts
 * the network: one GET per path on mount, however many cards want it.
 */
const FLAG = 'NEXT_PUBLIC_FLAG_STRINGING';
const before = process.env[FLAG];

const SESSION = { id: 'session-2026-10-22', datetime: '2026-10-22T19:00:00-07:00', maxPlayers: 12 };

function answer(url: string): Response {
  const json = (body: unknown) => new Response(JSON.stringify(body), { status: 200 });
  if (url.includes('/api/stringing/jobs')) return json({ jobs: [] });
  if (url.includes('/api/birds')) return json({ currentStock: 20, burnPerSession: 2, purchases: [] });
  if (url.includes('/api/members')) return json([]);
  if (url.includes('/api/players')) return json([]);
  if (url.includes('/api/sessions')) return json([]);
  if (url.includes('/api/session')) return json(SESSION);
  return json({});
}

function renderCenter() {
  render(
    <NextIntlClientProvider locale="en" messages={enMessages}>
      <CommandCenter refreshKey={0} setView={() => {}} onExit={() => {}} />
    </NextIntlClientProvider>,
  );
}

let fetchMock: ReturnType<typeof vi.fn>;

beforeEach(() => {
  process.env[FLAG] = 'true';
  resetSharedReads();
  vi.stubGlobal('navigator', { ...global.navigator, onLine: true });
  // One Response per call: every sharer takes a clone, so a body is never
  // read twice, and a double read would show as a failed card, not a count.
  fetchMock = vi.fn(async (input: RequestInfo | URL) => answer(String(input)));
  vi.stubGlobal('fetch', fetchMock);
});
afterEach(() => {
  cleanup();
  vi.unstubAllGlobals();
  vi.restoreAllMocks();
  resetSharedReads();
  if (before === undefined) delete process.env[FLAG];
  else process.env[FLAG] = before;
});

function callsTo(path: string): number {
  return fetchMock.mock.calls.filter(([input]) => {
    const url = String(input);
    return url.endsWith(path) || url.includes(`${path}?`);
  }).length;
}

describe('the admin landing reads each shared endpoint once', () => {
  it('one GET each for the roster, the birds and the bench, however many cards want them', async () => {
    renderCenter();
    // The settings list is the LAST slot of the console's loading cascade:
    // it shows once every card above it has answered, so by now each
    // mount-time read has been issued.
    await screen.findByRole('button', { name: /Stringing bench/i });

    // Two cards each: the Needs-you card and the stat tiles.
    expect(callsTo('/api/members')).toBe(1);
    expect(callsTo('/api/birds')).toBe(1);
    // Two readers: the Needs-you card and the bench row's "N waiting" count.
    expect(callsTo('/api/stringing/jobs')).toBe(1);
  });
});
