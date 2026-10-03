import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import { NextRequest } from 'next/server';
import { POST as inbound } from '@/app/api/payments/etransfer/route';
import { GET as inboxGet } from '@/app/api/admin/payments/route';
import { POST as assign } from '@/app/api/admin/payments/assign/route';
import { POST as mintKey } from '@/app/api/admin/payments/key/route';
import { POST as selfReport } from '@/app/api/payments/self-report/route';
import { POST as signup, PATCH as patchPlayer } from '@/app/api/players/route';
import { apiGuards } from '../proxy';
import { mintPaymentsKey, signupHeldForUnpaid } from '@/lib/paymentsInbox';
import { groupScope } from '@/lib/groupScope';
import {
  resetMockStore,
  getStore,
  seedPointer,
  seedSession,
  seedPlayer,
  seedMember,
  seedDoc,
  makeRequest,
  makeAdminRequest,
  memberCookieValue,
  setupAdminPin,
  seedTestAdminMember,
} from './helpers';

/**
 * The e-transfer inbox end to end, through the real routes on the mock store:
 * a forwarded Interac email marks the right rows paid, or waits for a person —
 * never anything in between.
 */

const ACTIVE = 'session-2026-10-08';
const S1 = 'session-2026-09-24';
const S2 = 'session-2026-10-01';
const BASE = 'http://localhost:3000/api';
const AUTH =
  'mx.google.com; dkim=pass header.i=@payments.interac.ca header.s=s1; spf=pass smtp.mailfrom=notify@payments.interac.ca; dmarc=pass header.from=payments.interac.ca';
const FROM = '"Interac e-Transfer" <notify@payments.interac.ca>';

const settled = () => ({ at: '2026-10-02T00:00:00Z', costPerPerson: 12, totalCost: 48, courtTotal: 48, birdTotal: 0, playerCount: 4, playerNames: [] });

let lin: { id: string };
let row1: { id: string };
let row2: { id: string };
let key: string;
let msg = 0;

function email(sender: string, dollars: string, over: Record<string, unknown> = {}) {
  msg += 1;
  return {
    messageId: `<m${msg}@interac>`,
    from: FROM,
    subject: `INTERAC e-Transfer: ${sender} sent you money.`,
    body: `Hi Grant,\n${sender} has sent you $${dollars} (CAD).`,
    date: '2026-10-03T12:00:00Z',
    authResults: AUTH,
    ...over,
  };
}
const post = (body: Record<string, unknown>, k: string | null = key) =>
  inbound(makeRequest('POST', `${BASE}/payments/etransfer`, body, k ? { 'x-payments-key': k } : {}));
const players = () => getStore()['players'] as Array<Record<string, unknown>>;
const rowById = (id: string) => players().find((p) => p.id === id)!;

beforeEach(async () => {
  resetMockStore();
  setupAdminPin();
  process.env.NEXT_PUBLIC_FLAG_PAYMENTS_AUTO = 'true';
  await seedTestAdminMember();
  seedPointer(ACTIVE);
  seedSession(S1, { settled: settled(), datetime: '2026-09-24T19:00:00-04:00' });
  seedSession(S2, { settled: settled(), datetime: '2026-10-01T19:00:00-04:00' });
  seedSession(ACTIVE, { datetime: '2026-10-08T19:00:00-04:00', maxPlayers: 12, signupOpen: true });
  lin = seedMember('Lin');
  row1 = seedPlayer(S1, 'Lin', { memberId: lin.id, owedAmount: 12, settledAt: '2026-10-02T00:00:00Z' });
  row2 = seedPlayer(S2, 'Lin', { memberId: lin.id, owedAmount: 15, settledAt: '2026-10-02T00:00:00Z' });
  key = await mintPaymentsKey('bpm');
});

afterEach(() => {
  delete process.env.NEXT_PUBLIC_FLAG_PAYMENTS_AUTO;
  delete process.env.NEXT_PUBLIC_FLAG_STRINGING;
});

