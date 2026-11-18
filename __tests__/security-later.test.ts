import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import { POST as inbound } from '@/app/api/payments/etransfer/route';
import { POST as assign } from '@/app/api/admin/payments/assign/route';
import { GET as partners } from '@/app/api/stats/partners/route';
import { GET as attendance } from '@/app/api/stats/attendance/route';
import { POST as addAlias } from '@/app/api/aliases/route';
import { mintPaymentsKey } from '@/lib/paymentsInbox';
import {
  resetMockStore,
  getStore,
  seedPointer,
  seedSession,
  seedPlayer,
  seedMember,
  seedDoc,
  seedGroup,
  seedMembership,
  makeRequest,
  makeAdminRequest,
  memberCookieValue,
  setupAdminPin,
  seedTestAdminMember,
} from './helpers';

/**
 * Claude Security scan, 2026-11-17: the LOW findings left for later, decided
 * on 2026-11-18. Each case fails against the code before its fix.
 */

const BASE = 'http://localhost:3000/api';
const AUTH =
  'mx.google.com; dkim=pass header.i=@payments.interac.ca header.s=s1; spf=pass smtp.mailfrom=notify@payments.interac.ca; dmarc=pass header.from=payments.interac.ca';
const FROM = '"Interac e-Transfer" <notify@payments.interac.ca>';
const SETTLED_AT = '2026-10-02T00:00:00Z';
const S1 = 'session-2026-09-24';
const settled = () => ({ at: SETTLED_AT, costPerPerson: 12, totalCost: 48, courtTotal: 48, birdTotal: 0, playerCount: 4, playerNames: [] });

let msg = 0;
function email(sender: string, dollars: string) {
  msg += 1;
  return {
    messageId: `<later${msg}@interac>`,
    from: FROM,
    subject: `INTERAC e-Transfer: ${sender} sent you money.`,
    body: `Hi Grant,\n${sender} has sent you $${dollars} (CAD).`,
    date: '2026-10-03T12:00:00Z',
    authResults: AUTH,
  };
}

describe('F18: a roster name equal to the bank name is not proof of who paid', () => {
  let key: string;
  const post = (body: Record<string, unknown>) =>
    inbound(makeRequest('POST', `${BASE}/payments/etransfer`, body, { 'x-payments-key': key }));
  const row = (id: string) => (getStore()['players'] as Array<{ id: string; paid?: boolean }>).find((p) => p.id === id)!;
  const payments = () => getStore()['payments'] as Array<{ id: string; status: string; reason?: string }>;

  beforeEach(async () => {
    resetMockStore();
    setupAdminPin();
    process.env.NEXT_PUBLIC_FLAG_PAYMENTS_AUTO = 'true';
    await seedTestAdminMember();
    seedPointer('session-2026-10-08');
    seedSession(S1, { settled: settled(), datetime: '2026-09-24T19:00:00-04:00' });
    seedSession('session-2026-10-08', { datetime: '2026-10-08T19:00:00-04:00' });
    key = await mintPaymentsKey('bpm');
  });
  afterEach(() => {
    delete process.env.NEXT_PUBLIC_FLAG_PAYMENTS_AUTO;
  });

  it('a member renamed to someone else’s bank name does not get their transfer', async () => {
    // Bob took Gary's bank name as his roster name; Gary pays.
    const bob = seedMember('Cheuk Shan Chung', { id: 'bob' });
    const gary = seedMember('Gary', { id: 'gary' });
    const bobRow = seedPlayer(S1, 'Cheuk Shan Chung', { memberId: bob.id, owedAmount: 12, settledAt: SETTLED_AT });
    seedPlayer(S1, 'Gary', { memberId: gary.id, owedAmount: 12, settledAt: SETTLED_AT });
    const res = await (await post(email('CHEUK SHAN CHUNG', '12.00'))).json();
    expect(res.status).toBe('review');
    expect(payments()[0].reason).toBe('name_only');
    expect(row(bobRow.id).paid).toBe(false);
  });

  it('a remembered bank name follows the PERSON, not the name text', async () => {
    // The alias says CHEUK SHAN CHUNG is Gary (by id). Gary has since renamed
    // to "Gary Chung", and Bob took the name "Gary".
    const gary = seedMember('Gary Chung', { id: 'gary' });
    const bob = seedMember('Gary', { id: 'bob' });
    const garyRow = seedPlayer(S1, 'Gary Chung', { memberId: gary.id, owedAmount: 12, settledAt: SETTLED_AT });
    const bobRow = seedPlayer(S1, 'Gary', { memberId: bob.id, owedAmount: 12, settledAt: SETTLED_AT });
    seedDoc('clubSettings', { id: 'alias-gary', kind: 'alias', appName: 'Gary', etransferName: 'CHEUK SHAN CHUNG', memberId: gary.id, groupId: 'bpm' });
    const res = await (await post(email('CHEUK SHAN CHUNG', '12.00'))).json();
    expect(res.status).toBe('matched');
    expect(row(garyRow.id).paid).toBe(true);
    expect(row(bobRow.id).paid).toBe(false);
  });

  it('a memo naming someone renamed to it is not proof either', async () => {
    // Mallory renamed herself to the name in Bruce's memo.
    const mallory = seedMember('Bruce Wayne', { id: 'mallory' });
    const malloryRow = seedPlayer(S1, 'Bruce Wayne', { memberId: mallory.id, owedAmount: 12, settledAt: SETTLED_AT });
    const res = await (await post({ ...email('B WAYNE HOLDINGS', '12.00'), body: 'Hi Grant,\nB WAYNE HOLDINGS has sent you $12.00 (CAD).\nMessage: BPM Sep 24 - Bruce Wayne' })).json();
    expect(res.status).toBe('review');
    expect(row(malloryRow.id).paid).toBe(false);
  });

  it('dismissing a name-only row remembers nothing for a bank name equal to the suggestion', async () => {
    const mallory = seedMember('Bruce Wayne', { id: 'mallory' });
    seedPlayer(S1, 'Bruce Wayne', { memberId: mallory.id, owedAmount: 12, settledAt: SETTLED_AT });
    await post(email('BRUCE WAYNE', '12.00'));
    const ok = await assign(makeAdminRequest('POST', `${BASE}/admin/payments/assign`, { paymentId: payments()[0].id, action: 'ignore', memberId: mallory.id, remember: true }));
    expect(ok.status).toBe(200);
    const aliases = ((getStore()['clubSettings'] ?? []) as Array<{ kind?: string }>).filter((r) => r.kind === 'alias');
    expect(aliases).toHaveLength(0);
  });

  it('an alias added on the Roster screen carries the member’s id', async () => {
    const gary = seedMember('Gary', { id: 'gary' });
    const res = await addAlias(makeAdminRequest('POST', `${BASE}/aliases`, { appName: 'Gary', etransferName: 'CHEUK SHAN CHUNG' }));
    expect(res.status).toBe(201);
    expect((await res.json()).memberId).toBe(gary.id);
  });

  it('confirming once remembers a bank name EQUAL to the roster name, so the next one is automatic', async () => {
    const lin = seedMember('Lin Dan', { id: 'lin' });
    const first = seedPlayer(S1, 'Lin Dan', { memberId: lin.id, owedAmount: 12, settledAt: SETTLED_AT });
    seedSession('session-2026-10-01', { settled: settled(), datetime: '2026-10-01T19:00:00-04:00' });
    const second = seedPlayer('session-2026-10-01', 'Lin Dan', { memberId: lin.id, owedAmount: 15, settledAt: SETTLED_AT });
    expect((await (await post(email('Lin Dan', '12.00'))).json()).status).toBe('review');
    const ok = await assign(makeAdminRequest('POST', `${BASE}/admin/payments/assign`, { paymentId: payments()[0].id, action: 'assign', memberId: lin.id, remember: true }));
    expect(ok.status).toBe(200);
    expect(row(first.id).paid).toBe(true);
    expect((await (await post(email('Lin Dan', '15.00'))).json()).status).toBe('matched');
    expect(row(second.id).paid).toBe(true);
  });
});

