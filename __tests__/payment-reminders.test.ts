import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';

const { sendPushToMembers } = vi.hoisted(() => ({
  sendPushToMembers: vi.fn(async (ids: string[]) => ({ configured: true, sent: ids.length, failed: 0, removed: 0 })),
}));
vi.mock('@/lib/push', async (orig) => ({ ...(await orig<typeof import('@/lib/push')>()), sendPushToMembers }));

import { POST as remind } from '@/app/api/payments/remind/route';
import { GET as inboxGet } from '@/app/api/admin/payments/route';
import { PATCH as patchSettings } from '@/app/api/admin/payments/settings/route';
import { mintPaymentsKey, notePaymentsSettings, readPaymentsSettings } from '@/lib/paymentsInbox';
import { reminderDue, reminderPayload } from '@/lib/paymentReminders';
import {
  resetMockStore,
  getStore,
  seedPointer,
  seedSession,
  seedPlayer,
  seedMember,
  makeRequest,
  makeAdminRequest,
  setupAdminPin,
  seedTestAdminMember,
} from './helpers';

const DAY = 24 * 60 * 60 * 1000;
const ago = (days: number) => new Date(Date.now() - days * DAY).toISOString();
const BASE = 'http://localhost:3000/api';
const settled = () => ({ at: ago(5), costPerPerson: 12, totalCost: 48, courtTotal: 48, birdTotal: 0, playerCount: 4, playerNames: [] });

let key: string;
let lin: { id: string };
const rows = () => getStore()['players'] as Array<Record<string, unknown>>;
const row = (id: string) => rows().find((p) => p.id === id)!;
const call = (k: string | null = key) => remind(makeRequest('POST', `${BASE}/payments/remind`, {}, k ? { 'x-payments-key': k } : {}));

beforeEach(async () => {
  resetMockStore();
  setupAdminPin();
  sendPushToMembers.mockClear();
  process.env.NEXT_PUBLIC_FLAG_PAYMENTS_AUTO = 'true';
  await seedTestAdminMember();
  seedPointer('session-2026-10-08');
  seedSession('session-2026-10-08', { datetime: '2026-10-08T19:00:00-04:00' });
  seedSession('session-2026-09-24', { settled: settled(), datetime: '2026-09-24T19:00:00-04:00' });
  seedSession('session-2026-10-01', { settled: settled(), datetime: '2026-10-01T19:00:00-04:00' });
  lin = seedMember('Lin');
  key = await mintPaymentsKey('bpm');
});

afterEach(() => {
  delete process.env.NEXT_PUBLIC_FLAG_PAYMENTS_AUTO;
});

describe('reminderDue — the rules', () => {
  const line = (over: Partial<Parameters<typeof reminderDue>[0]> = {}) => ({
    settled: true,
    selfReported: false,
    settledAt: ago(4),
    remindedCount: 0,
    lastRemindedAt: null as string | null,
    ...over,
  });
  const now = Date.now();
  it.each([
    ['first nudge at 3 days', line({ settledAt: ago(3.1) }), true],
    ['not before 3 days', line({ settledAt: ago(2.9) }), false],
    ['second nudge at 7 days', line({ settledAt: ago(7.1), remindedCount: 1, lastRemindedAt: ago(4.1) }), true],
    ['a LATE first nudge does not pull the second to the next morning', line({ settledAt: ago(9), remindedCount: 1, lastRemindedAt: ago(1) }), false],
    ['…it waits the 4-day gap instead', line({ settledAt: ago(13), remindedCount: 1, lastRemindedAt: ago(4.1) }), true],
    ['not between 3 and 7 once nudged', line({ settledAt: ago(5), remindedCount: 1 }), false],
    ['never a third', line({ settledAt: ago(20), remindedCount: 2 }), false],
    ['not past 30 days — old history stays asleep', line({ settledAt: ago(31) }), false],
    ['not a live estimate', line({ settled: false }), false],
    ['not a line they said they paid', line({ selfReported: true }), false],
    ['not without a settle date', line({ settledAt: null }), false],
  ])('%s', (_label, l, expected) => {
    expect(reminderDue(l, now)).toBe(expected);
  });

  it('the push carries no amount, ever', () => {
    for (const n of [1, 2, 5]) expect(JSON.stringify(reminderPayload(n))).not.toMatch(/\$|\d+\.\d\d/);
  });
});

