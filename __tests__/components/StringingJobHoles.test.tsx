// @vitest-environment jsdom
// @vitest-environment-options { "url": "http://localhost:3000/bpm" }
import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import { render, screen, cleanup, fireEvent, waitFor } from '@testing-library/react';
import { NextIntlClientProvider } from 'next-intl';
import StringingPage from '../../components/admin/CommandCenter/StringingPage';
import StringingJobDetail from '../../components/admin/CommandCenter/StringingJobDetail';
import StringingIntake from '../../components/admin/CommandCenter/StringingIntake';
import StringerJobsCard from '../../components/stringing/StringerJobsCard';
import { resetCatalogCache } from '../../components/stats/useCatalog';
import { racketIdForLabel, racketIdsByTallyKey } from '../../lib/gearSetup';
import enMessages from '../../messages/en.json';
import seed from '../../scripts/data/equipment-catalog.json';
import type { CatalogItem, StringingJob } from '../../lib/types';

/**
 * The hole count on the stringing job (docs/plans/grommet-holes.md, Phase 4):
 * matched from the job's racket label at read time, the sourced count first
 * and the club's own second, and nothing for a name the catalog does not know.
 */
const rackets = (seed as unknown as { items: CatalogItem[] }).items.filter((i) => i.category === 'racket');

const job = (racketLabel: string, id = 'job-1'): StringingJob => ({
  id, memberId: 'member-wei', jobNo: 'J-0042', memberName: 'Wei', stringerId: null, stringerName: null,
  status: 'received', racketLabel, stringLabel: 'BG80', tensionMains: 26, tensionCrosses: 28, method: '',
  priceCents: 3000, readyBy: null, acceptedAt: null, paidAt: null, sessionId: null,
  createdAt: '2026-10-21T00:00:00.000Z', updatedAt: '2026-10-21T00:00:00.000Z', history: [],
});

function respond(opts: { jobs?: StringingJob[]; stringerJobs?: StringingJob[]; counts?: Record<string, number> }) {
  const calls: string[] = [];
  vi.stubGlobal('fetch', vi.fn().mockImplementation((url: string) => {
    const u = String(url);
    calls.push(u);
    const body = () => {
      if (u.includes('/api/equipment/catalog')) return { items: rackets };
      if (u.includes('/api/stringing/holes')) return { counts: opts.counts ?? {} };
      if (u.includes('/shop')) return { open: false };
      if (u.includes('/strings')) return { strings: [] };
      if (u.includes('view=stringer')) return { jobs: opts.stringerJobs ?? [] };
      if (u.includes('/api/members')) return { members: [] };
      return { jobs: opts.jobs ?? [], view: 'bench' };
    };
    return Promise.resolve({ ok: true, status: 200, json: async () => body() } as Response);
  }));
  return calls;
}

const wrap = (node: React.ReactNode) =>
  render(<NextIntlClientProvider locale="en" messages={enMessages}>{node}</NextIntlClientProvider>);

beforeEach(() => {
  resetCatalogCache();
  vi.stubGlobal('navigator', { ...global.navigator, onLine: true });
});
afterEach(() => {
  cleanup();
  vi.unstubAllGlobals();
  vi.restoreAllMocks();
});

describe('a job racket label names a catalog racket only exactly', () => {
  const ids = racketIdsByTallyKey(rackets);
  it('matches "Brand Model", case and surrounding spaces aside', () => {
    expect(racketIdForLabel('Yonex Astrox 100ZZ', ids)).toBe('racket-yonex-astrox-100zz');
    expect(racketIdForLabel('  yonex astrox 100zz ', ids)).toBe('racket-yonex-astrox-100zz');
  });
  it('never matches a near miss: a different racket is not a guess', () => {
    expect(racketIdForLabel('Astrox 100ZZ', ids)).toBeNull();
    expect(racketIdForLabel('Yonex Astrox 88D', ids)).toBeNull();
  });
});

describe('the bench shows a job’s holes', () => {
  it('the sourced count, the club’s own count, and nothing for an unknown name', async () => {
    respond({
      jobs: [job('Yonex Astrox 100ZZ', 'a'), job('Li-Ning AxForce 80', 'b'), job('my old racket', 'c')],
      counts: { 'racket-li-ning-axforce-80': 72 },
    });
    wrap(<StringingPage onBack={() => {}} />);
    expect(await screen.findByText(/76 holes/)).toBeDefined();
    expect(await screen.findByText(/72 holes/)).toBeDefined();
    expect(screen.getAllByText(/\d+ holes/)).toHaveLength(2);
  });
});

describe('job detail', () => {
  it('shows the count as a spec row', () => {
    wrap(<StringingJobDetail job={job('Li-Ning AxForce 80')} onBack={() => {}} onChanged={() => {}}
      holesFor={() => ({ catalogId: 'racket-li-ning-axforce-80', holes: 72 })} />);
    expect(screen.getByText('Holes')).toBeDefined();
    expect(screen.getByText('72 holes')).toBeDefined();
  });

  it('offers to add a count for a known racket nobody has counted', () => {
    const onAddHoles = vi.fn();
    wrap(<StringingJobDetail job={job('Li-Ning AxForce 80')} onBack={() => {}} onChanged={() => {}}
      holesFor={() => ({ catalogId: 'racket-li-ning-axforce-80', holes: null })} onAddHoles={onAddHoles} />);
    fireEvent.click(screen.getByRole('button', { name: 'Add a hole count' }));
    expect(onAddHoles).toHaveBeenCalledWith('racket-li-ning-axforce-80');
  });

  it('says nothing for a racket the catalog does not know', () => {
    wrap(<StringingJobDetail job={job('my old racket')} onBack={() => {}} onChanged={() => {}}
      holesFor={() => ({ catalogId: null, holes: null })} onAddHoles={() => {}} />);
    expect(screen.queryByText('Holes')).toBeNull();
    expect(screen.queryByRole('button', { name: 'Add a hole count' })).toBeNull();
  });
});

describe('the intake suggests catalog names (4b)', () => {
  it('a typed racket offers catalog names, and picking one writes the exact name', async () => {
    respond({});
    wrap(<StringingIntake onBack={() => {}} onCreated={() => {}} />);
    const input = screen.getByLabelText('Racket, e.g. Astrox 99 Pro') as HTMLInputElement;
    fireEvent.change(input, { target: { value: '88d pro' } });
    fireEvent.click(await screen.findByRole('button', { name: 'Yonex Astrox 88D Pro' }));
    expect(input.value).toBe('Yonex Astrox 88D Pro');
    // An exact catalog name needs no suggestions.
    await waitFor(() => expect(screen.queryByRole('group', { name: 'Catalog rackets that match' })).toBeNull());
  });
});

describe('the stringer’s card', () => {
  it('shows the count on an assigned job', async () => {
    respond({ stringerJobs: [job('Yonex Astrox 100ZZ')] });
    wrap(<StringerJobsCard hasIdentity />);
    expect(await screen.findByText(/76 holes/)).toBeDefined();
  });

  it('reads neither the catalog nor the counts for a member with no assigned job', async () => {
    const calls = respond({ stringerJobs: [] });
    wrap(<StringerJobsCard hasIdentity showEmpty />);
    await waitFor(() => expect(calls.some((u) => u.includes('view=stringer'))).toBe(true));
    await new Promise((r) => setTimeout(r, 20));
    expect(calls.some((u) => u.includes('/api/stringing/holes') || u.includes('/api/equipment/catalog'))).toBe(false);
  });
});
