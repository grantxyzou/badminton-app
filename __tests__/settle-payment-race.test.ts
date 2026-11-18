import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import type { Player } from '@/lib/types';
import { resetMockStore, getStore, seedPointer, seedSession, seedPlayer, seedMember, makeAdminRequest, setupAdminPin, seedTestAdminMember } from './helpers';

/**
 * A payment that lands on a row WHILE the settle is stamping bills must
 * survive (money guard, 2026-11-18). The settle read every row first and
 * then upserted its copy back, so a tap or an e-transfer in between was
 * overwritten: the row went back to unpaid and the ledger kept a payment
 * nobody could see. It writes under the etag now and re-reads on a lost race.
 *
 * The race is opened by a wrapper around `groupScope().replace`: just before
 * the settle's first write to Lin's row, the "other phone" pays her.
 */

const SID = 'session-2026-10-01';
const rows = () => getStore()['players'] as Array<Player & Record<string, unknown>>;
const rowOf = (name: string) => rows().find((p) => p.name === name)!;

let payDuringSettle = false;
vi.mock('@/lib/groupScope', async (importOriginal) => {
  const mod = await importOriginal<typeof import('@/lib/groupScope')>();
  return {
    ...mod,
    groupScope: (groupId: string) => {
      const scope = mod.groupScope(groupId);
      return {
        ...scope,
        replace: async (container: string, doc: Record<string, unknown>, pk?: string) => {
          if (payDuringSettle && container === 'players' && doc.name === 'Lin') {
            payDuringSettle = false;
            // The other phone's tap lands: the stored row changes, and its etag with it.
            Object.assign(rowOf('Lin'), { paid: true, paidAt: '2026-10-02T01:00:00.000Z', paidVia: 'manual', _etag: 'mock-etag-other-phone' });
          }
          return scope.replace(container as never, doc as never, pk);
        },
      };
    },
  };
});

import { POST as settle } from '@/app/api/session/settle/route';

beforeEach(async () => {
  resetMockStore();
  setupAdminPin();
  payDuringSettle = false;
  await seedTestAdminMember();
  seedPointer(SID);
  seedSession(SID, { costPerCourt: 30, courts: 2, datetime: '2026-10-01T19:00:00-04:00' });
  seedPlayer(SID, 'Lin', { memberId: seedMember('Lin').id, _etag: 'mock-etag-lin-1' });
  seedPlayer(SID, 'Viktor', { memberId: seedMember('Viktor').id, _etag: 'mock-etag-viktor-1' });
});

afterEach(() => {
  payDuringSettle = false;
});

describe('settle and a payment at the same moment', () => {
  it('keeps the payment: the lost race re-reads the row and stamps the bill on the PAID row', async () => {
    payDuringSettle = true;
    const res = await settle(makeAdminRequest('POST', 'http://localhost:3000/api/session/settle'));
    expect(res.status).toBe(200);
    expect(rowOf('Lin')).toMatchObject({ paid: true, paidVia: 'manual', owedAmount: 30, paidAmount: 30 });
    expect(typeof rowOf('Lin').settledAt).toBe('string');
    expect(rowOf('Viktor')).toMatchObject({ owedAmount: 30 });
    expect(rowOf('Viktor').paid).not.toBe(true);
  });
});
