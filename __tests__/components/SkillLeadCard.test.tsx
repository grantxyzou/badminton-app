// @vitest-environment jsdom
import { describe, it, expect, afterEach, beforeEach, vi } from 'vitest';
import { render, screen, cleanup, fireEvent, waitFor } from '@testing-library/react';
import { NextIntlClientProvider } from 'next-intl';
import enMessages from '@/messages/en.json';
import SkillLeadCard, { leadFor, sparkPoints } from '@/components/home/SkillLeadCard';
import { resetSharedReads } from '@/lib/sharedRead';

/**
 * The Home skill lead (docs/plans/home-skill-lead.md). The arithmetic is
 * `leadFor` and `sparkPoints`, tested as data; the card tests pin what the
 * data cannot: the words each state shows, that a failed read never renders
 * as a fact, and that the tap is recorded as a Stats open led from Home.
 */
afterEach(() => { cleanup(); vi.restoreAllMocks(); });
beforeEach(() => resetSharedReads());

/** A level read: the canonical level and its trail (`docs/plans/one-level.md`). */
const pt = (at: string, level: number) => ({ at, level });
const read = (...trail: { at: string; level: number }[]) => ({ level: trail.length ? trail[trail.length - 1].level : null, trail });
const unrated = { level: null, trail: [] };
const bands = (cohort: number, t = 5.8, p = 6.1, m = 5.4) => ({ cohort, minCohort: 3, dimensionMedians: { technical: t, physical: p, mental: m } });

describe('leadFor — which line a member gets', () => {
  it('never rated, spread known: the group line', () => {
    expect(leadFor(unrated, bands(12))).toEqual({ kind: 'spread', cohort: 12, technical: 5.8, physical: 6.1, mental: 5.4 });
  });
  it('never rated, below the cohort floor: "fewer than N", and no medians', () => {
    expect(leadFor(unrated, bands(2))).toEqual({ kind: 'first', min: 3 });
  });
  it('never rated, bands unreadable: the unrated line makes no claim about the group', () => {
    expect(leadFor(unrated, null)).toEqual({ kind: 'unrated' });
    expect(leadFor(unrated, bands(12, 5.8, 6.1, null as unknown as number))).toEqual({ kind: 'unrated' });
  });
  it('rated once: the level, and that a second rating shows the change', () => {
    expect(leadFor(read(pt('2026-09-01', 6.2)), null)).toEqual({ kind: 'once', level: 6.2, at: '2026-09-01' });
  });
  it('rated twice: the level and the change since the PREVIOUS one, not the first', () => {
    const lead = leadFor(read(pt('2026-07-01', 5.0), pt('2026-09-01', 5.9), pt('2026-10-01', 6.2)), null);
    expect(lead.kind).toBe('trend');
    if (lead.kind === 'trend') {
      expect(lead.level).toBe(6.2);
      expect(lead.delta).toBeCloseTo(0.3, 5);
      expect(lead.since).toBe('2026-09-01');
      expect(lead.points).toEqual([5.0, 5.9, 6.2]);
    }
  });
  it('the trend line carries only the most recent six check-ins', () => {
    const many = [1, 2, 3, 4, 5, 6, 7, 8].map((i) => pt(`2026-0${i}-01`, 2 + i / 10));
    const lead = leadFor(read(...many), null);
    expect(lead.kind === 'trend' && lead.points.length).toBe(6);
    expect(lead.kind === 'trend' && lead.points[0]).toBeCloseTo(2.3, 5);
  });
  it('a level with no check-in under it (a saved-stage estimate) is the plain line, never a bare number', () => {
    expect(leadFor({ level: 2.5, trail: [] }, bands(12))).toEqual({ kind: 'plain' });
  });
});

