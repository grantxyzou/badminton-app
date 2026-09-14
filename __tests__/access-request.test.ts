import { describe, it, expect, beforeEach } from 'vitest';
import { POST as REQUEST } from '../app/api/members/access-request/route';
import { POST as CLAIM } from '../app/api/members/access-request/claim/route';
import { GET as LIST, POST as DECIDE } from '../app/api/admin/access-requests/route';
import {
  resetMockStore,
  getStore,
  seedMember,
  setupAdminPin,
  seedTestAdminMember,
  makeRequest,
  makeAdminRequest,
} from './helpers';
import type { Member } from '../lib/types';
import { issueAccessRequest, LEGACY_ID, MAX_OPEN_REQUESTS } from '../lib/accessRequest';

/**
 * "I can't sign in — let me in."
 *
 * The security of this rests on ONE idea: approval is blind, so it must not be
 * possible for approval to admit anybody other than the person who asked. The
 * device-binding tests below are that idea; everything else is plumbing.
 */
const req = (body: Record<string, unknown>) =>
  makeRequest('POST', 'http://x/api/members/access-request', body);

const stored = (name: string) =>
  (getStore()['members'] as Member[]).find((m) => m.name === name)!;

interface Row { memberId: string; name: string; count: number; requestId: string | null }

async function listed(name: string): Promise<Row | undefined> {
  const body = await (await LIST(makeAdminRequest('GET', 'http://x/admin'))).json();
  return (body.requests as Row[]).find((r) => r.name === name);
}

/** What the admin's "Let them in" button sends: the row's own request id. */
async function approve(name: string) {
  const row = await listed(name);
  return DECIDE(makeAdminRequest('POST', 'http://x/admin', {
    memberId: row?.memberId, requestId: row?.requestId, decision: 'approve',
  }));
}

async function decline(name: string) {
  const row = await listed(name);
  return DECIDE(makeAdminRequest('POST', 'http://x/admin', { memberId: row?.memberId, decision: 'decline' }));
}

const claim = async (name: string, secret: string) =>
  CLAIM(makeRequest('POST', 'http://x/claim', { name, secret }));

beforeEach(async () => {
  resetMockStore();
  setupAdminPin();
  await seedTestAdminMember();
});

describe('asking to be let in', () => {
  it('records a request and hands the secret to the asking device only', async () => {
    seedMember('Lin');
    const res = await REQUEST(req({ name: 'Lin' }));
    expect(res.status).toBe(200);
    const body = await res.json();
    expect(typeof body.secret).toBe('string');

    // Stored HASHED. The secret itself never touches the database.
    const rec = stored('Lin').accessRequests![0];
    expect(rec.hash).not.toBe(body.secret);
    expect(rec.approvedAt).toBeUndefined();
  });

  it('answers identically for a name that does not exist', async () => {
    // Names are enumerable via GET /api/members, so a "no such member" here
    // would turn that list into a membership oracle.
    const real = await REQUEST(req({ name: 'Lin' }));
    const fake = await REQUEST(req({ name: 'Nobody At All' }));
    expect(fake.status).toBe(real.status);
    expect(Object.keys(await fake.json()).sort()).toEqual(
      Object.keys(await real.json()).sort(),
    );
  });
});

describe('approval cannot let in anyone but the asker', () => {
  it('refuses a claim before an admin approves', async () => {
    seedMember('Lin');
    const { secret } = await (await REQUEST(req({ name: 'Lin' }))).json();

    const res = await CLAIM(
      makeRequest('POST', 'http://x/claim', { name: 'Lin', secret }),
    );
    expect((await res.json()).status).toBe('pending');
  });

  it('signs in the asking device once approved', async () => {
    seedMember('Lin');
    const { secret } = await (await REQUEST(req({ name: 'Lin' }))).json();
    await approve('Lin');

    const res = await CLAIM(makeRequest('POST', 'http://x/claim', { name: 'Lin', secret }));
    const body = await res.json();
    expect(body.status).toBe('approved');
    expect(body.name).toBe('Lin');
    expect(res.headers.get('set-cookie')).toContain('member_session');
  });

  it('REFUSES a different device holding a different secret', async () => {
    // The whole point. Approval is by NAME and blind, so without the secret a
    // one-tap approve would admit whoever asked next rather than the person
    // who asked.
    seedMember('Lin');
    await REQUEST(req({ name: 'Lin' }));
    await approve('Lin');

    const res = await CLAIM(
      makeRequest('POST', 'http://x/claim', { name: 'Lin', secret: 'f'.repeat(64) }),
    );
    expect((await res.json()).status).not.toBe('approved');
    expect(res.headers.get('set-cookie') ?? '').not.toContain('member_session');
  });

  it('is single use — a replayed secret finds nothing', async () => {
    seedMember('Lin');
    const { secret } = await (await REQUEST(req({ name: 'Lin' }))).json();
    await approve('Lin');

    const first = await CLAIM(makeRequest('POST', 'http://x/claim', { name: 'Lin', secret }));
    expect((await first.json()).status).toBe('approved');

    const replay = await CLAIM(makeRequest('POST', 'http://x/claim', { name: 'Lin', secret }));
    expect((await replay.json()).status).not.toBe('approved');
  });

  it('tells the client whether to offer a PIN afterwards', async () => {
    // Someone who never had one should be asked if they want one; someone who
    // forgot theirs already knows what a PIN is.
    seedMember('Lin');
    const { secret } = await (await REQUEST(req({ name: 'Lin' }))).json();
    await approve('Lin');
    const body = await (await CLAIM(makeRequest('POST', 'http://x/claim', { name: 'Lin', secret }))).json();
    expect(body.hasPin).toBe(false);
  });
});

