import { describe, it, expect, beforeEach } from 'vitest';
import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { resetMockStore, seedDoc, setupAdminPin, makeRequest } from './helpers';
import { backtestOne, hideOwnRacket, summarizeBacktest, type BacktestOne } from '@/lib/fitBacktest';
import { buildFitInput } from '@/lib/racketFitInput';
import { recommendFit } from '@/lib/racketFit';
import { mintReportsKey } from '@/lib/reportsAccess';
import { GET as backtestGET } from '@/app/api/reports/fit-backtest/route';
import type { CatalogItem, PlayerGear } from '@/lib/types';

/**
 * The owned-racket backtest (lib/fitBacktest.ts): hide what a member plays,
 * run the engine from scratch, compare classes. Pure over the real catalog
 * file, then the reports-key route, which must answer totals and nothing per
 * person.
 */
const catalogFile = JSON.parse(readFileSync(join(process.cwd(), 'scripts/data/equipment-catalog.json'), 'utf8')) as { items?: CatalogItem[] } | CatalogItem[];
const catalog = (Array.isArray(catalogFile) ? catalogFile : catalogFile.items ?? []).filter((i) => i.category === 'racket');
const byId = (id: string) => catalog.find((r) => r.id === id)!;

function gearWith(catalogId: string | null, over: Partial<PlayerGear> = {}, label = 'Some racket'): PlayerGear {
  return {
    id: 'gear-m1', memberId: 'm1', updatedAt: '2026-01-01T00:00:00Z',
    items: [{ id: 'i1', catalogId, category: 'racket', label }],
    activeRacketId: 'i1',
    ...over,
  } as PlayerGear;
}

describe('backtestOne — pure', () => {
  it('hides the owned racket: no anchor, and the racket is back in the running', () => {
    const gear = gearWith('racket-yonex-nanoflare-700', { fitGoal: 'faster', fitSwing: 'medium' });
    const base = buildFitInput(gear, [], catalog);
    expect(base.anchor?.id).toBe('racket-yonex-nanoflare-700');
    expect(base.ownedIds.has('racket-yonex-nanoflare-700')).toBe(true);
    const hidden = hideOwnRacket(base, byId('racket-yonex-nanoflare-700'), 'happy');
    expect(hidden.anchor).toBeNull();
    expect(hidden.ownedIds.has('racket-yonex-nanoflare-700')).toBe(false);
    expect(hidden.goal).toBe('happy');
    // The engine may now return the truth itself — the whole point of hiding it.
    const ranked = recommendFit(hidden, catalog);
    expect(ranked.fitState).toBe('unanchored');
  });

  it('a head-light speed frame owner who wants speed is handed a head-light frame; "as if happy" is the level floor', () => {
    const r = backtestOne({ gear: gearWith('racket-yonex-nanoflare-700', { fitGoal: 'faster', fitSwing: 'medium' }), ratings: [] }, catalog);
    expect(r.kind).toBe('case');
    if (r.kind !== 'case') return;
    expect(r.outcome.truthClass).toEqual({ balance: 1, flex: 2, tier: 3 });
    expect(r.outcome.goal).toBe('faster');
    expect(r.outcome.asAnswered.balance).toBe(true);
    expect(r.outcome.asAnswered.flexWithin1).toBe(true);
    // With no anchor and no goal to steer by, the engine aims at the level
    // default — even — so the head-light owner misses the floor on balance.
    // That is what the floor is for: it is what "knowing only the level" buys.
    expect(r.outcome.asIfHappy.targetBalance).toBe(false);
  });

  it('"as answered" keeps the goal, so a power seeker is steered off their own balance on purpose', () => {
    // Owns an even, medium frame and wants more power with a fast swing: the
    // engine SHOULD move the head heavier, so the as-answered balance misses.
    const r = backtestOne({ gear: gearWith('racket-yonex-arcsaber-7-tour', { fitGoal: 'more_power', fitSwing: 'fast' }), ratings: [] }, catalog);
    expect(r.kind).toBe('case');
    if (r.kind !== 'case') return;
    expect(r.outcome.asAnswered.targetBalance).toBe(false);
    expect(r.outcome.asIfHappy.targetBalance).toBe(true);
  });

  it('skips with a reason: no racket, a typed-in racket, nothing to go on', () => {
    expect(backtestOne({ gear: { ...gearWith(null), items: [] } as PlayerGear, ratings: [] }, catalog)).toEqual({ kind: 'skip', reason: 'no_active_racket' });
    expect(backtestOne({ gear: gearWith(null, {}, 'Carlton something'), ratings: [] }, catalog)).toEqual({ kind: 'skip', reason: 'racket_not_in_catalog' });
    // A catalog racket but no swing and no check-in: hidden, the engine has nothing.
    expect(backtestOne({ gear: gearWith('racket-yonex-nanoflare-700'), ratings: [] }, catalog)).toEqual({ kind: 'skip', reason: 'nothing_to_go_on' });
  });

  it('a check-in alone is enough to go on (level_only)', () => {
    const ratings = ['clears', 'smashes', 'consistency', 'footwork'].map((skillKey) => ({ skillKey, value: 2, source: 'self' as const }));
    const r = backtestOne({ gear: gearWith('racket-victor-brave-sword-1500'), ratings }, catalog);
    expect(r.kind).toBe('case');
    if (r.kind === 'case') expect(r.outcome.fitState).toBe('level_only');
  });
});

