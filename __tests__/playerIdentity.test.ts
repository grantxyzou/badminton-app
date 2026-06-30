import { describe, it, expect, beforeEach } from 'vitest';
import {
  expandAliasNames,
  finiteSessionDate,
  matchesIdentity,
  resolveIdentity,
  classifyOwed,
} from '@/lib/playerIdentity';
import type { Alias, Session } from '@/lib/types';
import { resetMockStore, seedMember, seedAlias } from './helpers';

describe('expandAliasNames', () => {
  const aliases: Alias[] = [
    { id: 'a1', appName: 'Mike', etransferName: 'Michael Chen' },
    { id: 'a2', appName: 'Bea', etransferName: 'Beatrice' },
  ];

  it('always includes the lowercased input name', () => {
    expect(expandAliasNames('Lin', [])).toEqual(new Set(['lin']));
  });

  it('adds the e-transfer name when the app name matches', () => {
    expect(expandAliasNames('Mike', aliases)).toEqual(new Set(['mike', 'michael chen']));
  });

  it('is bidirectional — matching the e-transfer name adds the app name', () => {
    expect(expandAliasNames('Michael Chen', aliases)).toEqual(new Set(['michael chen', 'mike']));
  });

  it('does not merge unrelated names', () => {
    expect(expandAliasNames('Lin', aliases)).toEqual(new Set(['lin']));
  });
});

describe('finiteSessionDate', () => {
  it('accepts a valid ISO datetime', () => {
    expect(finiteSessionDate({ datetime: '2026-06-01T19:00:00-04:00' })).toBe(true);
  });
  it('rejects a malformed datetime', () => {
    expect(finiteSessionDate({ datetime: 'not-a-date' })).toBe(false);
  });
  it('rejects a missing datetime', () => {
    expect(finiteSessionDate({ datetime: undefined as unknown as string })).toBe(false);
  });
});

describe('matchesIdentity', () => {
  const idy = { memberId: 'm-1', names: new Set(['lin', 'lynn']) };

  it('matches by memberId regardless of name', () => {
    expect(matchesIdentity({ name: 'Whoever', memberId: 'm-1' }, idy)).toBe(true);
  });
  it('matches by name when memberId differs', () => {
    expect(matchesIdentity({ name: 'Lynn', memberId: 'm-2' }, idy)).toBe(true);
  });
  it('does not match an unrelated row', () => {
    expect(matchesIdentity({ name: 'Viktor', memberId: 'm-2' }, idy)).toBe(false);
  });
});

describe('resolveIdentity', () => {
  beforeEach(() => resetMockStore());

  it('resolves a member by name and widens via aliases', async () => {
    seedMember('Mike', { id: 'm-mike' });
    seedAlias('Mike', 'Michael Chen');

    const idy = await resolveIdentity({ name: 'mike' });
    expect(idy.memberId).toBe('m-mike');
    expect(idy.names.has('mike')).toBe(true);
    expect(idy.names.has('michael chen')).toBe(true);
  });

  it('resolves an unknown name to no member but keeps the name itself', async () => {
    const idy = await resolveIdentity({ name: 'Ghost' });
    expect(idy.member).toBeNull();
    expect(idy.memberId).toBeNull();
    expect(idy.names).toEqual(new Set(['ghost']));
  });
});

describe('classifyOwed', () => {
  const ctx = { activeSessionId: 'session-active', now: new Date('2026-06-10T00:00:00Z').getTime(), activeCount: 4 };
  const settled = (over: Partial<Session> = {}): Session =>
    ({ id: 's', datetime: '2026-06-01T19:00:00-04:00', settled: { at: '', costPerPerson: 10, totalCost: 40, courtTotal: 40, birdTotal: 0, playerCount: 4, playerNames: [] }, ...over } as Session);
  const unsettledPast = (over: Partial<Session> = {}): Session =>
    ({ id: 's', datetime: '2026-06-01T19:00:00-04:00', costPerCourt: 20, courts: 2, ...over } as Session);

  it('counts a settled session with a frozen owedAmount', () => {
    expect(classifyOwed({ owedAmount: 12.5 }, settled(), ctx)).toEqual({ counted: true, reason: 'counted', owedAmount: 12.5 });
  });
  it('drops a settled session whose owedAmount is 0', () => {
    expect(classifyOwed({ owedAmount: 0 }, settled(), ctx).reason).toBe('settled_zero_owed');
  });
  it('drops paid / written-off regardless of settle state', () => {
    expect(classifyOwed({ paid: true, owedAmount: 10 }, settled(), ctx).reason).toBe('paid');
    expect(classifyOwed({ writtenOff: true, owedAmount: 10 }, settled(), ctx).reason).toBe('written_off');
  });
  it('computes the live per-person share for an unsettled past priced session', () => {
    expect(classifyOwed({}, unsettledPast(), ctx)).toEqual({ counted: true, reason: 'counted', owedAmount: 10 });
  });
  it('drops an unsettled past session with no recorded cost', () => {
    expect(classifyOwed({}, unsettledPast({ costPerCourt: 0, courts: 0 }), ctx).reason).toBe('unsettled_no_cost');
  });
  it('drops the active session via the live path', () => {
    expect(classifyOwed({}, unsettledPast({ id: 'session-active' }), ctx).reason).toBe('future_or_active');
  });
  it('drops a future unsettled session', () => {
    expect(classifyOwed({}, unsettledPast({ datetime: '2026-12-01T19:00:00-04:00' }), ctx).reason).toBe('future_or_active');
  });
  it('drops a session with a malformed datetime instead of throwing', () => {
    expect(classifyOwed({ owedAmount: 10 }, settled({ datetime: 'bad' }), ctx).reason).toBe('bad_datetime');
  });
});
