// @vitest-environment jsdom
import { describe, it, expect, afterEach, vi } from 'vitest';
import { render, screen, cleanup, waitFor, fireEvent } from '@testing-library/react';
import { NextIntlClientProvider } from 'next-intl';
import LearnRegister from '../../components/stats/LearnRegister';
import { OnlineProvider } from '../../lib/useOnline';
import enMessages from '../../messages/en.json';

function jsonResponse(body: unknown, ok = true) {
  return Promise.resolve({ ok, status: ok ? 200 : 500, json: async () => body } as Response);
}

const posted: { url: string; body: unknown }[] = [];

const DRILLS = [
  {
    id: 'd1',
    skillKey: 'drops',
    skillLabel: 'Drops',
    title: 'Ten drops from the back corner',
    description: 'Feed yourself a high lift, recover to base, then play ten drops.',
    minutes: 12,
    setting: 'solo',
    reason: 'For your drops (rated 2/5)',
  },
  {
    id: 'd2',
    skillKey: 'drops',
    skillLabel: 'Drops',
    title: 'Drop-and-lift rally with a partner',
    description: 'Alternate drop and lift for two minutes without a break.',
    minutes: 10,
    setting: 'pair',
    reason: 'For your drops (rated 2/5)',
  },
];

function mockFetch(opts: { drills?: unknown[]; done?: string[]; drillsOk?: boolean; postOk?: boolean } = {}) {
  const { drills = DRILLS, done = [], drillsOk = true, postOk = true } = opts;
  vi.stubGlobal(
    'fetch',
    vi.fn((input: RequestInfo | URL, init?: RequestInit) => {
      const url = String(input);
      if (init?.method === 'POST') {
        posted.push({ url, body: JSON.parse(String(init.body)) });
        if (!postOk) return jsonResponse({ error: 'save_failed' }, false);
        const b = JSON.parse(String(init.body)) as { drillId: string; done: boolean };
        const next = b.done ? [...done, b.drillId] : done.filter((d) => d !== b.drillId);
        return jsonResponse({ done: next, weekKey: 'session-2026-08-20' });
      }
      if (!drillsOk) return jsonResponse({ error: 'load_failed' }, false);
      return jsonResponse({ drills, done });
    }) as unknown as typeof fetch,
  );
}

function renderLearn(name: string | null = 'Lin') {
  return render(
    <NextIntlClientProvider locale="en" messages={enMessages}>
      <OnlineProvider>
        <LearnRegister activeName={name} />
      </OnlineProvider>
    </NextIntlClientProvider>,
  );
}

describe('LearnRegister', () => {
  afterEach(() => {
    cleanup();
    vi.unstubAllGlobals();
    posted.length = 0;
  });

  it('leads with the app-picked weekly focus', async () => {
    mockFetch();
    renderLearn();
    await waitFor(() => expect(screen.getByText('This week · focus')).toBeTruthy());
    // Per-skill headline, not a generic one.
    expect(screen.getByText('Tighten your drops')).toBeTruthy();
    expect(screen.getByText(/We pick it — you don't have to decide/)).toBeTruthy();
  });

  it('offers no way to choose the focus', async () => {
    mockFetch();
    renderLearn();
    await waitFor(() => expect(screen.getByText('This week · focus')).toBeTruthy());
    expect(screen.queryByRole('combobox')).toBeNull();
    expect(screen.queryByText(/choose/i)).toBeNull();
  });

  it('shows exactly two drills with a 0 of 2 counter', async () => {
    mockFetch();
    renderLearn();
    await waitFor(() => expect(screen.getByText('0 of 2')).toBeTruthy());
    expect(screen.getByText('Ten drops from the back corner')).toBeTruthy();
    expect(screen.getByText('Drop-and-lift rally with a partner')).toBeTruthy();
  });

  it('renders the counter correctly on FIRST paint from the GET', async () => {
    // done ships with the picks — a second round-trip would flash 0 of 2.
    mockFetch({ done: ['d1'] });
    renderLearn();
    await waitFor(() => expect(screen.getByText('1 of 2')).toBeTruthy());
  });

  it('opens a drill detail sheet and marks it done', async () => {
    mockFetch();
    renderLearn();
    await waitFor(() => expect(screen.getByText('Ten drops from the back corner')).toBeTruthy());
    fireEvent.click(screen.getByText('Ten drops from the back corner'));
    await waitFor(() => expect(screen.getByText(/Feed yourself a high lift/)).toBeTruthy());
    fireEvent.click(screen.getByRole('button', { name: 'Mark as done' }));
    await waitFor(() => {
      const post = posted.find((p) => p.url.includes('/drills/done'));
      expect(post?.body).toEqual({ drillId: 'd1', done: true });
    });
  });

  it('offers undo on an already-done drill', async () => {
    mockFetch({ done: ['d1'] });
    renderLearn();
    await waitFor(() => expect(screen.getByText('Ten drops from the back corner')).toBeTruthy());
    fireEvent.click(screen.getByText('Ten drops from the back corner'));
    await waitFor(() => expect(screen.getByRole('button', { name: 'Done — tap to undo' })).toBeTruthy());
  });

  it('reverts the tick when the write FAILS', async () => {
    mockFetch({ postOk: false });
    renderLearn();
    await waitFor(() => expect(screen.getByText('0 of 2')).toBeTruthy());
    fireEvent.click(screen.getByText('Ten drops from the back corner'));
    fireEvent.click(screen.getByRole('button', { name: 'Mark as done' }));
    // A check mark must never survive a write that did not happen.
    await waitFor(() => expect(screen.getByRole('alert')).toBeTruthy());
    expect(screen.getByText('0 of 2')).toBeTruthy();
  });

  it('celebrates at 2 of 2 and drops the hero for the payoff', async () => {
    mockFetch({ done: ['d1', 'd2'] });
    renderLearn();
    await waitFor(() => expect(screen.getByText('Focus done — nice.')).toBeTruthy());
    expect(screen.getByText(/Re-rate Drops at your next check-in/)).toBeTruthy();
    expect(screen.queryByText('This week · focus')).toBeNull();
  });

  // ── Nothing scolds ──────────────────────────────────────────────────────
  it('has no overdue, reminder or streak language anywhere', async () => {
    mockFetch();
    renderLearn();
    await waitFor(() => expect(screen.getByText('0 of 2')).toBeTruthy());
    const text = (document.body.textContent ?? '').toLowerCase();
    for (const banned of ['overdue', 'missed', 'streak', 'reminder', 'you should have']) {
      expect(text).not.toContain(banned);
    }
  });

  it('invites a check-in when there is nothing to pick from', async () => {
    mockFetch({ drills: [] });
    renderLearn();
    await waitFor(() => expect(screen.getByText('Do a check-in first')).toBeTruthy());
    expect(screen.getByRole('button', { name: 'Start check-in' })).toBeTruthy();
    // One invitation, not four empty cards apologising.
    expect(screen.queryByText('Two things to do')).toBeNull();
  });

  it('shows an explicit error rather than an empty register', async () => {
    mockFetch({ drillsOk: false });
    renderLearn();
    await waitFor(() => expect(screen.getByRole('alert')).toBeTruthy());
    expect(screen.queryByText('Do a check-in first')).toBeNull();
  });

  it('renders nothing without an active name', () => {
    mockFetch();
    const { container } = renderLearn(null);
    expect(container.textContent).toBe('');
  });
});
