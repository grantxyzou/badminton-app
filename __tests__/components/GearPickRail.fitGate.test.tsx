import { describe, it, expect } from 'vitest';
import { PROFILE_READS_FIT } from '../../lib/racketProfile';

/**
 * The rail keys its `/api/recommend` refetch on `PROFILE_READS_FIT`. It was
 * false through Phase 1 (no engine read the fit answers, so re-asking on them
 * burnt the 10/min limiter on identical picks) and flipped with the Phase 2
 * fit engine. The refetch machinery itself is pinned in
 * `GearPickRail.test.tsx`; this only pins that the gate matches the engine.
 */
describe('GearPickRail — the fit refetch gate', () => {
  it('is open now that lib/racketFit.ts reads the fit answers', () => {
    expect(PROFILE_READS_FIT).toBe(true);
  });
});