describe('the admin side', () => {
  it('lists who is waiting, and needs admin', async () => {
    seedMember('Lin');
    await REQUEST(req({ name: 'Lin' }));

    const anon = await LIST(makeRequest('GET', 'http://x/admin'));
    expect(anon.status).toBe(401);

    const res = await LIST(makeAdminRequest('GET', 'http://x/admin'));
    const body = await res.json();
    expect(body.requests.map((r: { name: string }) => r.name)).toEqual(['Lin']);
  });

  it('declining removes the request rather than recording a refusal', async () => {
    seedMember('Lin');
    const { secret } = await (await REQUEST(req({ name: 'Lin' }))).json();
    await decline('Lin');

    expect(stored('Lin').accessRequests).toEqual([]);
    const res = await CLAIM(makeRequest('POST', 'http://x/claim', { name: 'Lin', secret }));
    expect((await res.json()).status).toBe('none');
  });

  it('drops off the list once approved', async () => {
    seedMember('Lin');
    await REQUEST(req({ name: 'Lin' }));
    await approve('Lin');
    const body = await (await LIST(makeAdminRequest('GET', 'http://x/admin'))).json();
    expect(body.requests).toHaveLength(0);
  });
});

/**
 * Security finding F2 — the request was bound to a NAME.
 *
 * Every test above writes ONE request per name, which is why none of them could
 * see this. With a single `accessRequest`, overwriting gave the approval to
 * whoever asked last; "first ask wins" gave it to whoever asked first. Either
 * way a stranger who knows the name could be let in as Lin. Both orderings are
 * pinned here, because each fix was the other's hole.
 */
