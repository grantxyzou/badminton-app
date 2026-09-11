// @vitest-environment node
import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import { GET } from '@/app/api/admin/slice0/route';
import {
  resetMockStore,
  getStore,
  setupAdminPin,
  seedAdminMember,
  seedPlayer,
  seedMember,
  makeGetRequest,
} from './helpers';

/**
 * The readout that finally makes the Slice-0 gate decidable. The behaviours
 * worth pinning are the ones that would otherwise produce a confidently wrong
 * go/no-go: the "more than once" filter, the attendance denominator, and the
 * refusal to render a verdict from an empty cohort.
 */

const URL_BASE = 'http://localhost/bpm/api/admin/slice0';

/**
 * Fixtures live in `session-2026-07-02`, which is deliberately BEFORE the
 * route's production default (CLOCK_RESTART, 2026-08-16). Cases about cohort
 * math pass this explicitly rather than leaning on the default — a test of the
 * arithmetic should not fail the day the default window moves, and the two
 * cases that DO assert the default say so in their names.
 */
const URL_FIXTURES = `${URL_BASE}?since=2026-06-13`;

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

    const body = await (await GET(makeGetRequest(URL_FIXTURES, true))).json();
    expect(body.cohortSize).toBe(6);
  });

  it('only counts a member toward the rec-card half when they tapped MORE THAN ONCE', async () => {
    seedCohort();
    seedEvent('member-lin', '2026-07-02T10:00:00.000Z');
    seedEvent('member-lin', '2026-07-03T10:00:00.000Z'); // Lin: repeat
    seedEvent('member-viktor', '2026-07-02T10:00:00.000Z'); // Viktor: single tap only

    const body = await (await GET(makeGetRequest(URL_FIXTURES, true))).json();
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

    const body = await (await GET(makeGetRequest(URL_FIXTURES, true))).json();
    expect(body.recCard.repeatTappers).toBe(0);
  });

  it('counts distinct game loggers case-insensitively', async () => {
    seedCohort();
    seedGame('Lin', '2026-07-02T10:00:00.000Z');
    seedGame('lin', '2026-07-03T10:00:00.000Z'); // same human
    seedGame('Viktor', '2026-07-03T10:00:00.000Z');

    const body = await (await GET(makeGetRequest(URL_FIXTURES, true))).json();
    expect(body.games.loggers).toBe(2);
    expect(body.games.rate).toBeCloseTo(2 / 6, 3);
  });

  it('passes the game half once a third of the cohort logs', async () => {
    seedCohort();
    seedGame('Lin', '2026-07-02T10:00:00.000Z');
    seedGame('Viktor', '2026-07-02T10:00:00.000Z');

    const body = await (await GET(makeGetRequest(URL_FIXTURES, true))).json();
    expect(body.games.passes).toBe(true);
    // Criterion kills only when BOTH halves miss.
    expect(body.verdict).toBe('keep');
  });

  it('returns kill only when both halves miss', async () => {
    seedCohort();
    const body = await (await GET(makeGetRequest(URL_FIXTURES, true))).json();
    expect(body.recCard.passes).toBe(false);
    expect(body.games.passes).toBe(false);
    expect(body.verdict).toBe('kill');
  });

  it('refuses a verdict on an empty cohort instead of reporting a confident kill', async () => {
    const body = await (await GET(makeGetRequest(URL_FIXTURES, true))).json();
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

  it('falls back to the CLOCK RESTART when ?since is garbage', async () => {
    // Not the v1.7 date (2026-06-13). The Equipment register was parked under
    // the assessment spine until 2026-08-16, so the rec card rendered on
    // neither deployment before then — defaulting to the earlier window
    // measures a surface that wasn't there and manufactures a `kill`.
    const body = await (await GET(makeGetRequest(`${URL_BASE}?since=not-a-date`, true))).json();
    expect(body.since).toBe('2026-08-16');
  });

  it('defaults to the clock restart when ?since is absent entirely', async () => {
    const body = await (await GET(makeGetRequest(URL_BASE, true))).json();
    expect(body.since).toBe('2026-08-16');
  });

  it('reports racket saves as a secondary signal', async () => {
    seedCohort();
    // The gear owners are seeded as real MEMBERS, not just invented ids.
    // `racketSavers` is narrowed to the roster like every other count on this
    // page, and `playerGear` carries no name, so a row whose `memberId` belongs
    // to nobody has no way to be placed on a roster and is dropped. In
    // production every gear row is written by a signed-in member, so a fixture
    // that invents ids is testing a shape the app cannot produce.
    seedMember('Lin', { id: 'member-lin' });
    seedMember('Viktor', { id: 'member-viktor' });
    const store = getStore();
    store['playerGear'] = [
      { id: 'gear-1', memberId: 'member-lin', items: [{ id: 'i1', category: 'racket', label: 'Astrox 88D' }] },
      { id: 'gear-2', memberId: 'member-viktor', items: [{ id: 'i2', category: 'shoes', label: 'Comfort Z3' }] },
    ];

    const body = await (await GET(makeGetRequest(URL_FIXTURES, true))).json();
    // One racket, one pair of shoes.
    expect(body.racketSavers).toBe(1);
  });

  it('does NOT count a racket saved by someone off the roster', async () => {
    seedCohort();
    seedMember('Lin', { id: 'member-lin' });
    const store = getStore();
    store['playerGear'] = [
      { id: 'gear-1', memberId: 'member-lin', items: [{ id: 'i1', category: 'racket', label: 'Astrox 88D' }] },
      // A member who left, or — once the flag is on — someone in another club.
      { id: 'gear-2', memberId: 'member-stranger', items: [{ id: 'i2', category: 'racket', label: 'Someone else' }] },
    ];

    const body = await (await GET(makeGetRequest(URL_FIXTURES, true))).json();
    // The read used to scan the whole container, so this was 2 — and a metric
    // that is too HIGH reads as a good week rather than as a bug.
    expect(body.racketSavers).toBe(1);
  });

  it('reports the fit engine\'s feedback loop, split by engine version, from the same append-only log', async () => {
    seedAdminMember();
    const store = getStore();
    if (!store['events']) store['events'] = [];
    const at = '2026-09-10T00:00:00Z';
    store['events'].push(
      { id: 'p1', memberId: 'a', name: 'a', kind: 'pick_served', at, catalogId: 'r1', engineVersion: 'fit-1' },
      { id: 'p2', memberId: 'a', name: 'a', kind: 'pick_served', at, catalogId: 'r1', engineVersion: 'fit-1' },
      { id: 'p3', memberId: 'b', name: 'b', kind: 'pick_served', at, catalogId: 'r2', engineVersion: 'fit-1' },
      { id: 'p4', memberId: 'a', name: 'a', kind: 'pick_added', at, catalogId: 'r1', engineVersion: 'fit-1' },
      { id: 'p5', memberId: 'a', name: 'a', kind: 'pick_rated', at, catalogId: 'r1', engineVersion: 'fit-1', rating: 'up' },
      { id: 'p6', memberId: 'b', name: 'b', kind: 'pick_rated', at, catalogId: 'r2', engineVersion: 'fit-1', rating: 'down' },
      { id: 'p7', memberId: 'b', name: 'b', kind: 'pick_tried', at, catalogId: 'r2', engineVersion: 'fit-1' },
      { id: 'p8', memberId: 'c', name: 'c', kind: 'pick_served', at, catalogId: 'r1', engineVersion: 'fit-1' },
    );
    const body = await (await GET(makeGetRequest(`${URL_BASE}?since=2026-09-01`, true))).json();
    expect(body.picks.engineVersions['fit-1']).toEqual({ served: 4, servedMembers: 3, added: 1, tried: 1, ratedUp: 1, ratedDown: 1 });
    expect(body.picks.byCatalogId).toEqual({ r1: { added: 1, tried: 0, up: 1, down: 0 }, r2: { added: 0, tried: 1, up: 0, down: 1 } });
    // Served is the denominator, never engagement: two members were served,
    // and both acted — but a third who was only served would not count.
    expect(body.picks.engagedMembers).toBe(2);
  });

  /**
   * The skill funnel. Its denominator is the ROSTER, not attendance — the two
   * blocks on this route are deliberately not comparable, and these cases are
   * what stop someone silently making them so again.
   */
  describe('skill block', () => {
    const AT = '2026-07-02T10:00:00.000Z';
    function seedSkillEvent(memberId: string, name: string, kind: string, source?: string) {
      const store = getStore();
      if (!store['events']) store['events'] = [];
      store['events'].push({ id: `sk-${store['events'].length}`, memberId, name, kind, at: AT, ...(source ? { source } : {}) });
    }
    function seedAssessment(memberId: string, name: string, takenAt: string, ratingCount = 14) {
      const store = getStore();
      if (!store['assessments']) store['assessments'] = [];
      const ratings: Record<string, number> = {};
      for (let i = 0; i < ratingCount; i += 1) ratings[`skill_${i}`] = 3;
      store['assessments'].push({ id: `as-${store['assessments'].length}`, memberId, name, takenAt, ratings });
    }

    it('denominates on the ROSTER, not on attendance', async () => {
      // Four on the roster; only one of them turned up since the cutoff.
      const lin = seedMember('Lin');
      seedMember('Viktor');
      seedMember('Carolina');
      seedPlayer('session-2026-07-02', 'Lin');
      seedSkillEvent(lin.id, 'Lin', 'stats_open');

      const body = await (await GET(makeGetRequest(URL_FIXTURES, true))).json();
      expect(body.cohortSize).toBe(1);              // attendance
      expect(body.skill.rosterSize).toBe(4);        // roster (3 + the seeded admin)
      expect(body.skill.statsOpeners).toBe(1);
      expect(body.skill.rates.reach).toBeCloseTo(1 / 4, 3);
    });

    it('drops an event from someone who is not on the roster', async () => {
      seedMember('Lin');
      seedSkillEvent('member-ghost', 'Ghost', 'stats_open');

      const body = await (await GET(makeGetRequest(URL_FIXTURES, true))).json();
      expect(body.skill.statsOpeners).toBe(0);
    });

    it('reports a ratio on an empty denominator as NULL, never 0', async () => {
      seedMember('Lin');
      // Nobody opened Stats, so `entry` and `finish` have no denominator. A
      // confident 0 there points the reader at the wrong stage of the funnel.
      const body = await (await GET(makeGetRequest(URL_FIXTURES, true))).json();
      expect(body.skill.rates.entry).toBeNull();
      expect(body.skill.rates.finish).toBeNull();
      expect(body.skill.rates.reach).toBe(0);   // this one HAS a denominator
    });

    it('counts openBySource as EVENTS and checkInOpeners as MEMBERS', async () => {
      const lin = seedMember('Lin');
      seedSkillEvent(lin.id, 'Lin', 'checkin_open', 'strip');
      seedSkillEvent(lin.id, 'Lin', 'checkin_open', 'strip');
      seedSkillEvent(lin.id, 'Lin', 'checkin_open', 'trend');

      const body = await (await GET(makeGetRequest(URL_FIXTURES, true))).json();
      expect(body.skill.checkInOpeners).toBe(1);
      expect(body.skill.openBySource).toEqual({ strip: 2, trend: 1, learn: 0, unknown: 0 });
    });

    it('files an event with no source under unknown rather than dropping it', async () => {
      const lin = seedMember('Lin');
      seedSkillEvent(lin.id, 'Lin', 'checkin_open');
      const body = await (await GET(makeGetRequest(URL_FIXTURES, true))).json();
      expect(body.skill.openBySource.unknown).toBe(1);
      expect(body.skill.checkInOpeners).toBe(1);
    });

    it('reads completions from the assessments container, all-time and in-window', async () => {
      const lin = seedMember('Lin');
      const vik = seedMember('Viktor');
      seedAssessment(lin.id, 'Lin', '2026-01-01T00:00:00.000Z');   // before the window
      seedAssessment(lin.id, 'Lin', '2026-07-05T00:00:00.000Z');   // in window -> Lin repeats
      seedAssessment(vik.id, 'Viktor', '2026-01-02T00:00:00.000Z'); // before only

      const body = await (await GET(makeGetRequest(URL_FIXTURES, true))).json();
      expect(body.skill.everCheckedIn).toBe(2);      // both, all-time
      expect(body.skill.repeatCheckedIn).toBe(1);    // Lin only
      expect(body.skill.checkedInWindow).toBe(1);    // Lin only
    });

    it('counts a partial save as partial', async () => {
      const lin = seedMember('Lin');
      seedAssessment(lin.id, 'Lin', '2026-07-05T00:00:00.000Z', 3);
      const body = await (await GET(makeGetRequest(URL_FIXTURES, true))).json();
      expect(body.skill.partialSaves).toBe(1);
    });
  });
});
