// @vitest-environment node
import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import { GET } from '@/app/api/admin/slice0/route';
import { CLIENT_KINDS, SERVER_KINDS } from '@/lib/events';
import {
  resetMockStore,
  getStore,
  setupAdminPin,
  seedAdminMember,
  seedMember,
  seedPlayer,
  makeGetRequest,
} from './helpers';

/**
 * EVERY EVENT KIND MUST MOVE THE SLICE-0 BODY.
 *
 * `lib/events.ts` used to claim in prose that a kind "cannot be … accepted by
 * the server without a reader counting it". Nothing enforced it. The reader
 * matched the literal `rec_card_tap` and `PICK_KINDS`, so a kind added to the
 * allowlist would have been validated, stored, group-scoped — and tallied by
 * nobody. On the admin readout that is indistinguishable from a feature nobody
 * used, which is the most expensive way to be wrong about a product decision.
 *
 * This is the enforcement. It is BEHAVIOURAL rather than a source scan on
 * purpose: a scan can be satisfied by a kind that is merely *mentioned* in the
 * route, and would be defeated by any reformatting. Seeding one real event and
 * diffing the response body cannot be satisfied by anything except a reader
 * that actually counts.
 *
 * If you add a kind and this fails, the fix is a reader in
 * `app/api/admin/slice0/route.ts` — not an exemption here.
 */

const SINCE = '2026-06-13';
const URL_FIXTURES = `http://localhost/bpm/api/admin/slice0?since=${SINCE}`;

/** After the `?since=` cutoff, so the row is inside the measured window. */
const SESSION = 'session-2026-07-02';
const AT = '2026-07-02T10:00:00.000Z';

const ALL_KINDS = [...CLIENT_KINDS, ...SERVER_KINDS];

function seedEventRow(memberId: string, name: string, kind: string) {
  const store = getStore();
  if (!store['events']) store['events'] = [];
  store['events'].push({
    id: `ev-${store['events'].length}`,
    memberId,
    name,
    kind,
    at: AT,
    // Fields the pick tally and the source breakdown read. Harmless on the
    // kinds that declare neither — the reader ignores what it does not want.
    catalogId: 'racket-test-frame',
    engineVersion: 'fit-2',
    rating: 'up',
    category: 'racket',
    source: 'strip',
  });
}

async function readBody() {
  const res = await GET(makeGetRequest(URL_FIXTURES, true));
  expect(res.status).toBe(200);
  return res.json();
}

describe('every engagement kind is counted by a reader', () => {
  beforeEach(() => {
    resetMockStore();
    setupAdminPin();
    seedAdminMember();
    process.env.NEXT_PUBLIC_FLAG_VALUE_HUB_SLICE = 'true';
  });

  afterEach(() => {
    delete process.env.NEXT_PUBLIC_FLAG_VALUE_HUB_SLICE;
  });

  it('has at least one kind to check (guards against a vacuous pass)', () => {
    expect(ALL_KINDS.length).toBeGreaterThan(0);
  });

  it.each(ALL_KINDS)('kind %s changes the slice0 readout', async (kind) => {
    // The member must be BOTH on the roster (the skill block's denominator) and
    // an attendee since the cutoff (the rec-card block's). Seed both, or a kind
    // fails here for the wrong reason — because its subject was invisible to
    // the denominator, not because nothing counts it.
    const member = seedMember('Lin');
    seedPlayer(SESSION, 'Lin');

    const before = JSON.stringify(await readBody());

    seedEventRow(member.id, 'Lin', kind);
    const after = JSON.stringify(await readBody());

    expect(after).not.toBe(before);
  });
});