describe('summarizeBacktest — totals', () => {
  it('counts skips, classes and matches, and the headline needs all three axes', () => {
    const results: BacktestOne[] = [
      { kind: 'skip', reason: 'no_active_racket' },
      { kind: 'skip', reason: 'racket_not_in_catalog' },
      { kind: 'case', outcome: { fitState: 'unanchored', truthClass: { balance: 1, flex: 2, tier: 3 }, goal: 'faster',
        asAnswered: { exactTop1: false, exactTop3: true, balance: true, flexWithin1: true, weightWithin3: null, tier: true, targetBalance: true },
        asIfHappy: { exactTop1: true, exactTop3: true, balance: true, flexWithin1: true, weightWithin3: true, tier: true, targetBalance: true } } },
      { kind: 'case', outcome: { fitState: 'level_only', truthClass: { balance: 3, flex: 4, tier: 3 }, goal: 'unanswered',
        asAnswered: { exactTop1: false, exactTop3: false, balance: false, flexWithin1: true, weightWithin3: false, tier: true, targetBalance: false },
        asIfHappy: { exactTop1: false, exactTop3: false, balance: false, flexWithin1: true, weightWithin3: false, tier: true, targetBalance: false } } },
    ];
    const s = summarizeBacktest(results, new Date('2026-11-04T00:00:00Z'));
    expect(s.considered).toBe(4);
    expect(s.cases).toBe(2);
    expect(s.skipped).toEqual({ no_active_racket: 1, racket_not_in_catalog: 1, racket_unscorable: 0, nothing_to_go_on: 0 });
    expect(s.truth.balance).toEqual({ 'head-light': 1, 'head-heavy': 1 });
    expect(s.asIfHappy).toEqual({ n: 2, exactTop1: 1, exactTop3: 1, balance: 1, flexWithin1: 2, weightWithin3: { hits: 1, of: 2 }, tier: 2, targetBalance: 1 });
    expect(s.asAnswered).toEqual({ n: 2, exactTop1: 0, exactTop3: 1, balance: 1, flexWithin1: 2, weightWithin3: { hits: 0, of: 1 }, tier: 2, targetBalance: 1 });
    expect(s.byFitState).toEqual({ unanchored: 1, level_only: 1 });
    expect(s.classMatchRate).toBe(0.5);
  });

  it('with nothing to count the headline is null, never 0', () => {
    expect(summarizeBacktest([{ kind: 'skip', reason: 'no_active_racket' }]).classMatchRate).toBeNull();
    expect(summarizeBacktest([]).cases).toBe(0);
  });
});

describe('GET /api/reports/fit-backtest', () => {
  beforeEach(() => {
    resetMockStore();
    setupAdminPin();
  });

  it('refuses a missing or wrong key', async () => {
    expect((await backtestGET(makeRequest('GET', 'http://x/api/reports/fit-backtest'))).status).toBe(401);
    expect((await backtestGET(makeRequest('GET', 'http://x/api/reports/fit-backtest', undefined, { 'x-reports-key': 'bpm.nope' }))).status).toBe(401);
  });

  it('answers the club totals, and nothing per person', async () => {
    seedDoc('playerGear', gearWith('racket-yonex-nanoflare-700', { fitGoal: 'faster', fitSwing: 'medium' }) as unknown as Record<string, unknown>);
    seedDoc('playerGear', { ...gearWith('racket-yonex-astrox-99-pro', { fitGoal: 'more_power', fitSwing: 'fast' }), id: 'gear-m2', memberId: 'm2' });
    seedDoc('playerGear', { ...gearWith(null, {}, 'Old Carlton'), id: 'gear-m3', memberId: 'm3' });
    const key = await mintReportsKey('bpm');
    const res = await backtestGET(makeRequest('GET', 'http://x/api/reports/fit-backtest', undefined, { 'x-reports-key': key }));
    expect(res.status).toBe(200);
    const body = await res.json();
    expect(body.considered).toBe(3);
    expect(body.cases).toBe(2);
    expect(body.skipped.racket_not_in_catalog).toBe(1);
    expect(body.asIfHappy.n).toBe(2);
    expect(typeof body.classMatchRate).toBe('number');
    const text = JSON.stringify(body);
    expect(text).not.toContain('m1');
    expect(text).not.toContain('gear-');
    expect(text).not.toContain('racket-yonex');
  });
});
