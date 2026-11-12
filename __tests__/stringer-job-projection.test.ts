import { describe, it, expect } from 'vitest';
import { toStringerJob } from '../app/api/stringing/jobs/route';
import type { StringingJob } from '../lib/types';

/**
 * The stringer's view of a job (2026-11-12): a change waiting on the player
 * now reaches the stringer's list — so it can say "Waiting on Lin" and hold
 * its button — but WITHOUT its money. The price is taken out here on the
 * server, never in the browser.
 */
const base: StringingJob = {
  id: 'j1',
  jobNo: 'J-0001',
  memberId: 'm1',
  memberName: 'Lin',
  status: 'received',
  racketLabel: 'Arcsaber 7 Pro',
  stringLabel: 'BG80',
  tensionMains: 26,
  tensionCrosses: 28,
  method: '2 strings, 4 knots',
  readyBy: null,
  priceCents: 3400,
  createdAt: '2026-11-10T19:00:00-08:00',
  updatedAt: '2026-11-10T19:00:00-08:00',
} as unknown as StringingJob;

describe('toStringerJob', () => {
  it('sends no pending change when none is waiting', () => {
    expect('pendingEdit' in toStringerJob(base)).toBe(false);
  });

  it('sends what is changing, and never a price', () => {
    const job = {
      ...base,
      pendingEdit: { proposedAt: '2026-11-11T10:00:00-08:00', proposedBy: 'admin1', stringLabel: 'BG65', priceCents: 3000 },
    } as unknown as StringingJob;
    const out = toStringerJob(job);
    expect(out.pendingEdit).toEqual({ proposedAt: '2026-11-11T10:00:00-08:00', stringFrom: 'BG80', stringTo: 'BG65' });
    expect(JSON.stringify(out)).not.toMatch(/price|3000|3400|30\b|34\b/i);
  });

  it('a price-only change still says a change is waiting, with nothing to show', () => {
    const job = {
      ...base,
      pendingEdit: { proposedAt: '2026-11-11T10:00:00-08:00', proposedBy: 'admin1', priceCents: 3000 },
    } as unknown as StringingJob;
    expect(toStringerJob(job).pendingEdit).toEqual({ proposedAt: '2026-11-11T10:00:00-08:00' });
  });
});
