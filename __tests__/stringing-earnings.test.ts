import { describe, it, expect } from 'vitest';
import { countedJob, summarizeStringStock } from '@/lib/stringStock';
import { summarizeEarnings, type EarningsJob } from '@/lib/stringingEarnings';
import type { StringPurchase } from '@/lib/types';

/**
 * The earnings fold (docs/plans/stringing-earnings.md): the month a job's
 * string went in, the three piles, and the string cost off the shelf's own
 * match. NOW is 18 November 2026, Vancouver.
 */

const NOW = new Date('2026-11-18T20:00:00Z');
let n = 0;
const purchase = (o: Partial<StringPurchase> = {}): StringPurchase => ({
  id: `sp-${String(++n).padStart(16, '0')}`, kind: 'stringPurchase', label: 'BG80', unit: 'reel', units: 1, metresPerUnit: 200,
  totalCostCents: 20000, date: '2026-10-01', createdAt: '2026-10-01T00:00:00Z', createdBy: 'a', ...o,
});
const job = (o: Partial<EarningsJob> & { strungAt?: string } = {}): EarningsJob => {
  const { strungAt = '2026-11-10T03:00:00Z', ...rest } = o;
  const id = rest.id ?? `j${++n}`;
  return {
    id, jobNo: `J-${id}`, memberName: 'Lin', status: 'picked_up', priceCents: 3000, paidAt: null,
    stringLabel: 'BG80', createdAt: '2026-11-01T00:00:00Z',
    history: [{ status: 'received', at: '2026-11-01T00:00:00Z' }, { status: 'strung', at: strungAt }, { status: 'ready', at: strungAt }],
    ...rest,
  };
};

const fold = (jobs: EarningsJob[], purchases: StringPurchase[] = [purchase()], offered = ['BG80']) => {
  const stock = summarizeStringStock({
    offered, links: {}, purchases, catalog: new Map(),
    // As `loadStringStock` hands them over: each job's history folded to `strungAt`.
    jobs: jobs.map((j) => countedJob({ id: j.id, stringLabel: j.stringLabel, status: j.status, archivedAt: undefined, ownString: j.ownString, history: j.history })),
  });
  return summarizeEarnings({ jobs, stock, now: NOW });
};
const nov = (s: ReturnType<typeof fold>) => s.months.find((m) => m.month === '2026-11')!;