describe('POST /api/payments/etransfer — the gate', () => {
  it('404s with the flag off', async () => {
    process.env.NEXT_PUBLIC_FLAG_PAYMENTS_AUTO = 'false';
    expect((await post(email('Lin', '12.00'))).status).toBe(404);
  });

  it('401s with no key, a wrong key, or a key naming another club', async () => {
    expect((await post(email('Lin', '12.00'), null)).status).toBe(401);
    expect((await post(email('Lin', '12.00'), `bpm.${'0'.repeat(48)}`)).status).toBe(401);
    expect((await post(email('Lin', '12.00'), key.replace(/^bpm\./, 'other.'))).status).toBe(401);
    expect(rowById(row1.id).paid).toBe(false);
  });

  it('a rotated key stops working at once', async () => {
    const res = await mintKey(makeAdminRequest('POST', `${BASE}/admin/payments/key`));
    const { key: fresh } = await res.json();
    expect(fresh).toMatch(/^bpm\.[0-9a-f]{48}$/);
    expect((await post(email('Lin', '12.00'))).status).toBe(401);
    expect((await post(email('Lin', '12.00'), fresh)).status).toBe(200);
  });

  it('minting a key is admin-only', async () => {
    expect((await mintKey(makeRequest('POST', `${BASE}/admin/payments/key`))).status).toBe(401);
  });

  it('passes the proxy cross-site guard without an exemption (Apps Script sends no Origin)', () => {
    const req = new NextRequest('https://bpm.example.com/api/payments/etransfer', { method: 'POST', headers: { host: 'bpm.example.com' } });
    expect(apiGuards(req)).toBeNull();
  });

  it('rejects a malformed body', async () => {
    expect((await post({ messageId: 'x' })).status).toBe(400);
  });
});

describe('matching', () => {
  it('an exact roster name and an exact line → paid, traced to the payment', async () => {
    const res = await post(email('Lin', '12.00'));
    expect(await res.json()).toMatchObject({ ok: true, status: 'matched', duplicate: false });
    const r = rowById(row1.id);
    expect(r).toMatchObject({ paid: true, paidVia: 'etransfer' });
    expect(r.paymentId).toMatch(/^etx:/);
    expect(rowById(row2.id).paid).toBe(false);
  });

  it('the whole balance pays every line', async () => {
    await post(email('Lin', '27.00'));
    expect(rowById(row1.id).paid).toBe(true);
    expect(rowById(row2.id).paid).toBe(true);
  });

  it('the same email twice is one payment', async () => {
    const e = email('Lin', '12.00');
    await post(e);
    const again = await (await post(e)).json();
    expect(again).toMatchObject({ duplicate: true, status: 'matched' });
    expect((getStore()['payments'] as unknown[]).length).toBe(1);
    expect(rowById(row2.id).paid).toBe(false);
  });

  it('a spoofed email (no Google authentication) waits for a person, with the match proposed', async () => {
    const res = await post(email('Lin', '12.00', { authResults: undefined }));
    expect((await res.json()).status).toBe('review');
    expect(rowById(row1.id).paid).toBe(false);
    const inbox = await (await inboxGet(makeAdminRequest('GET', `${BASE}/admin/payments`))).json();
    expect(inbox.review).toHaveLength(1);
    expect(inbox.review[0]).toMatchObject({ reason: 'unauthenticated', authenticated: false });
    expect(inbox.review[0].suggestions[0].proposed.map((a: { ref: string }) => a.ref)).toEqual([row1.id]);
  });

  it('an amount matching no clean set of lines waits for a person', async () => {
    await post(email('Lin', '20.00'));
    expect(rowById(row1.id).paid).toBe(false);
    expect((getStore()['payments'] as Array<{ reason: string }>)[0].reason).toBe('amount_mismatch');
  });

  it('a legal name nobody knows → queue; "remember" makes the next one automatic', async () => {
    const first = await (await post(email('LIN DAN', '12.00'))).json();
    expect(first.status).toBe('review');

    const res = await assign(
      makeAdminRequest('POST', `${BASE}/admin/payments/assign`, { paymentId: (getStore()['payments'] as Array<{ id: string }>)[0].id, action: 'assign', memberId: lin.id, remember: true }),
    );
    expect(res.status).toBe(200);
    expect(rowById(row1.id).paid).toBe(true);
    expect((getStore()['aliases'] as Array<Record<string, unknown>>)).toEqual([
      expect.objectContaining({ appName: 'Lin', etransferName: 'LIN DAN', groupId: 'bpm' }),
    ]);

    const second = await (await post(email('LIN DAN', '15.00'))).json();
    expect(second.status).toBe('matched');
    expect(rowById(row2.id).paid).toBe(true);
  });

  it('assigning refuses lines the person does not owe, and a resolved payment', async () => {
    await post(email('Stranger', '12.00'));
    const id = (getStore()['payments'] as Array<{ id: string }>)[0].id;
    const bad = await assign(makeAdminRequest('POST', `${BASE}/admin/payments/assign`, { paymentId: id, action: 'assign', memberId: lin.id, refs: ['not-a-row'] }));
    expect(bad.status).toBe(409);
    expect((await assign(makeAdminRequest('POST', `${BASE}/admin/payments/assign`, { paymentId: id, action: 'ignore' }))).status).toBe(200);
    expect((await assign(makeAdminRequest('POST', `${BASE}/admin/payments/assign`, { paymentId: id, action: 'ignore' }))).status).toBe(409);
  });

  it('assigning is admin-only', async () => {
    await post(email('Stranger', '12.00'));
    const id = (getStore()['payments'] as Array<{ id: string }>)[0].id;
    expect((await assign(makeRequest('POST', `${BASE}/admin/payments/assign`, { paymentId: id, action: 'ignore' }))).status).toBe(401);
  });

  it('a finished stringing job counts — players send the total Home shows them', async () => {
    process.env.NEXT_PUBLIC_FLAG_STRINGING = 'true';
    seedDoc('stringingJobs', { id: 'job-1', groupId: 'bpm', memberId: lin.id, jobNo: 'J-0001', racketLabel: 'Astrox', priceCents: 3000, paidAt: null, status: 'ready', updatedAt: '2026-10-02T12:00:00Z' });
    await post(email('Lin', '57.00'));
    expect(rowById(row1.id).paid).toBe(true);
    expect(rowById(row2.id).paid).toBe(true);
    expect((getStore()['stringingJobs'] as Array<{ paidAt: string | null }>)[0].paidAt).not.toBeNull();
  });

  it("another club's key cannot touch this club's rows", async () => {
    const otherKey = await mintPaymentsKey('other');
    const res = await post(email('Lin', '12.00'), otherKey);
    expect((await res.json()).status).toBe('review');
    expect(rowById(row1.id).paid).toBe(false);
    const stored = (getStore()['payments'] as Array<{ groupId: string; reason: string }>)[0];
    // Multi-group off: the roster is every active Member, so "Lin" is found —
    // but with nothing owed in THIS club. The rows are what must not move.
    expect(stored.groupId).toBe('other');
    expect(['unknown_sender', 'nothing_owed']).toContain(stored.reason);
  });

  it('never stores the email body', async () => {
    await post(email('Lin', '12.00'));
    expect(JSON.stringify(getStore()['payments'])).not.toContain('Hi Grant');
  });
});