describe('a stranger asking under the same name cannot be let in (F2)', () => {
  it('stranger asks FIRST: Lin’s request is still stored, and nothing can be approved blind', async () => {
    seedMember('Lin');
    const stranger = await (await REQUEST(req({ name: 'Lin' }))).json();
    const lin = await (await REQUEST(req({ name: 'Lin' }))).json();

    // Both requests stand. "First ask wins" silently dropped Lin's.
    expect(stored('Lin').accessRequests).toHaveLength(2);

    // The admin is told two devices asked, and there is no request to approve.
    const row = await listed('Lin');
    expect(row?.count).toBe(2);
    expect(row?.requestId).toBeNull();

    // Neither device can guess its way to an approval by id either.
    for (const r of stored('Lin').accessRequests!) {
      const res = await DECIDE(makeAdminRequest('POST', 'http://x/admin', {
        memberId: row!.memberId, requestId: r.id, decision: 'approve',
      }));
      expect(res.status).toBe(409);
    }
    expect((await (await claim('Lin', stranger.secret)).json()).status).not.toBe('approved');
    expect((await (await claim('Lin', lin.secret)).json()).status).not.toBe('approved');

    // Clearing is the one action, and Lin asking again then works.
    expect((await decline('Lin')).status).toBe(200);
    const again = await (await REQUEST(req({ name: 'Lin' }))).json();
    expect((await approve('Lin')).status).toBe(200);
    const res = await claim('Lin', again.secret);
    expect((await res.json()).status).toBe('approved');
    expect(res.headers.get('set-cookie')).toContain('member_session');
  });

  it('stranger asks AFTER approval, before Lin collects: only Lin gets in, and the stranger’s ask is burned', async () => {
    seedMember('Lin');
    const lin = await (await REQUEST(req({ name: 'Lin' }))).json();
    expect((await approve('Lin')).status).toBe(200);

    const stranger = await (await REQUEST(req({ name: 'Lin' }))).json();
    // A second ask must not read as a fresh single request to approve.
    const row = await listed('Lin');
    expect(row?.count).toBe(2);
    expect(row?.requestId).toBeNull();

    const stolen = await claim('Lin', stranger.secret);
    expect((await stolen.json()).status).not.toBe('approved');
    expect(stolen.headers.get('set-cookie') ?? '').not.toContain('member_session');

    expect((await (await claim('Lin', lin.secret)).json()).status).toBe('approved');
    // Once Lin is in, the stranger's request is gone rather than left on the
    // admin's list to be approved by mistake.
    expect(stored('Lin').accessRequests).toEqual([]);
    expect(await listed('Lin')).toBeUndefined();
  });

  it('approval is by request id, re-checked at write time', async () => {
    seedMember('Lin');
    await REQUEST(req({ name: 'Lin' }));
    const row = (await listed('Lin'))!;
    await REQUEST(req({ name: 'Lin' })); // lands after the admin loaded the list

    const res = await DECIDE(makeAdminRequest('POST', 'http://x/admin', {
      memberId: row.memberId, requestId: row.requestId, decision: 'approve',
    }));
    expect(res.status).toBe(409);
    expect(stored('Lin').accessRequests!.every((r) => r.approvedAt === undefined)).toBe(true);
  });

  it('still answers a second asker identically, so nothing leaks', async () => {
    seedMember('Lin');
    const first = await REQUEST(req({ name: 'Lin' }));
    const second = await REQUEST(req({ name: 'Lin' }));
    expect(second.status).toBe(first.status);
    expect(Object.keys(await second.json()).sort()).toEqual(
      Object.keys(await first.json()).sort(),
    );
  });

  it('a made-up secret cannot learn that someone is asking as Lin', async () => {
    seedMember('Lin');
    const lin = await (await REQUEST(req({ name: 'Lin' }))).json();
    expect((await (await claim('Lin', 'b'.repeat(64))).json()).status).toBe('none');
    expect((await (await claim('Lin', lin.secret)).json()).status).toBe('pending');
  });

  it('never returns the stored hash to the admin', async () => {
    seedMember('Lin');
    await REQUEST(req({ name: 'Lin' }));
    const raw = JSON.stringify(await (await LIST(makeAdminRequest('GET', 'http://x/admin'))).json());
    expect(raw).not.toContain(stored('Lin').accessRequests![0].hash);
  });

  it('stops storing past the cap instead of displacing anyone', async () => {
    seedMember('Lin');
    const secrets: string[] = [];
    for (let i = 0; i < MAX_OPEN_REQUESTS + 2; i++) {
      const res = await REQUEST(
        makeRequest('POST', 'http://x/api/members/access-request', { name: 'Lin' }, { 'X-Client-IP': `cap-${i}` }),
      );
      expect(res.status).toBe(200);
      secrets.push((await res.json()).secret);
    }
    expect(stored('Lin').accessRequests).toHaveLength(MAX_OPEN_REQUESTS);
    // The first asker is still there.
    expect((await (await claim('Lin', secrets[0])).json()).status).toBe('pending');
  });
});

describe('a request stored before one-per-device', () => {
  it('still lists, approves and claims, and is promoted to the list on write', async () => {
    const { secret, stored: legacy } = issueAccessRequest();
    const { id: _id, ...noId } = legacy;
    seedMember('Lin', { accessRequest: noId });

    const row = await listed('Lin');
    expect(row?.requestId).toBe(LEGACY_ID);
    expect((await approve('Lin')).status).toBe(200);
    expect(stored('Lin').accessRequest).toBeUndefined();
    expect((await (await claim('Lin', secret)).json()).status).toBe('approved');
  });
});

describe('the claim route does not say whether a name exists', () => {
  it('answers the same for an unknown name and a real one with no request', async () => {
    seedMember('Lin'); // real, but has not asked for anything
    const real = await CLAIM(
      makeRequest('POST', 'http://x/claim', { name: 'Lin', secret: 'a'.repeat(64) }),
    );
    const fake = await CLAIM(
      makeRequest('POST', 'http://x/claim', { name: 'Nobody At All', secret: 'a'.repeat(64) }),
    );
    expect((await real.json()).status).toBe((await fake.json()).status);
  });
});

describe('the push goes to admins only', () => {
  it('does not treat every active member as an admin under the mock store', async () => {
    // The query binds no parameters, so the mock ignores `c.role = 'admin'`
    // entirely and hands back every active row. Without a JS re-filter, one
    // person's lockout would be announced to the whole club.
    seedMember('Lin');
    seedMember('Viktor');
    const res = await REQUEST(req({ name: 'Lin' }));
    expect(res.status).toBe(200);
    // The route must not throw or fan out; the assertion that matters is that
    // the filter exists at all, pinned in source next to the hazard it guards.
    const src = await import('node:fs').then((fs) =>
      fs.readFileSync('app/api/members/access-request/route.ts', 'utf8'),
    );
    expect(src).toMatch(/filter\(\(a\) => a\.role === 'admin'/);
  });
});
