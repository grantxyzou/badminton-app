import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';

vi.mock('@/lib/push', async (importOriginal) => {
  const real = await importOriginal<typeof import('@/lib/push')>();
  return { ...real, sendPushToMembers: vi.fn(async () => ({ configured: true, sent: 1, failed: 0, removed: 0 })) };
});

import {
  resetMockStore,
  setupAdminPin,
  getStore,
  seedGroup,
  seedMember,
  seedMembership,
  seedTestAdminMember,
  makeRequest,
  memberCookieValue,
  adminCookieValue,
} from './helpers';
import { sendPushToMembers } from '@/lib/push';
import { POST as sendInvoice } from '@/app/api/stringing/jobs/[id]/invoice/route';
import { GET as listJobs } from '@/app/api/stringing/jobs/route';
import { invoiceGateOpen, isBillable, isFinishedUnpaid, newJobBilling, awaitingInvoice } from '@/lib/stringingBilling';
import { invoiceNoOf, invoiceView, withInvoiceSent } from '@/lib/stringingInvoiceView';
import { composeInvoiceEmail } from '@/lib/stringingInvoice';
import { runInvoiceReminders } from '@/lib/stringingInvoiceRemind';
import { buildInvoicePayload, buildInvoiceReminderPayload, buildInvoiceUnpaidPayload } from '@/lib/pushMessages';
import { isOpenStringingJob } from '@/lib/stringingService';
import { jobEntries } from '@/lib/ledgerBackfill';
import { TICK_JOBS } from '@/lib/tick';
import type { StringingJob } from '@/lib/types';

/**
 * Send an invoice for a restring (docs/plans/stringing-invoice.md). Two
 * clubs: club-x has an organiser (the test admin), a stringer (Zach), another
 * stringer (Kai) and the player (Wei); BPM has its own organiser (Bo), who
 * must never send or hear about club-x's invoices.
 */
const MULTI = 'NEXT_PUBLIC_FLAG_MULTI_GROUP';
const STRINGING = 'NEXT_PUBLIC_FLAG_STRINGING';
const INVOICE = 'NEXT_PUBLIC_FLAG_STRINGING_INVOICE';
const ADMIN_ID = 'member-test-admin';
const DAY = 24 * 3_600_000;

const send = vi.mocked(sendPushToMembers);

let zach: { id: string }, kai: { id: string }, wei: { id: string }, bo: { id: string };

beforeEach(async () => {
  resetMockStore();
  setupAdminPin();
  send.mockClear();
  process.env[MULTI] = 'true';
  process.env[STRINGING] = 'true';
  process.env[INVOICE] = 'true';
  await seedTestAdminMember({ membership: false });
  zach = seedMember('Zach');
  kai = seedMember('Kai');
  wei = seedMember('Wei');
  bo = seedMember('Bo');
  seedGroup('club-x', { ownerMemberId: ADMIN_ID });
  seedGroup('bpm', { ownerMemberId: bo.id });
  seedMembership('club-x', ADMIN_ID, { name: 'Organiser', role: 'owner' });
  seedMembership('club-x', zach.id, { name: 'Zach', canString: true });
  seedMembership('club-x', kai.id, { name: 'Kai', canString: true });
  seedMembership('club-x', wei.id, { name: 'Wei' });
  seedMembership('bpm', bo.id, { name: 'Bo', role: 'owner', canString: true });
});
afterEach(() => {
  delete process.env[MULTI];
  delete process.env[STRINGING];
  delete process.env[INVOICE];
});

function seedJob(groupId: string, over: Partial<StringingJob> = {}): StringingJob {
  const store = getStore();
  if (!store['stringingJobs']) store['stringingJobs'] = [];
  const at = new Date(Date.now() - 2 * DAY).toISOString();
  const job = {
    id: `job-${groupId}-${(store['stringingJobs'] as unknown[]).length}`,
    groupId,
    memberId: wei.id, jobNo: 'J-0006', memberName: 'Wei',
    stringerId: zach.id, stringerName: 'Zach', status: 'ready',
    racketLabel: 'Astrox 88D Pro', stringLabel: 'BG80', tensionMains: 26, tensionCrosses: 26,
    method: '', priceCents: 2600, readyBy: null, acceptedAt: null, paidAt: null, sessionId: null,
    createdAt: at, updatedAt: at, history: [{ status: 'ready', at, by: zach.id }],
    billOn: 'invoice',
    ...over,
  } as StringingJob;
  (store['stringingJobs'] as unknown[]).push(job);
  return job;
}
const stored = (id: string) => (getStore()['stringingJobs'] as StringingJob[]).find((j) => j.id === id)!;

