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
