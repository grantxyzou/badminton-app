// @vitest-environment jsdom
import { describe, it, expect, afterEach, beforeEach, vi } from 'vitest';
import { render, screen, cleanup, fireEvent, waitFor } from '@testing-library/react';
import { NextIntlClientProvider } from 'next-intl';
import enMessages from '@/messages/en.json';
import SkillLeadCard, { leadFor } from '@/components/home/SkillLeadCard';
import { resetSharedReads } from '@/lib/sharedRead';

/**
 * The Home skill lead (docs/plans/home-skill-lead.md). The arithmetic is
 * `leadFor`, tested as data; the card tests pin the two things the data
 * cannot: that a failed read never renders as a fact, and that the tap is
 * recorded as a Stats open led from Home.
 */
afterEach(() => { cleanup(); vi.restoreAllMocks(); });
beforeEach(() => resetSharedReads());

const snap = (takenAt: string, overall: number | null) => ({ takenAt, overall });
const bands = (cohort: number, t = 5.8, p = 6.1, m = 5.4) => ({ cohort, minCohort: 3, dimensionMedians: { technical: t, physical: p, mental: m } });

describe('leadFor — which line a member gets', () => {
  it('never rated, spread known: the group line', () => {
    expect(leadFor([], bands(12))).toEqual({ kind: 'spread', cohort: 12, technical: 5.8, physical: 6.1, mental: 5.4 });
  });
  it('never rated, below the cohort floor: "fewer than N", and no medians', () => {
    expect(leadFor([], bands(2))).toEqual({ kind: 'first', min: 3 });
  });
  it('never rated, bands unreadable: the unrated line makes no claim about the group', () => {
    expect(leadFor([], null)).toEqual({ kind: 'unrated' });
    expect(leadFor([], bands(12, 5.8, 6.1, null as unknown as number))).toEqual({ kind: 'unrated' });
  });
  it('rated once: the level, and that a second rating shows the change', () => {
    expect(leadFor([snap('2026-09-01', 6.2)], null)).toEqual({ kind: 'once', level: 6.2 });
  });
  it('rated twice: the level and the change since the PREVIOUS one, not the first', () => {
    const lead = leadFor([snap('2026-07-01', 5.0), snap('2026-09-01', 5.9), snap('2026-10-01', 6.2)], null);
    expect(lead.kind).toBe('trend');
    if (lead.kind === 'trend') {
      expect(lead.level).toBe(6.2);
      expect(lead.delta).toBeCloseTo(0.3, 5);
      expect(lead.since).toBe('2026-09-01');
    }
  });
  it('a snapshot with no overall cannot be quoted: it is skipped, never read as zero', () => {
    expect(leadFor([snap('2026-09-01', null), snap('2026-10-01', 6.2)], null)).toEqual({ kind: 'once', level: 6.2 });
    expect(leadFor([snap('2026-09-01', null)], null)).toEqual({ kind: 'plain' });
  });
});

function wrap(ui: React.ReactElement) {
  return render(<NextIntlClientProvider locale="en" messages={enMessages}>{ui}</NextIntlClientProvider>);
}

function mockFetch(answer: (url: string) => { status: number; body: unknown } | undefined) {
  const calls: string[] = [];
  const fn = vi.fn(async (input: RequestInfo | URL, init?: RequestInit) => {
    const url = String(input);
    calls.push(`${init?.method ?? 'GET'} ${url}`);
    const a = answer(url) ?? { status: 200, body: {} };
    return new Response(JSON.stringify(a.body), { status: a.status, headers: { 'content-type': 'application/json' } });
  });
  global.fetch = fn as unknown as typeof fetch;
  return calls;
}

describe('<SkillLeadCard />', () => {
  it('renders the trend line for a member rated twice, from the two reads it is allowed', async () => {
    const calls = mockFetch((u) => (u.includes('/api/assessments') ? { status: 200, body: { assessments: [snap('2026-09-03T10:00:00Z', 5.9), snap('2026-10-01T10:00:00Z', 6.2)] } } : undefined));
    wrap(<SkillLeadCard name="Lin" onOpen={() => {}} />);
    expect(await screen.findByText('Level 6.2 overall, up 0.3 since September.')).toBeTruthy();
    expect(screen.getByText('See the trend →')).toBeTruthy();
    // A member with a history costs no bands read.
    expect(calls.filter((c) => c.includes('/api/stats/club/bands'))).toEqual([]);
  });

  it('renders the group spread for a member who has never rated, in the third person', async () => {
    mockFetch((u) => u.includes('/api/assessments') ? { status: 200, body: { assessments: [] } }
      : u.includes('/api/stats/club/bands') ? { status: 200, body: bands(12) } : undefined);
    wrap(<SkillLeadCard name="Lin" onOpen={() => {}} />);
    expect(await screen.findByText('The group: 12 people have rated. Technical 5.8, physical 6.1, mental 5.4.')).toBeTruthy();
    expect(screen.getByText('Rate skills →')).toBeTruthy();
  });

  it('a failed history read renders the plain line — never "unrated", never a number', async () => {
    mockFetch((u) => (u.includes('/api/assessments') ? { status: 500, body: { error: 'load_failed' } } : undefined));
    wrap(<SkillLeadCard name="Lin" onOpen={() => {}} />);
    expect(await screen.findByText('Ratings and the trend live in Stats.')).toBeTruthy();
    expect(screen.queryByText(/have rated/)).toBeNull();
    expect(screen.queryByText(/Level /)).toBeNull();
  });

  it('the tap records a Stats open led from Home, then opens Stats', async () => {
    const calls = mockFetch((u) => (u.includes('/api/assessments') ? { status: 200, body: { assessments: [snap('2026-09-01', 6.2)] } } : undefined));
    const onOpen = vi.fn();
    wrap(<SkillLeadCard name="Lin" onOpen={onOpen} />);
    fireEvent.click(await screen.findByRole('button'));
    expect(onOpen).toHaveBeenCalledTimes(1);
    await waitFor(() => expect(calls.some((c) => c.startsWith('POST') && c.includes('/api/events'))).toBe(true));
    const body = JSON.parse(String((global.fetch as ReturnType<typeof vi.fn>).mock.calls.find((c) => String(c[0]).includes('/api/events'))?.[1]?.body));
    expect(body).toMatchObject({ kind: 'stats_open', source: 'home' });
  });
});
