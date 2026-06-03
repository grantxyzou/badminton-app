import { describe, it, expect, beforeEach } from 'vitest';
import { PUT } from '@/app/api/session/route';
import { resetMockStore, setupAdminPin, seedPointer, seedSession, makeAdminRequest, getStore } from './helpers';

/**
 * Audit finding: PUT /api/session rebuilt the doc from a fixed key-set and
 * upserted WITHOUT reading the existing record, so any field the editing client
 * doesn't round-trip was silently destroyed. A routine "Save session details"
 * (or date/time edit) wiped:
 *   - settled            -> un-settles the session (breaks ledger gap math)
 *   - approvedNames      -> reopens a closed invite list (security regression)
 *   - prevCostPerPerson  -> kills the "you owe from last week" reminder
 * The handler must read-then-spread, only overwriting keys the body supplied.
 */
const SID = 'session-2026-06-01';

describe('PUT /api/session preserves fields the client does not send', () => {
  beforeEach(() => {
    resetMockStore();
    setupAdminPin();
    seedPointer(SID);
    seedSession(SID, {
      title: 'Old Title',
      courts: 2,
      settled: { costPerPerson: 12, settledAt: '2026-06-01T00:00:00Z' },
      approvedNames: ['Lin', 'Viktor'],
      prevCostPerPerson: 9.5,
      prevSessionDate: '2026-05-25',
    });
  });

  it('keeps settled / approvedNames / prevCostPerPerson when editing only other fields', async () => {
    const req = makeAdminRequest('PUT', 'http://localhost/api/session', {
      title: 'New Title',
      courts: 3,
      maxPlayers: 16,
    });
    const res = await PUT(req);
    expect(res.status).toBe(200);

    const session = (getStore().sessions ?? []).find((s) => (s as { id?: string }).id === SID) as Record<string, unknown>;
    // Edited fields applied:
    expect(session.title).toBe('New Title');
    expect(session.courts).toBe(3);
    // Un-round-tripped fields PRESERVED (the bug wiped these):
    expect(session.settled).toBeTruthy();
    expect(session.approvedNames).toEqual(['Lin', 'Viktor']);
    expect(session.prevCostPerPerson).toBe(9.5);
  });
});