const asOrganiser = (groupId = 'club-x') => ({ Cookie: `admin_session=${adminCookieValue({ groupId })}` });
const asMember = (name: string, id: string, groupId = 'club-x') => ({
  Cookie: `member_session=${memberCookieValue(name, id, undefined, groupId)}`,
});
const post = (job: StringingJob, headers: Record<string, string>, body: Record<string, unknown> = { memberId: job.memberId }) =>
  sendInvoice(makeRequest('POST', `http://x/api/stringing/jobs/${job.id}/invoice`, body, headers), {
    params: Promise.resolve({ id: job.id }),
  });

describe('the billing rule', () => {
  const finished = { priceCents: 2600, paidAt: null, status: 'ready' };

  it('an invoice-billed job owes nothing until its invoice is sent', () => {
    expect(isBillable({ ...finished, billOn: 'invoice' })).toBe(false);
    expect(isBillable({ ...finished, billOn: 'invoice', invoice: { sentAt: '2026-11-15T00:00:00Z' } })).toBe(true);
    expect(awaitingInvoice({ ...finished, billOn: 'invoice' })).toBe(true);
  });

  it('an older job (no billOn) bills at Ready, exactly as before', () => {
    expect(isBillable(finished)).toBe(true);
    expect(invoiceGateOpen({})).toBe(true);
    expect(awaitingInvoice(finished)).toBe(false);
  });

  it('a finished, un-invoiced job still keeps the club’s stringing switched on', () => {
    expect(isFinishedUnpaid({ ...finished })).toBe(true);
    expect(isOpenStringingJob({ ...finished, billOn: 'invoice' } as never)).toBe(true);
  });

  it('the ledger backfill charges an invoice-billed job only once it is sent', () => {
    const job = { ...seedJob('club-x') };
    expect(jobEntries(job)).toEqual([]);
    expect(jobEntries(withInvoiceSent(job, '2026-11-15T00:00:00.000Z', ADMIN_ID))).toHaveLength(1);
  });

  it('a new job is stamped billOn only while the flag is on', () => {
    expect(newJobBilling()).toEqual({ billOn: 'invoice' });
    delete process.env[INVOICE];
    expect(newJobBilling()).toEqual({});
  });
});

describe('the invoice', () => {
  it('is numbered like the job and records each send', () => {
    expect(invoiceNoOf('J-0006')).toBe('INV-0006');
    const job = seedJob('club-x');
    const once = withInvoiceSent(job, '2026-11-15T01:00:00.000Z', ADMIN_ID);
    expect(once.invoice).toMatchObject({ no: 'INV-0006', amountCents: 2600, sends: 1, sentAt: '2026-11-15T01:00:00.000Z' });
    const twice = withInvoiceSent({ ...once, priceCents: 2800 }, '2026-11-16T01:00:00.000Z', zach.id);
    expect(twice.invoice).toMatchObject({ sends: 2, sentAt: '2026-11-15T01:00:00.000Z', lastSentAt: '2026-11-16T01:00:00.000Z', amountCents: 2800 });
    expect(invoiceView({ ...once, priceCents: 2800 }).priceChanged).toBe(true);
  });

  it('pushes carry no money; the email carries the amount', () => {
    const job = seedJob('club-x');
    for (const p of [
      buildInvoicePayload(job),
      buildInvoiceReminderPayload(job, 3),
      buildInvoiceUnpaidPayload(job, 7, 'admin'),
      buildInvoicePayload(job, 'zh-CN'),
    ]) {
      expect(`${p.title} ${p.body}`).not.toMatch(/\$|26\.00|2600/);
    }
    const mail = composeInvoiceEmail(withInvoiceSent(job, '2026-11-15T01:00:00.000Z', ADMIN_ID), { clubName: 'Club X', appUrl: 'https://example.test/bpm/?tab=home' });
    expect(mail.subject).toContain('INV-0006');
    expect(mail.text).toContain('$26');
    expect(mail.html).toContain('https://example.test/bpm/?tab=home');
    const walkUp = composeInvoiceEmail(job, { walkUp: true, appUrl: 'https://example.test' });
    expect(walkUp.html).not.toContain('https://example.test');
  });
});

