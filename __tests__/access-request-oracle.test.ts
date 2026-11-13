import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';

vi.mock('@/lib/push', () => ({ sendPushToMembers: vi.fn() }));
import { POST as REQUEST } from '../app/api/members/access-request/route';
import { POST as CLAIM } from '../app/api/members/access-request/claim/route';
import { GET as LIST, POST as DECIDE } from '../app/api/admin/access-requests/route';
import { resetMockStore, seedMember, setupAdminPin, seedTestAdminMember, makeRequest, makeAdminRequest } from './helpers';
import { openAskSecret, sealAskSecret } from '../lib/askSecret';

/**
 * "I play here already" says nothing about which names exist
 * (docs/plans/one-way-in.md, step 4c).
 *
 * The ask always answered 200 with a secret, but only a known name was STORED,
 * and the poll read the store: `pending` for Lin, `none` for a made-up name.
 * One ask and one poll told a stranger who is on the club's list. Every secret
 * is sealed with its hour now, and the poll answers by the seal.
 */
let n = 0;
const ip = () => ({ 'X-Client-IP': `10.43.0.${(n += 1)}` });
const ask = async (name: string) =>
  (await (await REQUEST(makeRequest('POST', 'http://x/api/members/access-request', { name }, ip()))).json()) as { ok: boolean; secret: string };
const poll = (name: string, secret: string) => CLAIM(makeRequest('POST', 'http://x/claim', { name, secret }, ip()));

beforeEach(async () => {
  resetMockStore();
  setupAdminPin();
  await seedTestAdminMember();
  seedMember('Lin');
});
afterEach(() => vi.useRealTimers());

describe('the poll is no name test', () => {
  it('a known name and a made-up one read exactly the same, ask and poll', async () => {
    const known = await ask('Lin');
    const made = await ask('Nobody Here');
    expect(Object.keys(known)).toEqual(Object.keys(made));
    expect(known.secret.length).toBe(made.secret.length);
    const [a, b] = await Promise.all([poll('Lin', known.secret), poll('Nobody Here', made.secret)]);
    expect(a.status).toBe(b.status);
    expect(await a.json()).toEqual({ status: 'pending' });
    expect(await b.json()).toEqual({ status: 'pending' });
  });

  it('a seal is not a credential: only the stored, approved ask signs anyone in', async () => {
    const stranger = await ask('Nobody Here');
    const lin = await ask('Lin');
    const list = await (await LIST(makeAdminRequest('GET', 'http://x/admin'))).json();
    const row = list.requests.find((r: { name: string }) => r.name === 'Lin');
    expect((await DECIDE(makeAdminRequest('POST', 'http://x/admin', { memberId: row.memberId, requestId: row.requestId, decision: 'approve' }))).status).toBe(200);

    // The stranger's seal, polled under Lin's name, is still just waiting.
    const theirs = await poll('Lin', stranger.secret);
    expect(await theirs.json()).toEqual({ status: 'pending' });
    expect(theirs.headers.get('set-cookie')).toBeNull();
    const hers = await poll('Lin', lin.secret);
    expect(await hers.json()).toMatchObject({ status: 'approved', name: 'Lin' });
  });

  it('after the hour both read `none`, the same again', async () => {
    const known = await ask('Lin');
    const made = await ask('Nobody Here');
    vi.useFakeTimers({ toFake: ['Date'] });
    vi.setSystemTime(Date.now() + 61 * 60 * 1000);
    expect(await (await poll('Lin', known.secret)).json()).toEqual({ status: 'none' });
    expect(await (await poll('Nobody Here', made.secret)).json()).toEqual({ status: 'none' });
  });

  it('a forged or tampered seal is `none`', async () => {
    const { secret } = await ask('Nobody Here');
    const [body, sig] = secret.split('.');
    expect(await (await poll('Nobody Here', `${body}.${sig.slice(0, -2)}AA`)).json()).toEqual({ status: 'none' });
    expect(await (await poll('Nobody Here', 'not-a-seal')).json()).toEqual({ status: 'none' });
  });

  it('the seal carries the secret; only its hash is stored', () => {
    const sealed = sealAskSecret('ab'.repeat(32));
    expect(openAskSecret(sealed)).toEqual({ kind: 'sealed', raw: 'ab'.repeat(32) });
    // A bare secret from before the seal still reads the store.
    expect(openAskSecret('cd'.repeat(32))).toEqual({ kind: 'legacy', raw: 'cd'.repeat(32) });
  });
});
