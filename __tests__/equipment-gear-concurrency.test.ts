import { describe, it, expect, beforeEach } from 'vitest';
import { POST, DELETE, GET } from '../app/api/equipment/gear/route';
import {
  resetMockStore, seedMember, memberCookieValue, makeRequest, makeGetRequest, setupAdminPin, getStore,
} from './helpers';
import { getContainer } from '../lib/cosmos';
import type { PlayerGear } from '../lib/types';

/**
 * Lost update on the gear document.
 *
 * Every verb on this route is a read-modify-write of the WHOLE doc, and the
 * write used to be an unconditional `items.upsert`. Two overlapping writers
 * each computed `items` from the same snapshot and the slower one clobbered
 * the faster: DELETE reads [X, Y] and commits [Y]; an overlapping PUT reads
 * [X, Y], commits [X, Y'] a moment later and wins — X is back in the database
 * while the client shows it gone until the next mount.
 *
 * Not a hypothetical across devices: bpm-stable and bpm-next share one Cosmos
 * account and favour different verbs (stable saves via PUT, next via POST).
 *
 * These run the handlers CONCURRENTLY rather than asserting on a mocked etag,
 * because the interleave at the real `await` boundaries is the thing under
 * test. A happy-path test would pass against the broken version.
 */

const NAME = 'Lin';
const MEMBER_ID = 'member-lin';

function authed(method: string, url: string, body?: Record<string, unknown>) {
  return makeRequest(method, url, body, {
    Cookie: `member_session=${memberCookieValue(NAME, MEMBER_ID)}`,
  });
}

const URL_BASE = 'http://localhost/api/equipment/gear';

async function readGear(): Promise<PlayerGear | null> {
  const res = await GET(makeGetRequest(`${URL_BASE}?name=${NAME}`));
  return (await res.json()).gear;
}

beforeEach(() => {
  resetMockStore();
  setupAdminPin();
  seedMember(NAME, { id: MEMBER_ID });
  process.env.NEXT_PUBLIC_FLAG_VALUE_HUB_SLICE = 'true';
});

describe('gear document — concurrent writers must not lose an update', () => {
  /**
   * The reported scenario, made deterministic.
   *
   * A `Promise.all` of DELETE and PUT does NOT reproduce it: every mock store
   * operation resolves as a microtask, so the two handlers serialize and such
   * a test passes against the broken code — the happy-path trap.
   *
   * SCOPE, stated honestly: the final commit here goes through the container
   * directly, so this pins the *guard's* behaviour (a pre-DELETE snapshot is
   * refused, and DELETE's effect survives) rather than proving the route
   * interleaved. What proves the ROUTE is guarded are the two concurrent-add
   * cases below — those drive the handlers end-to-end and both failed against
   * the unconditional upsert.
   */
  it('a writer holding a pre-DELETE snapshot cannot resurrect the racket', async () => {
    await POST(authed('POST', URL_BASE, {
      name: NAME,
      item: { catalogId: 'cat-x', category: 'racket', label: 'Racket X' },
    }));
    await POST(authed('POST', URL_BASE, {
      name: NAME,
      item: { catalogId: 'cat-y', category: 'racket', label: 'Racket Y' },
    }));

    const container = getContainer('playerGear');
    // Writer B reads [X, Y] and holds it, mid-computation.
    const { resource: snapshot } = await container.item(`gear-${MEMBER_ID}`, MEMBER_ID).read();
    const staleDoc = snapshot as PlayerGear & { _etag: string };
    const x = staleDoc.items.find((i) => i.catalogId === 'cat-x')!;

    // Writer A deletes X and commits.
    const delRes = await DELETE(authed('DELETE', `${URL_BASE}?name=${NAME}&itemId=${x.id}`));
    expect(delRes.status).toBe(200);
    expect((await readGear())!.items.map((i) => i.catalogId)).toEqual(['cat-y']);

    // Writer B now commits its stale [X, Y]. Unguarded this wrote X back and
    // won; guarded it is refused, and the caller re-reads instead.
    await expect(
      container.items.upsert(
        { ...staleDoc, items: staleDoc.items },
        { accessCondition: { type: 'IfMatch', condition: staleDoc._etag } },
      ),
    ).rejects.toMatchObject({ code: 412 });

    expect((await readGear())!.items.map((i) => i.catalogId)).toEqual(['cat-y']);
  });

  it('two concurrent adds both land — neither is clobbered', async () => {
    const [a, b] = await Promise.all([
      POST(authed('POST', URL_BASE, {
        name: NAME,
        item: { catalogId: 'cat-a', category: 'racket', label: 'Racket A' },
      })),
      POST(authed('POST', URL_BASE, {
        name: NAME,
        item: { catalogId: 'cat-b', category: 'racket', label: 'Racket B' },
      })),
    ]);

    expect([a.status, b.status].sort()).toEqual([200, 200]);
    const after = await readGear();
    expect(after!.items.map((i) => i.catalogId).sort()).toEqual(['cat-a', 'cat-b']);
  });

  // The retry re-runs each verb's validation, not just its write. After losing
  // a race the answer may legitimately have changed — here the racket the
  // second caller wanted to add already exists, so it must 409 rather than
  // commit a decision made against a document that no longer exists.
  it('re-runs validation after a losing race, not just the write', async () => {
    const item = { catalogId: 'cat-dup', category: 'racket', label: 'Same Racket' };
    const [first, second] = await Promise.all([
      POST(authed('POST', URL_BASE, { name: NAME, item })),
      POST(authed('POST', URL_BASE, { name: NAME, item })),
    ]);

    const codes = [first.status, second.status].sort();
    expect(codes).toEqual([200, 409]);
    const after = await readGear();
    expect(after!.items).toHaveLength(1);
  });
});

