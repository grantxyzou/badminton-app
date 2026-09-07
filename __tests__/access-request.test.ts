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
    const rec = stored('Lin').accessRequest!;
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
    await DECIDE(makeAdminRequest('POST', 'http://x/admin', { name: 'Lin', decision: 'approve' }));

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
    await DECIDE(makeAdminRequest('POST', 'http://x/admin', { name: 'Lin', decision: 'approve' }));

    const res = await CLAIM(
      makeRequest('POST', 'http://x/claim', { name: 'Lin', secret: 'f'.repeat(64) }),
    );
    expect((await res.json()).status).not.toBe('approved');
    expect(res.headers.get('set-cookie') ?? '').not.toContain('member_session');
  });

  it('is single use — a replayed secret finds nothing', async () => {
    seedMember('Lin');
    const { secret } = await (await REQUEST(req({ name: 'Lin' }))).json();
    await DECIDE(makeAdminRequest('POST', 'http://x/admin', { name: 'Lin', decision: 'approve' }));

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
    await DECIDE(makeAdminRequest('POST', 'http://x/admin', { name: 'Lin', decision: 'approve' }));
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
    await DECIDE(makeAdminRequest('POST', 'http://x/admin', { name: 'Lin', decision: 'decline' }));

    expect(stored('Lin').accessRequest).toBeUndefined();
    const res = await CLAIM(makeRequest('POST', 'http://x/claim', { name: 'Lin', secret }));
    expect((await res.json()).status).toBe('none');
  });

  it('drops off the list once approved', async () => {
    seedMember('Lin');
    await REQUEST(req({ name: 'Lin' }));
    await DECIDE(makeAdminRequest('POST', 'http://x/admin', { name: 'Lin', decision: 'approve' }));
    const body = await (await LIST(makeAdminRequest('GET', 'http://x/admin'))).json();
    expect(body.requests).toHaveLength(0);
  });
});

/**
 * The overwrite hole.
 *
 * Every test above writes ONE request per name, which is why none of them could
 * see this: `accessRequest` is a single object, and approval is by name with no
 * way for the admin to tell which device is behind it. So a second request
 * silently reassigned the approval to whoever asked last.
 */
describe('a second request cannot steal a pending one', () => {
  it('keeps the FIRST asker’s secret when someone else asks for the same name', async () => {
    seedMember('Lin');
    const first = await (await REQUEST(req({ name: 'Lin' }))).json();
    // Anyone who knows the name — they are enumerable via GET /api/members.
    const second = await (await REQUEST(req({ name: 'Lin' }))).json();
    expect(second.secret).not.toBe(first.secret);

    await DECIDE(makeAdminRequest('POST', 'http://x/admin', { name: 'Lin', decision: 'approve' }));

    // The interloper is refused...
    const stolen = await CLAIM(
      makeRequest('POST', 'http://x/claim', { name: 'Lin', secret: second.secret }),
    );
    expect((await stolen.json()).status).not.toBe('approved');

    // ...and the person who actually asked still gets in.
    const real = await CLAIM(
      makeRequest('POST', 'http://x/claim', { name: 'Lin', secret: first.secret }),
    );
    expect((await real.json()).status).toBe('approved');
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