describe('"I\'ve sent it"', () => {
  it('flags the member\'s owed rows as self-reported, without marking them paid', async () => {
    const res = await selfReport(makeRequest('POST', `${BASE}/payments/self-report`, {}, { Cookie: `member_session=${memberCookieValue('Lin', lin.id)}` }));
    expect(await res.json()).toEqual({ ok: true, flagged: 2 });
    expect(rowById(row1.id)).toMatchObject({ selfReportedPaid: true, paid: false });
  });

  it('needs a member session', async () => {
    expect((await selfReport(makeRequest('POST', `${BASE}/payments/self-report`, {}))).status).toBe(401);
  });
});

describe('the soft hold', () => {
  it('owing for two sessions puts a sign-up on the waitlist, with the reason', async () => {
    expect(await signupHeldForUnpaid(groupScope('bpm'), lin.id)).toBe(true);
    const res = await signup(makeRequest('POST', `${BASE}/players`, { name: 'Lin' }, { Cookie: `member_session=${memberCookieValue('Lin', lin.id)}` }));
    expect(res.status).toBe(201);
    expect(await res.json()).toMatchObject({ waitlisted: true, heldForUnpaid: true });
  });

  it('one unpaid session is under the line', async () => {
    rowById(row1.id).paid = true;
    expect(await signupHeldForUnpaid(groupScope('bpm'), lin.id)).toBe(false);
  });

  it('flag off: no hold', async () => {
    process.env.NEXT_PUBLIC_FLAG_PAYMENTS_AUTO = 'false';
    const res = await signup(makeRequest('POST', `${BASE}/players`, { name: 'Lin' }, { Cookie: `member_session=${memberCookieValue('Lin', lin.id)}` }));
    expect(await res.json()).toMatchObject({ waitlisted: false });
  });

  it('paying releases the hold and takes the spot', async () => {
    const res = await signup(makeRequest('POST', `${BASE}/players`, { name: 'Lin' }, { Cookie: `member_session=${memberCookieValue('Lin', lin.id)}` }));
    const { id } = await res.json();
    await post(email('Lin', '12.00'));
    expect(rowById(id)).toMatchObject({ waitlisted: false, heldForUnpaid: false });
  });

  it("an admin's manual paid tap releases it too, and stamps paidAt", async () => {
    const res = await signup(makeRequest('POST', `${BASE}/players`, { name: 'Lin' }, { Cookie: `member_session=${memberCookieValue('Lin', lin.id)}` }));
    const { id } = await res.json();
    await patchPlayer(makeAdminRequest('PATCH', `${BASE}/players`, { id: row1.id, sessionId: S1, paid: true }));
    expect(rowById(row1.id)).toMatchObject({ paid: true, paidVia: 'manual' });
    expect(typeof rowById(row1.id).paidAt).toBe('string');
    expect(rowById(id)).toMatchObject({ waitlisted: false, heldForUnpaid: false });
  });
});
