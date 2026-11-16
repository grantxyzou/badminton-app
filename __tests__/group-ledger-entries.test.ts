import { describe, it, expect, beforeEach } from 'vitest';
import { GET } from '@/app/api/admin/ledger/entries/route';
import { resetMockStore, seedDoc, seedMember, makeRequest, makeAdminRequest, setupAdminPin, seedTestAdminMember } from './helpers';

/**
 * The ledger as a statement (docs/plans/ledger-entries.md). Grant, 2026-11-16:
 * "where did it restore to?", "We dont even have Nov 15 the date in ledger".
 */
const BASE = 'http://localhost:3000/api';
const DAY = 86_400_000;
const daysAgo = (n: number) => new Date(Date.now() - n * DAY).toISOString();
let grant: { id: string };
let lin: { id: string };

function entry(over: Record<string, unknown>) {
  return { groupId: 'bpm', account: 'member_owed', note: '', createdAt: daysAgo(1), ...over };
}

const read = async (range = '12w', admin = true) => {
  const req = admin ? makeAdminRequest('GET', `${BASE}/admin/ledger/entries?range=${range}`) : makeRequest('GET', `${BASE}/admin/ledger/entries?range=${range}`);
  return GET(req);
};

beforeEach(async () => {
  resetMockStore();
  setupAdminPin();
  await seedTestAdminMember();
  grant = seedMember('Grant');
  lin = seedMember('Lin');
  seedDoc('stringingJobs', { id: 'job-7', groupId: 'bpm', memberId: lin.id, memberName: 'Lin', jobNo: 'J-0007', racketLabel: 'Nanoflare', stringLabel: 'BG65', status: 'ready', priceCents: 3000, paidAt: null, createdAt: daysAgo(3), updatedAt: daysAgo(3), history: [] });

  // A session charge and its card payment.
  seedDoc('ledger', entry({ id: 'charge:row-1:1', memberId: lin.id, kind: 'charge', amountCents: 1250, ref: { kind: 'session', id: 'row-1', pk: 'session-2026-11-13' }, createdAt: daysAgo(3) }));
  seedDoc('ledger', entry({ id: 'payment:row-1:cs_1', memberId: lin.id, kind: 'payment', amountCents: -1250, meta: { via: 'card' }, ref: { kind: 'session', id: 'row-1', pk: 'session-2026-11-13' }, createdAt: daysAgo(2) }));
  // A live stringing charge, and a deleted job's charge, its reversal and the restore.
  seedDoc('ledger', entry({ id: 'charge:job-7:0', memberId: lin.id, kind: 'charge', amountCents: 3000, note: 'Stringing · Nanoflare', ref: { kind: 'stringing', id: 'job-7', pk: lin.id }, createdAt: daysAgo(3) }));
  seedDoc('ledger', entry({ id: 'charge:job-6:0', memberId: grant.id, kind: 'charge', amountCents: 4000, note: 'Stringing · Astrox 88D Pro', ref: { kind: 'stringing', id: 'job-6', pk: grant.id }, createdAt: daysAgo(5) }));
  seedDoc('ledger', entry({ id: 'void:charge:job-6:0', memberId: grant.id, kind: 'void', amountCents: -4000, meta: { reason: 'job_deleted' }, ref: { kind: 'stringing', id: 'job-6', pk: grant.id }, createdAt: daysAgo(1) }));
  // Club money.
  seedDoc('ledger', entry({ id: 'court:session-2026-11-13:1', memberId: '~club', account: 'club_outlay', kind: 'court_cost', amountCents: 6000, ref: { kind: 'court', id: 'session-2026-11-13', pk: '~club' }, createdAt: daysAgo(3) }));
  // Old enough to fall outside 30 days, inside 12 weeks.
  seedDoc('ledger', entry({ id: 'expense:old', memberId: '~club', account: 'club_outlay', kind: 'expense', amountCents: 2500, note: 'Nets', createdAt: daysAgo(40) }));
  // Another club's entry: never shown.
  seedDoc('ledger', entry({ id: 'charge:other:1', groupId: 'other', memberId: lin.id, kind: 'charge', amountCents: 9900, ref: { kind: 'session', id: 'x', pk: 'other:session-2026-11-13' } }));
});

describe('GET /api/admin/ledger/entries', () => {
  it('admins only', async () => {
    expect((await read('12w', false)).status).toBe(401);
  });

  it('every entry of THIS club in the window, newest first, each saying who, what and how', async () => {
    const res = await read('12w');
    expect(res.status).toBe(200);
    const body = await res.json();
    const ids = body.entries.map((e: { id: string }) => e.id);
    expect(ids).not.toContain('charge:other:1');
    expect(ids).toContain('expense:old');

    const by = (id: string) => body.entries.find((e: { id: string }) => e.id === id);
    expect(by('payment:row-1:cs_1')).toEqual(expect.objectContaining({ who: 'Lin', what: 'Nov 13 session', kind: 'payment', via: 'card', amountCents: -1250, reversed: false }));
    expect(by('charge:job-7:0')).toEqual(expect.objectContaining({ who: 'Lin', what: 'J-0007 · Nanoflare' }));
    expect(by('charge:job-6:0')).toEqual(expect.objectContaining({ who: 'Grant', what: 'Stringing · Astrox 88D Pro (job deleted)', reversed: true }));
    expect(by('court:session-2026-11-13:1')).toEqual(expect.objectContaining({ who: 'Club', what: 'Courts · Nov 13 session', account: 'club_outlay' }));
    expect(by('expense:old')).toEqual(expect.objectContaining({ who: 'Club', what: 'Nets' }));

    // A reversal belongs to the date of what it reverses, and says what that was.
    const reversal = by('void:charge:job-6:0');
    expect(reversal).toEqual(expect.objectContaining({ kind: 'void', reverses: 'charge', reason: 'job_deleted', what: 'Stringing · Astrox 88D Pro (job deleted)' }));
    expect(reversal.date).toBe(by('charge:job-6:0').date);

    // Newest first.
    const dates = body.entries.map((e: { date: string }) => e.date);
    expect([...dates].sort().reverse()).toEqual(dates);
  });

  it('the window is the Ledger page’s: 30 days leaves the older expense out', async () => {
    const body = await (await read('30d')).json();
    expect(body.entries.map((e: { id: string }) => e.id)).not.toContain('expense:old');
    expect(body.range).toBe('30d');
  });

  it('an unknown range reads as 12 weeks', async () => {
    expect((await (await read('forever')).json()).range).toBe('12w');
  });
});
