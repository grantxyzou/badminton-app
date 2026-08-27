import { describe, it, expect } from 'vitest';
import { isBillable, stringingCharges, stringingTotal } from '../lib/stringingBilling';
import { formatPriceBand, priceBand } from '../lib/stringing';
import type { StringingStatus } from '../lib/stringing';
import type { StringingJob } from '../lib/types';

/**
 * When a stringing job stops being a quote and becomes a bill.
 *
 * The rest of this feature hides the stringer's exact figure behind a
 * quantised band. A balance line is the one place that must NOT: you cannot
 * total a range, and you cannot ask somebody to pay one. These tests pin where
 * the wall ends, because "just show the band on the receipt too" is the
 * plausible-sounding change that would break the total.
 */
function job(over: Partial<StringingJob> = {}): StringingJob {
  const now = '2026-08-27T00:00:00.000Z';
  return {
    id: 'job-1',
    memberId: 'member-wei',
    jobNo: 'J-0042',
    memberName: 'Wei',
    stringerId: 'member-grant',
    stringerName: 'Grant',
    status: 'ready',
    racketLabel: 'Astrox 99 Pro',
    stringLabel: 'BG80',
    tensionMains: 26,
    tensionCrosses: 28,
    method: 'Zach',
    priceCents: 3000,
    readyBy: null,
    acceptedAt: null,
    paidAt: null,
    sessionId: null,
    createdAt: now,
    updatedAt: now,
    history: [],
    ...over,
  };
}

describe('a bill is a number, not a range', () => {
  it('charges the EXACT price, never the band', () => {
    // $30.00 shows to a player as "$28–32" everywhere else. On a receipt it
    // has to be $30, or the total is fiction.
    const [charge] = stringingCharges([job({ priceCents: 3000 })]);
    expect(charge.amount).toBe(30);
    expect(formatPriceBand(priceBand(3000))).toBe('$28–32');
  });

  it('sums in cents so the total agrees with its own lines', () => {
    // Adding dollars as floats gives 0.1 + 0.2 drift, and a receipt whose
    // total is a cent off what is above it is the kind of thing people notice
    // and then stop trusting.
    const charges = stringingCharges([
      job({ id: 'a', priceCents: 1010 }),
      job({ id: 'b', priceCents: 2020 }),
      job({ id: 'c', priceCents: 3030 }),
    ]);
    expect(stringingTotal(charges)).toBe(60.6);
  });
});

describe('what is not yet owed', () => {
  it('does not bill for a racket still on the bench', () => {
    // Asking someone to pay for a racket they cannot use yet. It also means a
    // job corrected backwards un-bills itself, which beats billing early.
    for (const status of ['requested', 'received', 'strung'] as StringingStatus[]) {
      expect(isBillable(job({ status }))).toBe(false);
    }
    for (const status of ['ready', 'picked_up'] as StringingStatus[]) {
      expect(isBillable(job({ status }))).toBe(true);
    }
  });

  it('does not bill an unpriced job as free', () => {
    // No price means undecided, not zero. A $0 line on a receipt is a claim.
    expect(isBillable(job({ priceCents: null }))).toBe(false);
    expect(isBillable(job({ priceCents: 0 }))).toBe(false);
    expect(stringingCharges([job({ priceCents: null })])).toEqual([]);
  });

  it('drops a job once the stringer marks it paid', () => {
    expect(isBillable(job({ paidAt: '2026-08-27T10:00:00Z' }))).toBe(false);
  });
});

describe('the receipt reads newest first', () => {
  it('orders by when the work finished', () => {
    const charges = stringingCharges([
      job({ id: 'old', updatedAt: '2026-08-01T00:00:00Z' }),
      job({ id: 'new', updatedAt: '2026-08-26T00:00:00Z' }),
      job({ id: 'mid', updatedAt: '2026-08-14T00:00:00Z' }),
    ]);
    expect(charges.map((c) => c.jobId)).toEqual(['new', 'mid', 'old']);
  });

  it('carries what a player needs to recognise the racket', () => {
    const [charge] = stringingCharges([job()]);
    expect(charge.racketLabel).toBe('Astrox 99 Pro');
    expect(charge.jobNo).toBe('J-0042');
  });
});
