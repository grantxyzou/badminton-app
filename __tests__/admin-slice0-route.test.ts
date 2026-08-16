// @vitest-environment node
import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import { GET } from '@/app/api/admin/slice0/route';
import {
  resetMockStore,
  getStore,
  setupAdminPin,
  seedAdminMember,
  seedPlayer,
  makeGetRequest,
} from './helpers';

/**
 * The readout that finally makes the Slice-0 gate decidable. The behaviours
 * worth pinning are the ones that would otherwise produce a confidently wrong
 * go/no-go: the "more than once" filter, the attendance denominator, and the
 * refusal to render a verdict from an empty cohort.
 */

const URL_BASE = 'http://localhost/bpm/api/admin/slice0';

function seedEvent(memberId: string, at: string, kind = 'rec_card_tap') {
  const store = getStore();
  if (!store['events']) store['events'] = [];
  store['events'].push({ id: `ev-${store['events'].length}`, memberId, name: memberId, kind, at });
}

function seedGame(loggedBy: string, loggedAt: string) {
  const store = getStore();
  if (!store['gameResults']) store['gameResults'] = [];
  store['gameResults'].push({
    id: `g-${store['gameResults'].length}`,
    sessionId: 'session-2026-07-02',
    teamA: ['a'], teamB: ['b'], scoreA: 21, scoreB: 15,
    loggedBy,
    loggedAt,
  });
}

/** Six attendees across two sessions after the cutoff. */
function seedCohort() {
  for (const name of ['Lin', 'Viktor', 'Carolina', 'Akane', 'Kento', 'Sindhu']) {
    seedPlayer('session-2026-07-02', name);
  }
}

beforeEach(() => {
  resetMockStore();
  setupAdminPin();
  seedAdminMember();
});

afterEach(() => {
  delete process.env.NEXT_PUBLIC_FLAG_VALUE_HUB_SLICE;
});

describe('GET /api/admin/slice0', () => {
  it('requires admin auth — the readout exposes per-member activity', async () => {
    const res = await GET(makeGetRequest(URL_BASE));
    expect(res.status).toBe(401);
  });

  it('counts attendance as the cohort, not the members directory', async () => {
    seedCohort();
    // An inactive/removed player must not inflate the denominator.
    seedPlayer('session-2026-07-02', 'Ghost', { removed: true });

    const body = await (await GET(makeGetRequest(URL_BASE, true))).json();
    expect(body.cohortSize).toBe(6);
  });

  it('only counts a member toward the rec-card half when they tapped MORE THAN ONCE', async () => {
    seedCohort();
    seedEvent('member-lin', '2026-07-02T10:00:00.000Z');
    seedEvent('member-lin', '2026-07-03T10:00:00.000Z'); // Lin: repeat
    seedEvent('member-viktor', '2026-07-02T10:00:00.000Z'); // Viktor: single tap only

    const body = await (await GET(makeGetRequest(URL_BASE, true))).json();
    expect(body.recCard.anyTappers).toBe(2);
    expect(body.recCard.repeatTappers).toBe(1);
    expect(body.recCard.rate).toBeCloseTo(1 / 6, 3);
    expect(body.recCard.passes).toBe(false);
  });

  it('ignores events of other kinds and events before the cutoff', async () => {
    seedCohort();
    seedEvent('member-lin', '2026-05-01T10:00:00.000Z'); // before default cutoff
    seedEvent('member-lin', '2026-05-02T10:00:00.000Z'); // before default cutoff
    seedEvent('member-viktor', '2026-07-02T10:00:00.000Z', 'some_other_kind');
    seedEvent('member-viktor', '2026-07-03T10:00:00.000Z', 'some_other_kind');

    const body = await (await GET(makeGetRequest(URL_BASE, true))).json();
    expect(body.recCard.repeatTappers).toBe(0);
  });

  it('counts distinct game loggers case-insensitively', async () => {
    seedCohort();
    seedGame('Lin', '2026-07-02T10:00:00.000Z');
    seedGame('lin', '2026-07-03T10:00:00.000Z'); // same human
    seedGame('Viktor', '2026-07-03T10:00:00.000Z');

    const body = await (await GET(makeGetRequest(URL_BASE, true))).json();
    expect(body.games.loggers).toBe(2);
    expect(body.games.rate).toBeCloseTo(2 / 6, 3);
  });

  it('passes the game half once a third of the cohort logs', async () => {
    seedCohort();
    seedGame('Lin', '2026-07-02T10:00:00.000Z');
    seedGame('Viktor', '2026-07-02T10:00:00.000Z');

    const body = await (await GET(makeGetRequest(URL_BASE, true))).json();
    expect(body.games.passes).toBe(true);
    // Criterion kills only when BOTH halves miss.
    expect(body.verdict).toBe('keep');
  });

  it('returns kill only when both halves miss', async () => {
    seedCohort();
    const body = await (await GET(makeGetRequest(URL_BASE, true))).json();
    expect(body.recCard.passes).toBe(false);
    expect(body.games.passes).toBe(false);
    expect(body.verdict).toBe('kill');
  });

  it('refuses a verdict on an empty cohort instead of reporting a confident kill', async () => {
    const body = await (await GET(makeGetRequest(URL_BASE, true))).json();
    expect(body.cohortSize).toBe(0);
    expect(body.verdict).toBeNull();
  });

  it('honours an explicit ?since cutoff', async () => {
    seedCohort();
    seedGame('Lin', '2026-07-02T10:00:00.000Z');

    const late = await (await GET(makeGetRequest(`${URL_BASE}?since=2026-08-01`, true))).json();
    expect(late.since).toBe('2026-08-01');
    expect(late.games.loggers).toBe(0);
  });

  it('falls back to the v1.7 date when ?since is garbage', async () => {
    const body = await (await GET(makeGetRequest(`${URL_BASE}?since=not-a-date`, true))).json();
    expect(body.since).toBe('2026-06-13');
  });

  it('reports racket saves as a secondary signal', async () => {
    seedCohort();
    const store = getStore();
    store['playerGear'] = [
      { id: 'gear-1', memberId: 'member-lin', items: [{ id: 'i1', category: 'racket', label: 'Astrox 88D' }] },
      { id: 'gear-2', memberId: 'member-viktor', items: [{ id: 'i2', category: 'shoes', label: 'Comfort Z3' }] },
    ];

    const body = await (await GET(makeGetRequest(URL_BASE, true))).json();
    expect(body.racketSavers).toBe(1);
  });
});
