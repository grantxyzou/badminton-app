// @vitest-environment jsdom
// @vitest-environment-options { "url": "http://localhost:3000/bpm" }
import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import { render, screen, cleanup, fireEvent, waitFor, within } from '@testing-library/react';
import { NextIntlClientProvider } from 'next-intl';
import StringingPage from '../../components/admin/CommandCenter/StringingPage';
import StringingIntake from '../../components/admin/CommandCenter/StringingIntake';
import JobCard from '../../components/stringing/JobCard';
import enMessages from '../../messages/en.json';
import type { StringingJob } from '../../lib/types';

/**
 * The bench as one card of job cards (docs/plans/stringing-canvas-redesign.md,
 * Decisions 10-11): the count and what is late in its header, each racket's
 * next step on its own card, the archive's money with "Mark paid", the sheets
 * titled with the racket, and the intake's Recent chips.
 */
const base: StringingJob = {
  id: 'job-1', memberId: 'member-kento', jobNo: 'J-0005', memberName: 'Kento',
  stringerId: null, stringerName: null, status: 'requested',
  racketLabel: 'Arcsaber 11 Pro', stringLabel: 'Exbolt 63', tensionMains: 27, tensionCrosses: 29,
  method: '', priceCents: 3000, readyBy: null, acceptedAt: null, paidAt: null, sessionId: null,
  createdAt: '2026-10-20T00:00:00.000Z', updatedAt: '2026-10-20T00:00:00.000Z', history: [],
} as StringingJob;

function wrap(node: React.ReactNode) {
  return render(<NextIntlClientProvider locale="en" messages={enMessages}>{node}</NextIntlClientProvider>);
}

function respond(open: StringingJob[], archived: StringingJob[] = []) {
  const fetchMock = vi.fn().mockImplementation((url: string, init?: RequestInit) =>
    Promise.resolve({
      ok: true,
      status: 200,
      json: async () => {
        const u = String(url);
        if (init?.method === 'PATCH') return { job: open[0] };
        if (u.includes('/shop')) return { open: true };
        if (u.includes('/strings')) return { strings: [] };
        if (u.includes('/stringers')) return { stringers: [] };
        if (u.includes('/members')) return [{ id: 'member-kento', name: 'Kento' }, { id: 'member-lin', name: 'Lin' }];
        return { jobs: u.includes('archived') ? archived : open, view: 'bench' };
      },
    } as Response),
  );
  vi.stubGlobal('fetch', fetchMock);
  return fetchMock;
}

beforeEach(() => {
  vi.stubGlobal('navigator', { ...global.navigator, onLine: true });
});
afterEach(() => {
  cleanup();
  vi.unstubAllGlobals();
});

describe('the bench card', () => {
  it('holds every racket in ONE card, its header counting what is open and late', async () => {
    const late = { ...base, id: 'job-2', jobNo: 'J-0003', racketLabel: 'Astrox 100ZZ', status: 'received', readyBy: '2026-01-01' } as StringingJob;
    respond([base, late]);
    wrap(<StringingPage onBack={() => {}} />);
    const card = await screen.findByRole('region', { name: 'Stringing jobs' });
    expect(within(card).getByText('2 open · 1 late')).toBeDefined();
    expect(within(card).getByText('Arcsaber 11 Pro')).toBeDefined();
    expect(within(card).getAllByText('Exbolt 63 · 27/29 lb · for Kento')).toHaveLength(2);
    expect(within(card).getByText(/days late/)).toBeDefined();
  });

  it('moves a job on from its own card, with the status sent as a PATCH', async () => {
    const fetchMock = respond([base]);
    wrap(<StringingPage onBack={() => {}} />);
    fireEvent.click(await screen.findByRole('button', { name: 'Mark received' }));
    await waitFor(() => {
      const patch = fetchMock.mock.calls.find((c) => c[1]?.method === 'PATCH');
      expect(patch).toBeDefined();
      expect(String(patch![0])).toContain('/api/stringing/jobs/job-1');
      expect(JSON.parse(String(patch![1].body))).toEqual({ memberId: 'member-kento', status: 'received' });
    });
  });

  it('titles the ⋮ sheet with the racket, then the job and whose it is', async () => {
    respond([base]);
    wrap(<StringingPage onBack={() => {}} />);
    fireEvent.click(await screen.findByRole('button', { name: 'More actions for Kento' }));
    const dialog = await screen.findByRole('dialog');
    expect(within(dialog).getByText('Arcsaber 11 Pro')).toBeDefined();
    expect(dialog.textContent).toContain('J-0005 · for Kento');
  });
});

describe('the archive card', () => {
  it('counts what still owes, and offers Mark paid on a billable job', async () => {
    const owing = { ...base, id: 'job-0', jobNo: 'J-0000', racketLabel: 'Thruster F', status: 'picked_up', priceCents: 2800, archivedAt: '2026-10-25T00:00:00.000Z' } as StringingJob;
    const fetchMock = respond([], [owing]);
    wrap(<StringingPage onBack={() => {}} />);
    fireEvent.click(await screen.findByRole('button', { name: /Archived/ }));
    const card = await screen.findByRole('region', { name: 'Picked up' });
    expect(within(card).getByText('1 job · 1 still owe')).toBeDefined();
    expect(within(card).getByText('Still owes $28')).toBeDefined();
    fireEvent.click(within(card).getByRole('button', { name: 'Mark paid' }));
    await waitFor(() => {
      const patch = fetchMock.mock.calls.find((c) => c[1]?.method === 'PATCH');
      expect(JSON.parse(String(patch![1].body))).toEqual({ memberId: 'member-kento', paid: true });
    });
  });
});

describe('a stringer\'s card', () => {
  it('never says "unpaid" — it cannot see the money — and shows the date instead', () => {
    wrap(
      <JobCard
        job={{ racketLabel: 'Nanoflare 1000Z', jobNo: 'J-0004', status: 'ready', stringLabel: 'BG65', tensionMains: 24, tensionCrosses: 26, memberName: 'Akane', readyBy: '2026-10-29' }}
        today="2026-10-28"
      />,
    );
    expect(screen.queryByText('Ready · unpaid')).toBeNull();
    expect(screen.getByText('Tomorrow')).toBeDefined();
  });

  it('on the bench, a ready unpaid job says so', () => {
    wrap(
      <JobCard
        job={{ racketLabel: 'Astrox 88D Pro', jobNo: 'J-0001', status: 'ready', stringLabel: 'BG80', tensionMains: 26, tensionCrosses: 28, memberName: 'Lin', readyBy: null, paidAt: null }}
        today="2026-10-28"
      />,
    );
    expect(screen.getByText('Ready · unpaid')).toBeDefined();
  });
});

describe('the intake\'s Recent chips', () => {
  it('offers the three most recent players, and no name list until something is typed', async () => {
    respond([]);
    wrap(
      <StringingIntake
        onBack={() => {}}
        onCreated={() => {}}
        recent={[{ id: 'member-kento', name: 'Kento' }, { id: 'member-lin', name: 'Lin' }, { id: 'member-gone', name: 'Gone' }, { id: 'member-x', name: 'X' }]}
      />,
    );
    const recent = await screen.findByRole('group', { name: 'Recent' });
    await waitFor(() => expect(within(recent).getAllByRole('button').map((b) => b.textContent)).toEqual(['Kento', 'Lin']));
    fireEvent.click(within(recent).getByRole('button', { name: 'Lin' }));
    expect(await screen.findByText('Change')).toBeDefined();
  });
});
