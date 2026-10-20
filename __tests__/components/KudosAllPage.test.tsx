// @vitest-environment jsdom
import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import { render, screen, cleanup, fireEvent } from '@testing-library/react';
import { NextIntlClientProvider } from 'next-intl';
import KudosAllPage from '../../components/stats/KudosAllPage';
import enMessages from '../../messages/en.json';
import { resetSharedReads } from '../../lib/sharedRead';

/**
 * "Your kudos" (Play › All your kudos, Stats canvas 2026-10-19): the tally,
 * then each month's signed notes and its bare tags as counts. The page shows
 * what `GET /api/kudos` sends and adds nothing a bare tag must not carry.
 */

function json(body: unknown, status = 200) {
  return Promise.resolve({ ok: status >= 200 && status < 300, status, json: async () => body } as Response);
}

const BODY = {
  kudos: [{ tag: 'clutch', count: 3 }, { tag: 'good_sport', count: 1 }],
  notes: [],
  people: 3,
  months: [
    { month: '2026-10', notes: [{ tag: 'good_sport', note: 'Thanks for switching courts', raterName: 'Kento', createdAt: '2026-10-09T03:00:00Z' }], tags: [{ tag: 'clutch', count: 2 }] },
    { month: '2026-03', notes: [], tags: [{ tag: 'clutch', count: 1 }] },
  ],
};

function wrap(onBack = vi.fn()) {
  render(
    <NextIntlClientProvider locale="en" messages={enMessages}>
      <KudosAllPage onBack={onBack} />
    </NextIntlClientProvider>,
  );
  return onBack;
}

beforeEach(() => {
  resetSharedReads();
  localStorage.clear();
  localStorage.setItem('badminton_identity', JSON.stringify({ name: 'Lin', token: 't', sessionId: 's' }));
});
afterEach(() => { cleanup(); vi.unstubAllGlobals(); });

describe('KudosAllPage', () => {
  it('shows the tally, the most-noticed tag, and every month', async () => {
    vi.stubGlobal('fetch', vi.fn(() => json(BODY)));
    wrap();
    expect(await screen.findByText('4 kudos, from 3 people')).toBeTruthy();
    expect(screen.getByText(/Your most-noticed thing/).textContent).toContain('Clutch');
    expect(screen.getByText('October')).toBeTruthy();
    expect(screen.getByText('Thanks for switching courts')).toBeTruthy();
    expect(screen.getByText('Kento', { exact: false })).toBeTruthy();
    // A bare tag is a count with no name and no date.
    expect(screen.getByText('Clutch ×2', { exact: false })).toBeTruthy();
    expect(screen.getAllByText('from people you played with')).toHaveLength(2);
  });

  it('says so when there are none, rather than drawing an empty tally', async () => {
    vi.stubGlobal('fetch', vi.fn(() => json({ kudos: [], notes: [], months: [], people: 0 })));
    wrap();
    expect(await screen.findByText(enMessages.stats.kudos.allEmpty)).toBeTruthy();
  });

  it('a failed read is an error with a retry, never an empty page', async () => {
    vi.stubGlobal('fetch', vi.fn(() => json({ error: 'load_failed' }, 500)));
    wrap();
    expect(await screen.findByText(enMessages.stats.kudos.error)).toBeTruthy();
    expect(screen.queryByText(enMessages.stats.kudos.allEmpty)).toBeNull();
  });

  it('goes back to Play', async () => {
    vi.stubGlobal('fetch', vi.fn(() => json(BODY)));
    const onBack = wrap();
    fireEvent.click(await screen.findByRole('button', { name: 'Play' }));
    expect(onBack).toHaveBeenCalled();
  });
});
