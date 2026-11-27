import { describe, it, expect } from 'vitest';
import { countedJob, summarizeStringStock } from '@/lib/stringStock';
import { deletedPaidJobs, summarizeEarnings, type EarningsJob } from '@/lib/stringingEarnings';
import { withDeletedUses, type StringUse } from '@/lib/stringStock';
import { buildStringEarningsReport } from '@/lib/stringStockReport';
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
    jobs: jobs.map((j) => countedJob({ id: j.id, stringLabel: j.stringLabel, status: j.status, archivedAt: undefined, ownString: j.ownString, history: j.history, createdAt: j.createdAt })),
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

  it('a job with no strung entry is costed on the day it was made, not at today’s price', () => {
    const old = job({ id: 'old', history: [], createdAt: '2026-09-10T20:00:00Z' });
    const reels = [purchase({ totalCostCents: 16000, date: '2026-08-01' }), purchase({ totalCostCents: 24000, date: '2026-11-20' })];
    expect(fold([old], reels).months.find((m) => m.month === '2026-09')!.stringCostCents).toBe(800);
  });

  it('counts what it cannot price instead of calling it zero', () => {
    const s = fold([
      job(),
      job({ priceCents: null }), // strung, never priced
      job({ stringLabel: 'BG80 / BG65' }), // a hybrid: BG80 is on the shelf, BG65 is not
      job({ stringLabel: 'Aerobite' }), // not on the shelf
      job({ ownString: true }), // the player's own: nothing to know
    ]);
    // Two whole sets of BG80 and the hybrid's half: $10 + $10 + $5.
    expect(nov(s)).toMatchObject({ jobs: 5, unpricedJobs: 1, unknownCostJobs: 2, stringCostCents: 2500 });
    // A shelf string nobody ever bought has no price either.
    const none = fold([job()], []);
    expect(nov(none)).toMatchObject({ unknownCostJobs: 1, stringCostCents: 0 });
  });

  describe('a hybrid', () => {
    const bg65 = (o: Partial<StringPurchase> = {}) => purchase({ label: 'BG65', totalCostCents: 14000, ...o });
    const shelf = ['BG80', 'BG65'];

    it('takes half a set of each string off a reel, and shares its price between the two', () => {
      const s = fold([job({ stringLabel: 'BG80 / BG65', priceCents: 3000 })], [purchase(), bg65()], shelf);
      // Half of a $10 set and half of a $7 set.
      expect(nov(s)).toMatchObject({ jobs: 1, sets: 1, workCents: 3000, stringCostCents: 850, unknownCostJobs: 0 });
      expect(nov(s).strings).toEqual([
        { key: 's:BG80', jobs: 0.5, sets: 0.5, workCents: 1500, costCents: 500 },
        { key: 's:BG65', jobs: 0.5, sets: 0.5, workCents: 1500, costCents: 350 },
      ]);
      expect(s.strings.map((x) => [x.key, x.allTimeWorkCents])).toEqual([['s:BG80', 1500], ['s:BG65', 1500]]);
    });

    it('takes a whole packet for a string that only comes in packets', () => {
      // BG65 bought as single $9 packets: the packet is opened for this racket.
      const packets = bg65({ unit: 'set', units: 2, metresPerUnit: 10, totalCostCents: 1800 });
      const s = fold([job({ stringLabel: 'BG80 / BG65' })], [purchase(), packets], shelf);
      expect(nov(s)).toMatchObject({ sets: 1.5, stringCostCents: 500 + 900 });
      expect(nov(s).strings.find((r) => r.key === 's:BG65')).toMatchObject({ jobs: 0.5, sets: 1, costCents: 900 });
      // Two packet strings: two whole packets.
      const both = fold(
        [job({ stringLabel: 'BG80 / BG65' })],
        [purchase({ unit: 'set', units: 1, metresPerUnit: 10, totalCostCents: 1200 }), packets], shelf,
      );
      expect(nov(both)).toMatchObject({ sets: 2, stringCostCents: 1200 + 900 });
    });

    it('a reel bought only AFTER the job does not make its side half a set', () => {
      const packets = bg65({ unit: 'set', units: 1, metresPerUnit: 10, totalCostCents: 900, date: '2026-10-01' });
      const laterReel = bg65({ date: '2026-11-15' });
      const s = fold([job({ stringLabel: 'BG80 / BG65', strungAt: '2026-11-10T20:00:00Z' })], [purchase(), packets, laterReel], shelf);
      expect(nov(s).strings.find((r) => r.key === 's:BG65')).toMatchObject({ sets: 1, costCents: 900 });
    });

    it('keeps the odd cent on the first string, so the two rows add up to the job', () => {
      const s = fold([job({ stringLabel: 'BG80 / BG65', priceCents: 3001 })], [purchase(), bg65()], shelf);
      expect(nov(s).strings.map((r) => r.workCents)).toEqual([1501, 1500]);
      expect(nov(s).workCents).toBe(3001);
    });

    it('costs the side the shelf knows and counts the job as short for the other', () => {
      const s = fold([job({ stringLabel: 'BG80 / Aerobite' })]);
      expect(nov(s)).toMatchObject({ jobs: 1, unknownCostJobs: 1, stringCostCents: 500 });
      expect(nov(s).strings).toEqual([
        { key: 's:BG80', jobs: 0.5, sets: 0.5, workCents: 1500, costCents: 500 },
        { key: 'x:aerobite', jobs: 0.5, sets: 1, workCents: 1500, costCents: 0 },
      ]);
    });

    it('the same string named twice, or a colour typed after it, is one whole set', () => {
      const s = fold([job({ stringLabel: 'BG80 / BG80' }), job({ stringLabel: 'BG80 · White' })]);
      expect(nov(s)).toMatchObject({ jobs: 2, sets: 2, stringCostCents: 2000, unknownCostJobs: 0 });
      expect(nov(s).strings).toEqual([{ key: 's:BG80', jobs: 2, sets: 2, workCents: 6000, costCents: 2000 }]);
    });

    it('two names for ONE shelf string is one set, never a packet a side', () => {
      const stock = summarizeStringStock({
        offered: ['BG80'], links: {}, aliases: { 'Yonex BG80': 'BG80' }, catalog: new Map(),
        purchases: [purchase({ unit: 'set', units: 3, metresPerUnit: 10, totalCostCents: 3600 })],
        jobs: [{ id: 'h', stringLabel: 'BG80 / Yonex BG80', status: 'picked_up', strungAt: '2026-11-10T03:00:00Z' }],
      });
      expect(stock.lines[0]).toMatchObject({ usedSets: 1 });
      expect(stock.jobParts!.h).toEqual([{ line: 'BG80', label: 'BG80', sets: 1, costCents: 1200 }]);
    });

    it('comes off the shelf: half a set a side', () => {
      const stock = summarizeStringStock({
        offered: shelf, links: {}, purchases: [purchase(), bg65()], catalog: new Map(),
        jobs: [
          { id: 'h', stringLabel: 'BG80 / BG65', status: 'picked_up', strungAt: '2026-11-10T03:00:00Z' },
          { id: 'p', stringLabel: 'BG80', status: 'picked_up', strungAt: '2026-11-10T03:00:00Z' },
        ],
      });
      const line = (label: string) => stock.lines.find((l) => l.label === label)!;
      expect(line('BG80')).toMatchObject({ usedSets: 1.5, usedMetres: 15, remainingMetres: 185 });
      expect(line('BG65')).toMatchObject({ usedSets: 0.5, usedMetres: 5, remainingMetres: 195 });
      expect(stock.unmatched).toEqual([]);
    });
  });

  describe('a deleted job', () => {
    const use = (o: Partial<StringUse> = {}): StringUse => ({
      id: 'su-gone', kind: 'stringUse', jobId: 'gone', stringLabel: 'BG80',
      strungAt: '2026-10-20T20:00:00Z', deletedAt: '2026-11-12T00:00:00Z', createdAt: '2026-10-18T00:00:00Z', ...o,
    });
    const foldWith = (jobs: EarningsJob[], uses: StringUse[]) => {
      const stock = summarizeStringStock({
        offered: ['BG80'], links: {}, purchases: [purchase()], catalog: new Map(),
        jobs: withDeletedUses(
          jobs.map((j) => countedJob({ id: j.id, stringLabel: j.stringLabel, status: j.status, archivedAt: undefined, ownString: j.ownString, history: j.history, createdAt: j.createdAt })),
          uses,
        ),
      });
      return summarizeEarnings({ jobs: [...jobs, ...deletedPaidJobs(uses, new Set(jobs.map((j) => j.id)))], stock, now: NOW });
    };

    it('still counts when it was paid: in the month it was strung, as collected, with its string cost', () => {
      const s = foldWith([job()], [use({ priceCents: 2800, paidAt: '2026-10-22T00:00:00Z' })]);
      expect(s.months.find((m) => m.month === '2026-10')).toMatchObject({
        jobs: 1, workCents: 2800, collectedCents: 2800, owedCents: 0, notInvoicedCents: 0, stringCostCents: 1000, sets: 1, waiting: [],
      });
      expect(nov(s)).toMatchObject({ jobs: 1, workCents: 3000 });
    });

    it('is the shelf’s alone when it was never paid, or deleted before the row kept money', () => {
      const s = foldWith([job()], [use(), use({ id: 'su-old', jobId: 'old', priceCents: 2800 })]);
      expect(s.months.map((m) => m.month)).toEqual(['2026-11']);
      expect(nov(s)).toMatchObject({ jobs: 1, workCents: 3000 });
    });

    it('with the player’s own string keeps its money and takes no set', () => {
      const s = foldWith([], [use({ ownString: true, priceCents: 1500, paidAt: '2026-10-22T00:00:00Z' })]);
      const oct = s.months.find((m) => m.month === '2026-10')!;
      expect(oct).toMatchObject({ jobs: 1, workCents: 1500, collectedCents: 1500, stringCostCents: 0, sets: 0, unknownCostJobs: 0 });
      expect(oct.strings).toEqual([{ key: 'own', jobs: 1, sets: 0, workCents: 1500, costCents: 0 }]);
    });

    it('is never counted twice while the job is still stored', () => {
      const live = job({ id: 'gone', paidAt: '2026-11-12T00:00:00Z' });
      const s = foldWith([live], [use({ priceCents: 3000, paidAt: '2026-11-12T00:00:00Z' })]);
      expect(s.months.reduce((n, m) => n + m.jobs, 0)).toBe(1);
    });
  });

  describe('the report', () => {
    it('carries the page’s months as totals, and no name', () => {
      const s = fold([
        job({ paidAt: '2026-11-12T00:00:00Z' }),
        job({ priceCents: 2800 }),
        job({ stringLabel: 'Aerobite for Viktor', priceCents: 2000 }),
        job({ ownString: true, priceCents: 1500, stringLabel: 'Viktor’s own' }),
        job({ strungAt: '2026-10-10T20:00:00Z', paidAt: '2026-10-12T00:00:00Z' }),
      ]);
      const report = buildStringEarningsReport(s);
      expect(report.months.map((m) => m.month)).toEqual(['2026-10', '2026-11']);
      expect(report.months[1]).toMatchObject({
        jobs: 4, workCents: 9300, collectedCents: 3000, owedCents: 6300, notInvoicedCents: 0,
        stringCostCents: 2000, afterStringCostCents: 7300, sets: 3, unpricedJobs: 0, unknownCostJobs: 1, waitingJobs: 3,
      });
      expect(report.months[1].strings).toEqual([
        { label: 'BG80', jobs: 2, sets: 2, workCents: 5800, costCents: 2000 },
        { label: 'offShelf', jobs: 1, sets: 1, workCents: 2000, costCents: 0 },
        { label: 'ownString', jobs: 1, sets: 0, workCents: 1500, costCents: 0 },
      ]);
      expect(report.totals).toMatchObject({ jobs: 5, workCents: 12300, collectedCents: 6000, stringCostCents: 3000, afterStringCostCents: 9300 });
      // No player, no job number, no label somebody typed.
      const text = JSON.stringify(report);
      expect(text).not.toMatch(/Lin|Viktor|J-|Aerobite/);
    });
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