describe('POST /api/stringing/jobs/[id]/invoice', () => {
  it('the organiser sends it: the job becomes owed and the player hears, without an amount', async () => {
    const job = seedJob('club-x');
    const res = await post(job, asOrganiser());
    expect(res.status).toBe(200);
    const body = await res.json();
    expect(body.invoice).toMatchObject({ no: 'INV-0006', sends: 1, owed: true, amount: 26 });
    expect(body.delivered).toMatchObject({ push: 1, reached: true });
    expect(stored(job.id).invoice?.sentBy).toBe(ADMIN_ID);
    expect(isBillable(stored(job.id))).toBe(true);
    expect(send).toHaveBeenCalledTimes(1);
    expect(send.mock.calls[0][0]).toEqual([wei.id]);
  });

  it('the player sees the amount owed only after the send', async () => {
    const job = seedJob('club-x');
    const read = async () =>
      (await (await listJobs(makeRequest('GET', 'http://x/api/stringing/jobs?view=player', undefined, asMember('Wei', wei.id)))).json()).jobs[0];
    expect((await read()).amountDue).toBeNull();
    await post(job, asOrganiser());
    const after = await read();
    expect(after.amountDue).toBe(26);
    expect(after.invoice).toMatchObject({ no: 'INV-0006' });
  });

  it('the stringer the job is assigned to may send it; another stringer and the player may not', async () => {
    const job = seedJob('club-x');
    expect((await post(job, asMember('Kai', kai.id))).status).toBe(401);
    expect((await post(job, asMember('Wei', wei.id))).status).toBe(401);
    const res = await post(job, asMember('Zach', zach.id));
    expect(res.status).toBe(200);
    const body = await res.json();
    expect(body.job).not.toHaveProperty('priceCents');
    expect(body.job.invoice.amount).toBe(26);
    expect(stored(job.id).invoice?.sentBy).toBe(zach.id);
  });

  it('refuses a job that is not finished, not priced, paid or withdrawn', async () => {
    const cases: [Partial<StringingJob>, string][] = [
      [{ status: 'strung' }, 'not_finished'],
      [{ priceCents: null }, 'not_priced'],
      [{ paidAt: new Date().toISOString() }, 'job_paid'],
      [{ cancelledAt: new Date().toISOString() }, 'cancelled'],
    ];
    for (const [over, error] of cases) {
      const res = await post(seedJob('club-x', over), asOrganiser());
      expect(res.status).toBe(409);
      expect((await res.json()).error).toBe(error);
    }
    expect(send).not.toHaveBeenCalled();
  });

  it('a double tap is one invoice', async () => {
    const job = seedJob('club-x');
    expect((await post(job, asOrganiser())).status).toBe(200);
    const again = await post(job, asOrganiser());
    expect(again.status).toBe(409);
    expect((await again.json()).error).toBe('sending');
    expect(stored(job.id).invoice?.sends).toBe(1);
    expect(send).toHaveBeenCalledTimes(1);
  });

  it('a resend after a minute counts, and keeps when billing started', async () => {
    const job = seedJob('club-x');
    await post(job, asOrganiser());
    const first = stored(job.id).invoice!;
    stored(job.id).invoice = { ...first, lastSentAt: new Date(Date.now() - 2 * 60_000).toISOString() };
    expect((await post(job, asOrganiser())).status).toBe(200);
    expect(stored(job.id).invoice).toMatchObject({ sends: 2, sentAt: first.sentAt });
  });

  it('takes nothing but the partition key', async () => {
    const job = seedJob('club-x');
    const res = await post(job, asOrganiser(), { memberId: job.memberId, priceCents: 1 });
    expect(res.status).toBe(400);
  });

  it('flag off: closed for a job made without it, open for one made invoice-billed', async () => {
    delete process.env[INVOICE];
    expect((await post(seedJob('club-x', { billOn: undefined }), asOrganiser())).status).toBe(404);
    expect((await post(seedJob('club-x'), asOrganiser())).status).toBe(200);
  });

  it('never reaches across clubs: BPM’s organiser cannot invoice club-x’s job', async () => {
    const job = seedJob('club-x');
    seedMembership('bpm', ADMIN_ID, { name: 'Organiser', role: 'owner' });
    const res = await post(job, asOrganiser('bpm'));
    expect(res.status).toBe(404);
    expect(stored(job.id).invoice).toBeUndefined();
  });
});