describe('sparkPoints — the trend line inside its 124×44 box', () => {
  it('runs left to right, and a higher level sits higher (smaller y)', () => {
    const pts = sparkPoints([2.9, 3.4]);
    expect(pts[0].x).toBeLessThan(pts[1].x);
    expect(pts[1].y).toBeLessThan(pts[0].y);
  });
  it('stays inside the box, and a flat run is a flat line in the middle', () => {
    for (const p of sparkPoints([1, 5, 3, 4.9])) {
      expect(p.x).toBeGreaterThanOrEqual(0); expect(p.x).toBeLessThanOrEqual(124);
      expect(p.y).toBeGreaterThanOrEqual(0); expect(p.y).toBeLessThanOrEqual(44);
    }
    expect(sparkPoints([3.2, 3.2]).map((p) => p.y)).toEqual([22, 22]);
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
    const calls = mockFetch((u) => (u.includes('/api/stats/level') ? { status: 200, body: { level: read(pt('2026-09-03T10:00:00Z', 5.9), pt('2026-10-01T10:00:00Z', 6.2)) } } : undefined));
    wrap(<SkillLeadCard name="Lin" club="BPM Badminton" onOpen={() => {}} />);
    expect(await screen.findByText('Your level is climbing')).toBeTruthy();
    expect(screen.getByText('6.2')).toBeTruthy();
    expect(screen.getByText('/ 5')).toBeTruthy();
    expect(screen.getByText('+0.3 since September')).toBeTruthy();
    // What Stats holds, named on the card.
    expect(screen.getByText('Your record')).toBeTruthy();
    // A member with a history costs no bands read.
    expect(calls.filter((c) => c.includes('/api/stats/club/bands'))).toEqual([]);
  });

  it('a drop reads as a dip with a minus, never as a rise', async () => {
    mockFetch((u) => (u.includes('/api/stats/level') ? { status: 200, body: { level: read(pt('2026-09-03T10:00:00Z', 3.4), pt('2026-10-01T10:00:00Z', 3.1)) } } : undefined));
    wrap(<SkillLeadCard name="Lin" club="BPM Badminton" onOpen={() => {}} />);
    expect(await screen.findByText('Your level dipped a little')).toBeTruthy();
    expect(screen.getByText('−0.3 since September')).toBeTruthy();
  });

  it('rated once: the level and the ask for a second check-in', async () => {
    mockFetch((u) => (u.includes('/api/stats/level') ? { status: 200, body: { level: read(pt('2026-09-03T10:00:00Z', 3.2)) } } : undefined));
    wrap(<SkillLeadCard name="Lin" club="BPM Badminton" onOpen={() => {}} />);
    expect(await screen.findByText('One more check-in to see it move')).toBeTruthy();
    expect(screen.getByText('3.2')).toBeTruthy();
    expect(screen.getByText('Starting point · September')).toBeTruthy();
  });

  it('never rated: the club\'s average levels by name, and "Add yours"', async () => {
    mockFetch((u) => u.includes('/api/stats/level') ? { status: 200, body: { level: unrated } }
      : u.includes('/api/stats/club/bands') ? { status: 200, body: bands(12, 3.1, 3.4, 2.9) } : undefined);
    wrap(<SkillLeadCard name="Lin" club="BPM Badminton" onOpen={() => {}} />);
    expect(await screen.findByText("This is BPM Badminton's average skill level")).toBeTruthy();
    expect(screen.getByText('Technical')).toBeTruthy();
    expect(screen.getByText('3.4')).toBeTruthy();
    expect(screen.getByText('Add yours')).toBeTruthy();
  });

  it('below the cohort floor: no bars, no medians', async () => {
    mockFetch((u) => u.includes('/api/stats/level') ? { status: 200, body: { level: unrated } }
      : u.includes('/api/stats/club/bands') ? { status: 200, body: bands(2, 3.1, 3.4, 2.9) } : undefined);
    wrap(<SkillLeadCard name="Lin" club="BPM Badminton" onOpen={() => {}} />);
    expect(await screen.findByText('Fewer than 3 people in BPM Badminton have rated so far')).toBeTruthy();
    expect(screen.queryByText('Technical')).toBeNull();
    expect(screen.queryByText('3.4')).toBeNull();
  });

  it('a failed history read renders the plain line — never "unrated", never a number', async () => {
    mockFetch((u) => (u.includes('/api/stats/level') ? { status: 500, body: { error: 'load_failed' } } : undefined));
    wrap(<SkillLeadCard name="Lin" club="BPM Badminton" onOpen={() => {}} />);
    expect(await screen.findByText('Your level, trend and tips live in Stats')).toBeTruthy();
    expect(screen.queryByText(/average skill level/)).toBeNull();
    expect(screen.queryByText('/ 5')).toBeNull();
  });

  it('the tap records a Stats open led from Home, then opens Stats', async () => {
    const calls = mockFetch((u) => (u.includes('/api/stats/level') ? { status: 200, body: { level: read(pt('2026-09-01', 6.2)) } } : undefined));
    const onOpen = vi.fn();
    wrap(<SkillLeadCard name="Lin" club="BPM Badminton" onOpen={onOpen} />);
    fireEvent.click(await screen.findByRole('button'));
    expect(onOpen).toHaveBeenCalledTimes(1);
    await waitFor(() => expect(calls.some((c) => c.startsWith('POST') && c.includes('/api/events'))).toBe(true));
    const body = JSON.parse(String((global.fetch as ReturnType<typeof vi.fn>).mock.calls.find((c) => String(c[0]).includes('/api/events'))?.[1]?.body));
    expect(body).toMatchObject({ kind: 'stats_open', source: 'home' });
  });
});
