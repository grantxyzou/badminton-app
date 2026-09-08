import { describe, it, expect } from 'vitest';
import {
  BPM_GROUP_ID,
  TOLERATE_UNSTAMPED,
  groupDocId,
  sessionPrefix,
  matchesGroup,
} from '@/lib/groupScope';

/**
 * The id and predicate helpers every group-scoped read will lean on.
 *
 * The load-bearing rule: BPM's existing ids are NEVER rewritten. Group #1 keeps
 * `session-YYYY-MM-DD`, `active-session-pointer` and `stringing` exactly as
 * production holds them today; only a NEW group gets a prefix. That is what
 * lets a rollback run older code against the migrated database.
 */
describe('groupDocId', () => {
  it('leaves a BPM id untouched', () => {
    expect(groupDocId(BPM_GROUP_ID, 'active-session-pointer')).toBe('active-session-pointer');
  });

  it('prefixes any other group with its id and a colon', () => {
    expect(groupDocId('a1b2c3', 'active-session-pointer')).toBe('a1b2c3:active-session-pointer');
  });
});

describe('sessionPrefix', () => {
  it('is the legacy prefix for BPM', () => {
    expect(sessionPrefix(BPM_GROUP_ID)).toBe('session-');
  });

  it('is group-qualified for a new group', () => {
    expect(sessionPrefix('a1b2c3')).toBe('a1b2c3:session-');
  });
});

describe('matchesGroup', () => {
  it('matches a row stamped with the group', () => {
    expect(matchesGroup({ groupId: 'x' }, 'x', false)).toBe(true);
    expect(matchesGroup({ groupId: 'x' }, 'y', false)).toBe(false);
  });

  it('in tolerant mode, an UNSTAMPED row belongs to BPM and to nobody else', () => {
    expect(matchesGroup({}, BPM_GROUP_ID, true)).toBe(true);
    expect(matchesGroup({}, 'a1b2c3', true)).toBe(false);
  });

  it('in strict mode, an unstamped row belongs to nobody', () => {
    expect(matchesGroup({}, BPM_GROUP_ID, false)).toBe(false);
  });

  it('defaults to the module constant', () => {
    expect(matchesGroup({}, BPM_GROUP_ID)).toBe(TOLERATE_UNSTAMPED);
  });
});
