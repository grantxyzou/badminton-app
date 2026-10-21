import { describe, it, expect, beforeEach } from 'vitest';
import { resetMockStore, getStore, seedMember } from './helpers';
import { groupScope } from '../lib/groupScope';
import { loadOwedInputs } from '../lib/owedRows';

/**
 * The player-first read behind unpaid / owed-audit: one person's rows, the
 * sessions they name, and a live roster (the rows `costSplit` reads) only
 * where a session is still unsettled. The mock ignores the array parameters, so every assertion here
 * is on the JS re-check that keeps mock and Cosmos answering alike.
 */
function seedSession(id: string, extra: Record<string, unknown> = {}) {
  const store = getStore();
  if (!store['sessions']) store['sessions'] = [];
  store['sessions'].push({ id, sessionId: id, groupId: 'bpm', datetime: '2026-09-01T19:00:00-04:00', costPerCourt: 40, courts: 2, ...extra });
}
function seedPlayer(sessionId: string, name: string, extra: Record<string, unknown> = {}) {
  const store = getStore();
  if (!store['players']) store['players'] = [];
  const p = { id: `p-${sessionId}-${name}`, sessionId, groupId: 'bpm', name, ...extra };
  store['players'].push(p);
  return p;
}

describe('loadOwedInputs', () => {
  beforeEach(() => resetMockStore());

  it('returns only this person\'s rows, by memberId AND by legacy name, deduped', async () => {
    const lin = seedMember('Lin');
    seedSession('session-2026-08-25', { settled: { costPerPerson: 10 } });
    seedSession('session-2026-09-01');
    seedPlayer('session-2026-08-25', 'Lin', { memberId: lin.id });
    seedPlayer('session-2026-09-01', 'lin'); // legacy row: name only
    seedPlayer('session-2026-09-01', 'Viktor');
    seedPlayer('session-2026-09-01', 'Carolina', { waitlisted: true });

    const out = await loadOwedInputs(groupScope('bpm'), { memberId: lin.id, names: new Set(['lin']) });

    expect(out.players.map((p) => p.sessionId).sort()).toEqual(['session-2026-08-25', 'session-2026-09-01']);
    expect([...out.sessionById.keys()].sort()).toEqual(['session-2026-08-25', 'session-2026-09-01']);
    // Settled session: no roster needed (amount is frozen on the row).
    expect(out.rosterBySession.has('session-2026-08-25')).toBe(false);
    // Unsettled: every row, projected — Lin, Viktor and the waitlisted
    // Carolina, whom costSplit drops itself.
    const roster = out.rosterBySession.get('session-2026-09-01')!;
    expect(roster).toHaveLength(3);
    expect(roster.filter((r) => r.waitlisted === true)).toHaveLength(1);
  });

  it('a session another person played does not appear', async () => {
    const lin = seedMember('Lin');
    seedSession('session-2026-09-01');
    seedPlayer('session-2026-09-01', 'Viktor');
    const out = await loadOwedInputs(groupScope('bpm'), { memberId: lin.id, names: new Set(['lin']) });
    expect(out.players).toEqual([]);
    expect(out.sessionById.size).toBe(0);
    expect(out.rosterBySession.size).toBe(0);
  });

  it('a row naming a session that no longer exists is kept out of sessionById', async () => {
    const lin = seedMember('Lin');
    seedPlayer('session-gone', 'Lin', { memberId: lin.id });
    const out = await loadOwedInputs(groupScope('bpm'), { memberId: lin.id, names: new Set(['lin']) });
    expect(out.players).toHaveLength(1);
    expect(out.sessionById.size).toBe(0);
  });
});
