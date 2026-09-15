import { describe, it, expect, beforeEach } from 'vitest';
import { GET as ME_GET, PATCH } from '../app/api/members/me/route';
import { GET as ROSTER_GET } from '../app/api/members/route';
import { resetMockStore, setupAdminPin, seedMember, makeRequest, makeGetRequest, memberCookieValue, getStore } from './helpers';
import { parseAvatar, normalizeAvatar, isRacketAvatarId, racketAvatarIds, DEFAULT_RACKET_ID, racketAvatarGround } from '../lib/memberAvatar';
import { RACKET_LOOKS } from '../lib/racketLook';
import { shuffleRacket } from '../components/profile/AvatarSheet';

const BASE = 'http://localhost:3000/api/members/me';
const RACKET = racketAvatarIds()[0];

const asMember = (cookieName: string, body: Record<string, unknown>) =>
  makeRequest('PATCH', BASE, body, { Cookie: `member_session=${memberCookieValue(cookieName)}` });
const stored = (name: string) =>
  getStore()['members'].find((m) => (m as { name: string }).name === name) as { avatar?: unknown };

describe('memberAvatar', () => {
  it('accepts a catalog racket or the default look, and nothing else', () => {
    expect(racketAvatarIds().length).toBeGreaterThan(100);
    expect(isRacketAvatarId(RACKET)).toBe(true);
    expect(isRacketAvatarId(DEFAULT_RACKET_ID)).toBe(true);
    expect(isRacketAvatarId('racket-made-up')).toBe(false);
    expect(isRacketAvatarId('__proto__')).toBe(false);
    expect(isRacketAvatarId('../../etc/passwd')).toBe(false);
  });

  it('parses null as "the initial", and malformed as undefined (a 400)', () => {
    expect(parseAvatar(null)).toBeNull();
    expect(parseAvatar({ kind: 'racket', racketId: RACKET })).toEqual({ kind: 'racket', racketId: RACKET });
    expect(parseAvatar({ kind: 'photo', url: 'https://evil.example/x.png' })).toBeUndefined();
    expect(parseAvatar({ kind: 'racket', racketId: 'nope' })).toBeUndefined();
    expect(parseAvatar('racket')).toBeUndefined();
  });

  it('reads a stored value that no longer validates as the initial', () => {
    expect(normalizeAvatar({ kind: 'racket', racketId: 'retired-racket' })).toBeNull();
    expect(normalizeAvatar(undefined)).toBeNull();
  });

  it('puts a light ground behind a dark frame and a dark ground behind a light one', () => {
    const ids = Object.keys(RACKET_LOOKS);
    const dark = ids.find((id) => RACKET_LOOKS[id].frame === '#111111')!;
    const light = ids.find((id) => /^#(e|f)/i.test(RACKET_LOOKS[id].frame))!;
    expect(dark && light).toBeTruthy();
    expect(racketAvatarGround(dark)).not.toBe(racketAvatarGround(light));
    // The default look is graphite, so it gets the light ground.
    expect(racketAvatarGround(DEFAULT_RACKET_ID)).toBe(racketAvatarGround(dark));
  });

  it('shuffle never lands on the racket already showing', () => {
    for (let i = 0; i < 50; i++) expect(shuffleRacket(RACKET)).not.toBe(RACKET);
    expect(isRacketAvatarId(shuffleRacket(null))).toBe(true);
  });
});

describe('PATCH /api/members/me — avatar', () => {
  beforeEach(() => {
    resetMockStore();
    setupAdminPin();
  });

  it('rejects an anonymous write — names are enumerable', async () => {
    seedMember('Lin');
    const res = await PATCH(makeRequest('PATCH', BASE, { name: 'Lin', avatar: { kind: 'racket', racketId: RACKET } }));
    expect(res.status).toBe(401);
    expect(stored('Lin').avatar).toBeUndefined();
  });

  it('rejects a cookie belonging to a different member', async () => {
    seedMember('Lin');
    seedMember('Viktor');
    const res = await PATCH(asMember('Viktor', { name: 'Lin', avatar: { kind: 'racket', racketId: RACKET } }));
    expect(res.status).toBe(401);
    expect(stored('Lin').avatar).toBeUndefined();
  });

  it('saves the member\'s own pick, and null takes it back to the initial', async () => {
    seedMember('Lin');
    const set = await PATCH(asMember('Lin', { name: 'Lin', avatar: { kind: 'racket', racketId: RACKET } }));
    expect(set.status).toBe(200);
    expect(stored('Lin').avatar).toEqual({ kind: 'racket', racketId: RACKET });

    const cleared = await PATCH(asMember('Lin', { name: 'Lin', avatar: null }));
    expect(cleared.status).toBe(200);
    expect(stored('Lin').avatar).toBeUndefined();
  });

  it('refuses a racket that is not in the catalog', async () => {
    seedMember('Lin');
    const res = await PATCH(asMember('Lin', { name: 'Lin', avatar: { kind: 'racket', racketId: 'racket-made-up' } }));
    expect(res.status).toBe(400);
    expect(stored('Lin').avatar).toBeUndefined();
  });
});

describe('reading avatars back', () => {
  beforeEach(() => {
    resetMockStore();
    setupAdminPin();
  });

  it('the roster carries each member\'s picture beside their name', async () => {
    seedMember('Lin', { avatar: { kind: 'racket', racketId: RACKET } });
    seedMember('Viktor');
    const rows = (await (await ROSTER_GET(makeGetRequest('http://localhost:3000/api/members'))).json()) as Array<{ name: string; avatar: unknown }>;
    expect(rows.find((r) => r.name === 'Lin')?.avatar).toEqual({ kind: 'racket', racketId: RACKET });
    expect(rows.find((r) => r.name === 'Viktor')?.avatar).toBeNull();
  });

  it('members/me returns it', async () => {
    seedMember('Lin', { avatar: { kind: 'racket', racketId: RACKET } });
    const data = await (await ME_GET(makeGetRequest(`${BASE}?name=Lin`))).json();
    expect(data.avatar).toEqual({ kind: 'racket', racketId: RACKET });
  });
});