describe('F27, F28: a name taken over does not bring the previous holder’s history', () => {
  const FLAG = 'NEXT_PUBLIC_FLAG_MULTI_GROUP';
  beforeEach(() => {
    resetMockStore();
    setupAdminPin();
    process.env[FLAG] = 'true';
    seedGroup('bpm', { name: 'BPM Core' });
    // The first Chris played with Viktor, then renamed to "Chris L"; a
    // different person now holds "Chris".
    seedMember('Chris L', { id: 'chris-old' });
    seedMembership('bpm', 'chris-old', { name: 'Chris L' });
    seedMember('Chris', { id: 'chris-new' });
    seedMembership('bpm', 'chris-new', { name: 'Chris' });
    const past = new Date(Date.now() - 7 * 86_400_000).toISOString().slice(0, 10);
    const sid = `session-${past}`;
    seedSession(sid, { datetime: `${past}T19:00:00-07:00` });
    seedPlayer(sid, 'Chris', { memberId: 'chris-old' });
    seedPlayer(sid, 'Viktor', { memberId: 'viktor' });
  });
  afterEach(() => {
    delete process.env[FLAG];
  });
  const asNewChris = { Cookie: `member_session=${memberCookieValue('Chris', 'chris-new')}` };

  it('partners: the new Chris sees none of the old Chris’s partners', async () => {
    const res = await partners(makeRequest('GET', 'http://x/api/stats/partners?name=Chris&weeks=12', undefined, asNewChris));
    expect(res.status).toBe(200);
    expect((await res.json()).partners).toEqual([]);
  });

  it('attendance: the new Chris has not attended the old Chris’s sessions', async () => {
    const res = await attendance(makeRequest('GET', 'http://x/api/stats/attendance?name=Chris&weeks=12', undefined, asNewChris));
    expect(res.status).toBe(200);
    expect((await res.json()).attended).toBe(0);
  });

  it('a guest row with a member’s name is not that member', async () => {
    const past = new Date(Date.now() - 14 * 86_400_000).toISOString().slice(0, 10);
    const sid = `session-${past}`;
    seedSession(sid, { datetime: `${past}T19:00:00-07:00` });
    seedPlayer(sid, 'Chris', { guestOf: 'viktor' });
    const res = await attendance(makeRequest('GET', 'http://x/api/stats/attendance?name=Chris&weeks=12', undefined, asNewChris));
    expect((await res.json()).attended).toBe(0);
  });

  it('the old Chris keeps their own history under the new name', async () => {
    const asOld = { Cookie: `member_session=${memberCookieValue('Chris L', 'chris-old')}` };
    const p = await (await partners(makeRequest('GET', 'http://x/api/stats/partners?name=Chris%20L&weeks=12', undefined, asOld))).json();
    expect(p.partners).toEqual([{ name: 'Viktor', count: 1 }]);
    const a = await (await attendance(makeRequest('GET', 'http://x/api/stats/attendance?name=Chris%20L&weeks=12', undefined, asOld))).json();
    expect(a.attended).toBe(1);
  });
});