describe('summarizeEarnings', () => {
  it('runs from the month of the first counted job to now, every month present', () => {
    expect(fold([]).months.map((m) => m.month)).toEqual(['2026-11']);
    const s = fold([job({ strungAt: '2026-08-10T20:00:00Z' }), job()]);
    expect(s.months.map((m) => m.month)).toEqual(['2026-08', '2026-09', '2026-10', '2026-11']);
    // A racket still on the bench does not stretch the window back.
    expect(fold([job({ status: 'received', history: [], createdAt: '2025-01-10T20:00:00Z' })]).months).toHaveLength(1);
  });

  it('never reaches back more than three years', () => {
    const s = fold([job({ strungAt: '2019-05-10T20:00:00Z' })]);
    expect(s.months).toHaveLength(36);
    expect(s.months[0].month).toBe('2023-12');
  });

  it('puts each job in exactly one pile', () => {
    const s = fold([
      job({ paidAt: '2026-11-12T00:00:00Z' }),
      job({ priceCents: 2800 }), // Ready, unpaid, bills at Ready: owed
      job({ priceCents: 3200, billOn: 'invoice', invoice: { sentAt: '2026-11-14T00:00:00Z' } }),
      job({ priceCents: 2500, billOn: 'invoice' }), // not sent: not invoiced
      job({ priceCents: 2000, status: 'strung', history: [{ status: 'strung', at: '2026-11-15T00:00:00Z' }] }),
    ]);
    const m = nov(s);
    expect(m).toMatchObject({ jobs: 5, workCents: 13500, collectedCents: 3000, owedCents: 6000, notInvoicedCents: 4500 });
    expect(m.collectedCents + m.owedCents + m.notInvoicedCents).toBe(m.workCents);
  });

  it('counts a job in the month its string went in, in Vancouver', () => {
    // 1 Nov 03:00 UTC is still 31 October in Vancouver.
    const s = fold([job({ strungAt: '2026-11-01T03:00:00Z' }), job({ strungAt: '2026-11-02T03:00:00Z' })]);
    expect(s.months.find((m) => m.month === '2026-10')!.jobs).toBe(1);
    expect(nov(s).jobs).toBe(1);
  });

  it('leaves out a racket still on the bench and a withdrawn unpaid job; keeps a withdrawn paid one', () => {
    const s = fold([
      job({ status: 'received', history: [] }),
      job({ cancelledAt: '2026-11-11T00:00:00Z' }),
      job({ cancelledAt: '2026-11-11T00:00:00Z', paidAt: '2026-11-11T00:00:00Z' }),
    ]);
    expect(nov(s)).toMatchObject({ jobs: 1, workCents: 3000, collectedCents: 3000 });
  });

  it('prices the string off the shelf line the stock matched, and own string at nothing', () => {
    // $200 for 200 m at 10 m a set: $10 a set. The job says "Yonex BG80"
    // in no way the shelf knows, so it is its own row at no cost.
    const s = fold([job(), job({ stringLabel: 'bg80 ' }), job({ ownString: true, priceCents: 2000 }), job({ stringLabel: 'Aerobite' })]);
    const m = nov(s);
    expect(m.stringCostCents).toBe(2000);
    expect(m.sets).toBe(3);
    const by = Object.fromEntries(m.strings.map((r) => [r.key, r]));
    expect(by['s:BG80']).toMatchObject({ jobs: 2, sets: 2, workCents: 6000, costCents: 2000 });
    expect(by.own).toMatchObject({ jobs: 1, sets: 0, costCents: 0 });
    expect(by['x:aerobite']).toMatchObject({ jobs: 1, sets: 1, costCents: 0 });
    const bg80 = s.strings.find((x) => x.key === 's:BG80')!;
    expect(bg80).toMatchObject({ costPerSetCents: 1000, purchasedCostCents: 20000, allTimeWorkCents: 6000, remainingSets: 18 });
  });

  it('costs a set at the price of the day it was strung, so a new reel moves no past month', () => {
    // A $160 reel in August ($8 a set), a $240 one on 20 November ($12).
    const jobs = [
      job({ id: 'sep', strungAt: '2026-09-10T20:00:00Z' }),
      job({ id: 'early-nov', strungAt: '2026-11-10T20:00:00Z' }),
      job({ id: 'late-nov', strungAt: '2026-11-21T20:00:00Z' }),
      // Strung before the first reel was ever logged: the first one's price.
      job({ id: 'july', strungAt: '2026-07-10T20:00:00Z' }),
    ];
    const reels = [purchase({ totalCostCents: 16000, date: '2026-08-01' }), purchase({ totalCostCents: 24000, date: '2026-11-20' })];
    const s = fold(jobs, reels);
    const cost = (month: string) => s.months.find((m) => m.month === month)!.stringCostCents;
    expect(cost('2026-07')).toBe(800);
    expect(cost('2026-09')).toBe(800);
    expect(cost('2026-11')).toBe(800 + 1200);
    // The shelf still says today's price.
    expect(s.strings.find((x) => x.key === 's:BG80')!.costPerSetCents).toBe(1200);
    // And September is the same before the second reel exists.
    expect(fold(jobs, [reels[0]]).months.find((m) => m.month === '2026-09')!.stringCostCents).toBe(800);
  });

  it('counts what it cannot price instead of calling it zero', () => {
    const s = fold([
      job(),
      job({ priceCents: null }), // strung, never priced
      job({ stringLabel: 'BG80 / BG65' }), // a hybrid: no shelf line
      job({ stringLabel: 'Aerobite' }), // not on the shelf
      job({ ownString: true }), // the player's own: nothing to know
    ]);
    expect(nov(s)).toMatchObject({ jobs: 5, unpricedJobs: 1, unknownCostJobs: 2, stringCostCents: 2000 });
    // A shelf string nobody ever bought has no price either.
    const none = fold([job()], []);
    expect(nov(none)).toMatchObject({ unknownCostJobs: 1, stringCostCents: 0 });
  });

  it('lists a shelf string nobody strung this month, at nothing', () => {
    const s = fold([job()], [purchase(), purchase({ label: 'BG65', totalCostCents: 14000 })], ['BG80', 'BG65']);
    expect(s.strings.map((x) => x.key)).toEqual(['s:BG80', 's:BG65']);
    expect(nov(s).strings.map((r) => r.key)).toEqual(['s:BG80']);
  });

  it('says why each unpaid job is waiting, oldest first', () => {
    const s = fold([
      job({ id: 'inv', billOn: 'invoice', invoice: { sentAt: '2026-11-08T00:00:00Z', lastSentAt: '2026-11-14T00:00:00Z' } }),
      job({ id: 'ready', strungAt: '2026-11-05T00:00:00Z' }),
      job({ id: 'unsent', billOn: 'invoice', strungAt: '2026-11-15T00:00:00Z' }),
      job({ id: 'paid', paidAt: '2026-11-12T00:00:00Z' }),
      job({ id: 'free', priceCents: null }),
    ]);
    expect(nov(s).waiting.map((w) => [w.jobId, w.state, w.since])).toEqual([
      ['ready', 'owed', '2026-11-05T00:00:00Z'],
      ['inv', 'invoiced', '2026-11-14T00:00:00Z'],
      ['unsent', 'not_invoiced', '2026-11-15T00:00:00Z'],
    ]);
  });
});