describe('mock store — etag contract the retry depends on', () => {
  it('rejects an upsert carrying a stale etag', async () => {
    const container = getContainer('playerGear');
    const { resource: created } = await container.items.upsert({ id: 'g1', memberId: 'm1', items: [] });
    const staleEtag = (created as { _etag: string })._etag;

    // A second writer moves the document forward.
    await container.items.upsert({ id: 'g1', memberId: 'm1', items: ['moved'] });

    await expect(
      container.items.upsert(
        { id: 'g1', memberId: 'm1', items: ['stale'] },
        { accessCondition: { type: 'IfMatch', condition: staleEtag } },
      ),
    ).rejects.toMatchObject({ code: 412 });
  });

  it('accepts an upsert carrying the current etag', async () => {
    const container = getContainer('playerGear');
    const { resource: created } = await container.items.upsert({ id: 'g2', memberId: 'm2', items: [] });
    const etag = (created as { _etag: string })._etag;

    const { resource: updated } = await container.items.upsert(
      { id: 'g2', memberId: 'm2', items: ['ok'] },
      { accessCondition: { type: 'IfMatch', condition: etag } },
    );
    expect((updated as unknown as { items: string[] }).items).toEqual(['ok']);
    // A fresh etag every write, or the next writer's guard is meaningless.
    expect((updated as unknown as { _etag: string })._etag).not.toBe(etag);
  });
});

/**
 * A prior document that carries NO concurrency token.
 *
 * `writeGearDoc` chose its verb on `prior?._etag`, which conflates two very
 * different states: "there is no document yet" (create is correct) and "there
 * is a document but it arrived without an etag" (create is the one verb that
 * can NEVER succeed — the id is already taken). The second state routed to
 * `create`, whose 409 `commitGearDoc` reads as a retry signal, so it burned
 * all three attempts against a condition that cannot change and answered
 * `save_conflict`. Every write to that document failed forever.
 *
 * Reproduced end-to-end in the dev mock store, whose `fresh-thursday` seed
 * pushes six gear docs straight into the array with no `_etag`: tapping any
 * racket in the sheet returned 409 and painted the generic error pill. Real
 * Cosmos always stamps `_etag`, so the seed is fixed too — but the branch is
 * wrong on its own terms, and this is the test that says so.
 */
describe('gear document — a prior with no etag is still an update', () => {
  it('never routes an existing document to create, and never lies that it is contention', async () => {
    // Straight into the store, bypassing `create` — exactly how a seed or a
    // fixture (and only a seed or a fixture) can produce an etag-less doc.
    getStore()['playerGear'] = [{
      id: `gear-${MEMBER_ID}`,
      memberId: MEMBER_ID,
      items: [{ id: 'existing', catalogId: null, category: 'racket', label: 'Astrox 88D Pro' }],
      activeRacketId: 'existing',
    }];

    const res = await POST(authed('POST', URL_BASE, {
      name: NAME,
      item: { catalogId: 'racket-yx-ax99pro', category: 'racket', label: 'Yonex Astrox 99 Pro' },
    }));

    // The assertion that matters is the NEGATIVE one. 409 `save_conflict` is
    // the answer the old branch gave, and it is a lie twice over: nothing was
    // contended, and its own contract invites a client retry that can never
    // succeed. An honest 500 says the write is broken.
    const body = await res.json();
    expect(body.error).not.toBe('save_conflict');
    expect(res.status).toBe(500);
    expect(body.error).toBe('save_failed');
  });

  it('the fresh-thursday dev seed writes gear documents that carry a token', async () => {
    // The seed is the only producer of etag-less documents, and it produced
    // six of them — one per fixture member — so in local dev NOBODY could add
    // a racket or a string. Pins the seed itself, not just the route's
    // tolerance of it.
    resetMockStore();
    const g = global as typeof globalThis & { _devScenarioSeeded?: boolean };
    const wasSeeded = g._devScenarioSeeded;
    g._devScenarioSeeded = false;
    process.env.SEED_DEV_SCENARIO = 'fresh-thursday';
    try {
      // The seed fires on first access to `sessions` or `members` only — it
      // populates every container in one pass, gear included.
      getContainer('members');
      const seeded = getStore()['playerGear'] as { _etag?: string }[];
      expect(seeded.length).toBeGreaterThan(0);
      for (const doc of seeded) expect(doc._etag).toBeTruthy();
    } finally {
      delete process.env.SEED_DEV_SCENARIO;
      g._devScenarioSeeded = wasSeeded;
    }
  });
});