describe('the stringer’s card', () => {
  it('carries the invoice, price included, on their own queue only', async () => {
    seedJob('club-x');
    seedJob('club-x', { status: 'requested', stringerId: null, stringerName: null, priceCents: null });
    const res = await listJobs(makeRequest('GET', 'http://x/api/stringing/jobs?view=stringer', undefined, asMember('Zach', zach.id)));
    const body = await res.json();
    expect(body.jobs[0].invoice).toMatchObject({ canSend: true, amount: 26, sends: 0 });
    expect(body.jobs[0]).not.toHaveProperty('priceCents');
    expect(body.unclaimed[0]).not.toHaveProperty('invoice');
  });
});

describe('reminders', () => {
  const sent = (daysAgo: number, by: string = zach.id) => {
    const at = new Date(Date.now() - daysAgo * DAY).toISOString();
    return { no: 'INV-0006', amountCents: 2600, sentAt: at, lastSentAt: at, sentBy: by, sends: 1 };
  };

  it('runs on the hourly tick', () => {
    expect(TICK_JOBS.map((j) => j.name)).toContain('stringingInvoiceRemind');
  });

  it('day 3: the player, once', async () => {
    const job = seedJob('club-x', { invoice: sent(3) });
    const r = await runInvoiceReminders('club-x', Date.now());
    expect(r).toMatchObject({ open: 1, player: 1, sender: 0 });
    expect(send.mock.calls[0][0]).toEqual([wei.id]);
    expect(stored(job.id).invoice?.playerRemindedAt).toBeTruthy();
    send.mockClear();
    await runInvoiceReminders('club-x', Date.now() + 3_600_000);
    expect(send).not.toHaveBeenCalled();
  });

  it('day 7: whoever sent it, opening their own screen', async () => {
    seedJob('club-x', { invoice: { ...sent(7), playerRemindedAt: new Date().toISOString() } });
    const r = await runInvoiceReminders('club-x', Date.now());
    expect(r).toMatchObject({ player: 0, sender: 1 });
    const [ids, build] = send.mock.calls[0];
    expect(ids).toEqual([zach.id]);
    expect((build as (l: 'en') => { url: string })('en').url).toMatch(/tab=stringing$/);
  });

  it('a sender no longer on the roster hands day 7 to the organisers', async () => {
    seedJob('club-x', { invoice: { ...sent(8, 'member-gone'), playerRemindedAt: new Date().toISOString() } });
    await runInvoiceReminders('club-x', Date.now());
    expect(send.mock.calls[0][0]).toEqual([ADMIN_ID]);
  });

  it('nothing for a paid, withdrawn or young invoice, or another club’s', async () => {
    seedJob('club-x', { invoice: sent(9), paidAt: new Date().toISOString() });
    seedJob('club-x', { invoice: sent(9), cancelledAt: new Date().toISOString() });
    seedJob('club-x', { invoice: sent(1) });
    seedJob('club-x', { invoice: sent(9) });
    const r = await runInvoiceReminders('bpm', Date.now());
    expect(r.open).toBe(0);
    send.mockClear();
    const x = await runInvoiceReminders('club-x', Date.now());
    expect(x).toMatchObject({ open: 2, player: 1, sender: 1 });
  });
});
