import { describe, it, expect } from 'vitest';
import { weekKeyFor, drillDocId } from '@/lib/drillsDone';
import { isoWeekKey } from '@/lib/kudos';

/**
 * ONE owner of "which week is this completion for". The first cut had two:
 * POST wrote under the ISO week when a group had no active session, while GET
 * read under '' — so a completion could be written and never read back.
 */
describe('weekKeyFor', () => {
  it('is the active session id when there is one', () => {
    expect(weekKeyFor('session-2026-09-10')).toBe('session-2026-09-10');
    expect(weekKeyFor('a1b2c3:session-2026-09-10')).toBe('a1b2c3:session-2026-09-10');
  });

  it('falls back to the real ISO week when a group has no session yet', () => {
    const now = new Date('2026-09-10T12:00:00Z');
    expect(weekKeyFor(null, now)).toBe(isoWeekKey(now));
  });

  it('never produces an empty doc id segment', () => {
    expect(drillDocId('m1', weekKeyFor(null))).toMatch(/^m1:.+$/);
  });
});
