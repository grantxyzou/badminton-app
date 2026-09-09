import { describe, it, expect, beforeEach } from 'vitest';
import {
  getActiveSessionId,
  setActiveSessionId,
  sessionIdFromDate,
  POINTER_ID,
  SESSION_ID,
} from '@/lib/cosmos';
import { BPM_GROUP_ID, groupDocId } from '@/lib/groupScope';
import { resetMockStore, getStore, seedPointer } from './helpers';

/**
 * The active-session pointer, per group.
 *
 * BPM keeps the ids production holds today — `active-session-pointer`,
 * `session-YYYY-MM-DD`, and the `'current-session'` fallback from before the
 * pointer existed. A NEW group gets prefixed ids and NO fallback: a group with
 * no pointer has no session, and the honest answer is `null`, not an id that
 * points at nothing.
 */
describe('session pointer per group', () => {
  beforeEach(() => resetMockStore());

  it('reads BPM\'s legacy pointer doc unchanged', async () => {
    seedPointer('session-2026-09-10');
    expect(await getActiveSessionId(BPM_GROUP_ID)).toBe('session-2026-09-10');
  });

  it('falls back to the legacy id for BPM only', async () => {
    expect(await getActiveSessionId(BPM_GROUP_ID)).toBe(SESSION_ID);
    expect(await getActiveSessionId('a1b2c3')).toBeNull();
  });

  it('reads another group\'s pointer from its prefixed doc', async () => {
    getStore().sessions = [
      { id: POINTER_ID, sessionId: POINTER_ID, activeSessionId: 'session-2026-09-10' },
      {
        id: groupDocId('a1b2c3', POINTER_ID),
        sessionId: groupDocId('a1b2c3', POINTER_ID),
        groupId: 'a1b2c3',
        activeSessionId: 'a1b2c3:session-2026-09-12',
      },
    ];
    expect(await getActiveSessionId('a1b2c3')).toBe('a1b2c3:session-2026-09-12');
    expect(await getActiveSessionId(BPM_GROUP_ID)).toBe('session-2026-09-10');
  });

  it('writes a group\'s pointer under its prefixed id, stamped, with sessionId === id', async () => {
    await setActiveSessionId('a1b2c3', 'a1b2c3:session-2026-09-12');
    const doc = (getStore().sessions as Record<string, unknown>[]).find((s) => s.id === 'a1b2c3:active-session-pointer') as
      | Record<string, unknown>
      | undefined;
    expect(doc).toBeDefined();
    expect(doc?.sessionId).toBe('a1b2c3:active-session-pointer');
    expect(doc?.groupId).toBe('a1b2c3');
    expect(doc?.activeSessionId).toBe('a1b2c3:session-2026-09-12');
  });

  it('writes BPM\'s pointer under the legacy id, stamped bpm', async () => {
    await setActiveSessionId(BPM_GROUP_ID, 'session-2026-09-10');
    const doc = (getStore().sessions as Record<string, unknown>[]).find((s) => s.id === POINTER_ID) as Record<string, unknown> | undefined;
    expect(doc?.sessionId).toBe(POINTER_ID);
    expect(doc?.groupId).toBe(BPM_GROUP_ID);
  });
});

describe('sessionIdFromDate per group', () => {
  it('keeps the legacy shape for BPM', () => {
    expect(sessionIdFromDate('2026-09-10T19:00:00-07:00', BPM_GROUP_ID)).toBe('session-2026-09-10');
  });

  it('prefixes a new group, so two groups on one date cannot collide on the sessions PK', () => {
    expect(sessionIdFromDate('2026-09-10T19:00:00-07:00', 'a1b2c3')).toBe('a1b2c3:session-2026-09-10');
  });
});
