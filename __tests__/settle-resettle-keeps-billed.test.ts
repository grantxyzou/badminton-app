import { describe, it, expect, beforeEach } from 'vitest';
import { POST, DELETE } from '@/app/api/session/settle/route';
import { PATCH as playersPatch } from '@/app/api/players/route';
import {
  resetMockStore,
  setupAdminPin,
  makeAdminRequest,
  seedPointer,
  seedSession,
  seedPlayer,
  getStore,
  seedAdminMember,
} from './helpers';

/**
 * A frozen bill re-settled after a cover keeps EVERYONE it billed (audit,
 * 2026-11-05). Four players, $40, $10 each. The Cover sheet's two buttons on
 * a billed person used to do the same wrong thing: drop them from the split,
 * put their $10 on the other three ($13.33 each) and wipe their own debt.
 */
const SID = 'session-2026-05-04';
const URL = `http://localhost:3000/api/session/settle?sessionId=${SID}`;
type Row = { id: string; name: string; owedAmount?: number; paid?: boolean; writtenOff?: boolean; removed?: boolean };
const rows = () => getStore()['players'] as Row[];
const row = (name: string) => rows().find((p) => p.name === name)!;
const session = () => (getStore()['sessions'] as Array<{ id: string; settled?: { costPerPerson: number; coveredTotal?: number } }>).find((s) => s.id === SID)!;

const settle = (body?: Record<string, unknown>) => POST(makeAdminRequest('POST', URL, body));
const patch = (name: string, body: Record<string, unknown>) =>
  playersPatch(makeAdminRequest('PATCH', 'http://localhost:3000/api/players', { id: row(name).id, sessionId: SID, ...body }));

beforeEach(async () => {
  setupAdminPin();
  resetMockStore();
  seedAdminMember();
  seedPointer(SID);
  seedSession(SID, { costPerCourt: 40, courts: 1 });
  for (const n of ['Alice', 'Bao', 'Chen', 'Dev']) seedPlayer(SID, n);
  expect((await settle()).status).toBe(200);
  expect(session().settled?.costPerPerson).toBe(10);
});

describe('re-settling a frozen bill', () => {
  it('"Cover & remove": the club absorbs their share; nobody else pays more', async () => {
    expect((await patch('Dev', { writtenOff: true, coverMode: 'absorb', removed: true })).status).toBe(200);
    expect((await settle({ resettle: true })).status).toBe(200);
    for (const n of ['Alice', 'Bao', 'Chen']) expect(row(n).owedAmount).toBe(10);
    expect(row('Dev')).toMatchObject({ owedAmount: 10, writtenOff: true, removed: true });
    expect(session().settled?.coveredTotal).toBe(10);
  });

  it('"Remove without covering": they still owe it, and nobody else pays more', async () => {
    expect((await patch('Dev', { removed: true })).status).toBe(200);
    expect((await settle({ resettle: true })).status).toBe(200);
    for (const n of ['Alice', 'Bao', 'Chen', 'Dev']) expect(row(n).owedAmount).toBe(10);
  });

  it('a re-split cover still spreads the share when nobody has paid', async () => {
    expect((await patch('Dev', { writtenOff: true, coverMode: 'resplit' })).status).toBe(200);
    expect((await settle({ resettle: true })).status).toBe(200);
    expect(row('Alice').owedAmount).toBe(13.33);
    expect(row('Dev').owedAmount).toBe(0);
  });

  it('a re-split cover is refused once someone has paid, and nothing moves', async () => {
    expect((await patch('Alice', { paid: true })).status).toBe(200);
    const res = await patch('Dev', { writtenOff: true, coverMode: 'resplit' });
    expect(res.status).toBe(409);
    expect((await res.json()).error).toBe('paid_would_change');
    expect(row('Dev').writtenOff).not.toBe(true);
    expect(row('Alice')).toMatchObject({ paid: true, owedAmount: 10 });
  });

  it('the server refuses a re-settle that would change a paid amount, before touching the bill', async () => {
    expect((await patch('Alice', { paid: true })).status).toBe(200);
    // Forced past the PATCH guard, as an older client or a hand edit could.
    Object.assign(row('Dev'), { writtenOff: true, coverMode: 'resplit' });
    const res = await settle({ resettle: true });
    expect(res.status).toBe(409);
    expect((await res.json()).names).toEqual(['Alice']);
    expect(session().settled?.costPerPerson).toBe(10);
    expect(row('Bao').owedAmount).toBe(10);
  });

  it('a plain second POST is still refused, and a manual unsettle still forgets the bill', async () => {
    expect((await settle()).status).toBe(409);
    expect((await patch('Dev', { removed: true })).status).toBe(200);
    expect((await DELETE(makeAdminRequest('DELETE', URL))).status).toBe(200);
    expect((await settle()).status).toBe(200);
    expect(row('Alice').owedAmount).toBe(13.33);
  });
});
