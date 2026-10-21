import { describe, it, expect, beforeEach } from 'vitest';
import {
  resetMockStore,
  getStore,
  setupAdminPin,
  seedPointer,
  seedSession,
  seedPlayer,
  seedMember,
  seedTestAdminMember,
  makeAdminRequest,
} from './helpers';
import { groupScope } from '@/lib/groupScope';
import { computeOwed } from '@/lib/owedBalance';
import { costSplit } from '@/lib/sessionCost';
import { POST as ADVANCE } from '@/app/api/session/advance/route';
import { GET as OWED_AUDIT } from '@/app/api/admin/owed-audit/route';
import type { Player, Session } from '@/lib/types';

setupAdminPin();

/**
 * ONE live estimate for an unsettled session (review of money accuracy,
 * 2026-10-21). The balance card, the advance snapshot and the admin owed
 * audit all divided by the ACTIVE COUNT while the receipt — and settle, which
 * freezes the bill — used `costSplit`, which drops a `resplit`-covered player
 * from the denominator. Set a resplit cover before settle and Home showed one
 * figure for the week while the receipt showed another. Every live path now
 * goes through `costSplit`, so the figure below is asserted equal to it and
 * NOT equal to total / active count.
 */
const PAST = 'session-2026-05-20';
const ACTIVE = 'session-2026-06-08';

/** $20/court × 2 courts = $40; four active rows, Kento resplit-covered → $40 / 3. */
function seedWeekWithResplit() {
  seedSession(PAST, { costPerCourt: 20, courts: 2, datetime: '2026-05-20T19:00:00-04:00' });
  seedPlayer(PAST, 'Lin', { memberId: 'm-lin', paid: false });
  seedPlayer(PAST, 'Viktor', { paid: false });
  seedPlayer(PAST, 'Akane', { paid: false });
  seedPlayer(PAST, 'Kento', { writtenOff: true, coverMode: 'resplit' });
  seedPlayer(PAST, 'Sindhu', { removed: true }); // never in any denominator
}

function rowsOf(sessionId: string): Player[] {
  return ((getStore()['players'] ?? []) as Player[]).filter((p) => p.sessionId === sessionId);
}
function sessionOf(sessionId: string): Session {
  return ((getStore()['sessions'] ?? []) as Session[]).find((s) => s.id === sessionId)!;
}

describe('an unsettled session has ONE live per-person estimate: costSplit', () => {
  beforeEach(async () => {
    resetMockStore();
    await seedTestAdminMember();
    seedMember('Lin', { id: 'm-lin' });
    seedPointer(ACTIVE);
    seedSession(ACTIVE, { costPerCourt: 20, courts: 2, datetime: '2026-06-08T19:00:00-04:00' });
  });

  it("Home's balance line (computeOwed) is costSplit's figure, not total / active count", async () => {
    seedWeekWithResplit();
    const expected = costSplit(sessionOf(PAST), rowsOf(PAST)).costPerPerson;
    expect(expected).toBe(13.33); // 40 / 3 — the resplit cover left the denominator

    const owed = await computeOwed(groupScope('bpm'), { memberId: 'm-lin', names: new Set(['lin']) });
    const line = owed.sessions.find((s) => s.sessionId === PAST);
    expect(line?.owedAmount).toBe(expected);
    expect(line?.owedAmount).not.toBe(10); // 40 / 4 was the old, third denominator
  });

  it('an absorb cover keeps the covered player in the denominator on Home too', async () => {
    seedWeekWithResplit();
    const kento = rowsOf(PAST).find((p) => p.name === 'Kento')!;
    kento.coverMode = 'absorb';
    expect(costSplit(sessionOf(PAST), rowsOf(PAST)).costPerPerson).toBe(10);

    const owed = await computeOwed(groupScope('bpm'), { memberId: 'm-lin', names: new Set(['lin']) });
    expect(owed.sessions.find((s) => s.sessionId === PAST)?.owedAmount).toBe(10);
  });

  it("the advance snapshot's prevCostPerPerson is costSplit's figure for an unsettled current session", async () => {
    // Make the resplit week the CURRENT session so advance snapshots it.
    resetMockStore();
    await seedTestAdminMember();
    seedPointer(PAST);
    seedWeekWithResplit();
    const expected = costSplit(sessionOf(PAST), rowsOf(PAST)).costPerPerson;
    expect(expected).toBe(13.33);

    const res = await ADVANCE(
      makeAdminRequest('POST', 'http://localhost:3000/api/session/advance', { datetime: '2026-05-27T19:00:00-04:00' }),
    );
    expect(res.status).toBe(201);
    const body = await res.json();
    expect(body.prevCostPerPerson).toBe(expected);
    expect(body.prevCostPerPerson).not.toBe(10);
    expect(body.prevSessionDate).toBe('2026-05-20T19:00:00-04:00');
  });

  it('the admin owed audit explains the same figure the card shows', async () => {
    seedWeekWithResplit();
    const res = await OWED_AUDIT(makeAdminRequest('GET', 'http://localhost:3000/api/admin/owed-audit?name=Lin'));
    expect(res.status).toBe(200);
    const data = await res.json();
    const row = data.sessions.find((r: { sessionId: string }) => r.sessionId === PAST);
    expect(row.counted).toBe(true);
    expect(row.owedAmount).toBe(13.33);
    expect(data.totalOwed).toBe(13.33);
  });
});