describe('POST /api/payments/remind', () => {
  it('404 flag off; 401 without the club key', async () => {
    expect((await call(null)).status).toBe(401);
    process.env.NEXT_PUBLIC_FLAG_PAYMENTS_AUTO = 'false';
    expect((await call()).status).toBe(404);
  });

  it('OFF by default: sends nothing, but records that the script called', async () => {
    seedPlayer('session-2026-09-24', 'Lin', { memberId: lin.id, owedAmount: 12, settledAt: ago(4) });
    expect(await (await call()).json()).toEqual({ ok: true, skipped: 'off' });
    expect(sendPushToMembers).not.toHaveBeenCalled();
    expect((await readPaymentsSettings('bpm'))?.lastReminderRunAt).toEqual(expect.any(String));
  });

  describe('switched on', () => {
    beforeEach(async () => {
      await notePaymentsSettings('bpm', { remindersOn: true });
    });

    it('nudges once per person, stamps every due line, and does not repeat the same day', async () => {
      const a = seedPlayer('session-2026-09-24', 'Lin', { memberId: lin.id, owedAmount: 12, settledAt: ago(4) });
      const b = seedPlayer('session-2026-10-01', 'Lin', { memberId: lin.id, owedAmount: 15, settledAt: ago(3.5) });
      expect(await (await call()).json()).toEqual({ ok: true, reminded: 1, sent: 1 });
      expect(sendPushToMembers).toHaveBeenCalledTimes(1);
      expect(sendPushToMembers).toHaveBeenCalledWith([lin.id], expect.objectContaining({ body: expect.stringContaining('couple of sessions') }));
      expect(row(a.id).remindedAt).toHaveLength(1);
      expect(row(b.id).remindedAt).toHaveLength(1);

      sendPushToMembers.mockClear();
      expect(await (await call()).json()).toEqual({ ok: true, reminded: 0, sent: 0 });
      expect(sendPushToMembers).not.toHaveBeenCalled();
    });

    it('skips the paid, the self-reported, the too-recent and the too-old', async () => {
      seedPlayer('session-2026-09-24', 'Lin', { memberId: lin.id, owedAmount: 12, settledAt: ago(4), paid: true });
      seedPlayer('session-2026-10-01', 'Lin', { memberId: lin.id, owedAmount: 15, settledAt: ago(4), selfReportedPaid: true });
      const v = seedMember('Viktor');
      seedPlayer('session-2026-10-01', 'Viktor', { memberId: v.id, owedAmount: 15, settledAt: ago(1) });
      const k = seedMember('Kento');
      seedPlayer('session-2026-09-24', 'Kento', { memberId: k.id, owedAmount: 12, settledAt: ago(45) });
      expect(await (await call()).json()).toEqual({ ok: true, reminded: 0, sent: 0 });
    });
  });
});

describe('the admin card', () => {
  it('previews who would be nudged before it is on', async () => {
    seedPlayer('session-2026-09-24', 'Lin', { memberId: lin.id, owedAmount: 12, settledAt: ago(4) });
    const inbox = await (await inboxGet(makeAdminRequest('GET', `${BASE}/admin/payments`))).json();
    expect(inbox.reminders).toEqual({ on: false, lastRunAt: null, wouldRemind: ['Lin'] });
  });

  it('the switch is admin-only and validated', async () => {
    expect((await patchSettings(makeRequest('PATCH', `${BASE}/admin/payments/settings`, { remindersOn: true }))).status).toBe(401);
    expect((await patchSettings(makeAdminRequest('PATCH', `${BASE}/admin/payments/settings`, { remindersOn: 'yes' }))).status).toBe(400);
    expect((await patchSettings(makeAdminRequest('PATCH', `${BASE}/admin/payments/settings`, { remindersOn: true }))).status).toBe(200);
    expect((await readPaymentsSettings('bpm'))?.remindersOn).toBe(true);
  });
});
