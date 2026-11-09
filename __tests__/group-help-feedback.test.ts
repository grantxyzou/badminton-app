import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { NextRequest } from 'next/server';
import { getStore, memberCookieValue, resetMockStore, seedGroup, seedMember, seedMembership, setupAdminPin } from './helpers';
import { POST } from '@/app/api/help/feedback/route';

/**
 * "Was this helpful?" under a guide (spec §8): a plain form post that answers
 * with a 303 back to the guide, and one `guide_feedback` event for a signed-in
 * member, stamped with the club their cookie names.
 */
const FLAG = 'NEXT_PUBLIC_FLAG_MULTI_GROUP';
const before = process.env[FLAG];
let ip = 0;

function post(fields: Record<string, string>, cookie?: string) {
  const body = new URLSearchParams(fields).toString();
  return POST(
    new NextRequest('http://localhost/bpm/api/help/feedback', {
      method: 'POST',
      headers: {
        'Content-Type': 'application/x-www-form-urlencoded',
        'X-Client-IP': `10.66.0.${ip++ % 250}`,
        ...(cookie ? { Cookie: cookie } : {}),
      },
      body,
    }),
  );
}

const events = () => (getStore().events ?? []) as Record<string, unknown>[];

describe('POST /api/help/feedback', () => {
  let lin: { id: string };
  beforeEach(() => {
    resetMockStore();
    setupAdminPin(); // installs the session secret the test cookies are signed with
    process.env[FLAG] = 'true';
    seedGroup('bpm', { ownerMemberId: 'grant', name: 'BPM Core' });
    seedGroup('club-x', { ownerMemberId: 'owner-x', name: 'Six Feathers' });
    lin = seedMember('Lin');
    seedMembership('bpm', lin.id, { name: 'Lin' });
    seedMembership('club-x', lin.id, { name: 'Lin' });
  });
  afterEach(() => {
    if (before === undefined) delete process.env[FLAG];
    else process.env[FLAG] = before;
  });

  it('records the answer for a member, in the club their cookie names, and sends them back to the guide', async () => {
    const res = await post({ guide: 'paying', answer: 'yes' }, `member_session=${memberCookieValue('Lin', lin.id, undefined, 'club-x')}`);
    expect(res.status).toBe(303);
    expect(res.headers.get('location')).toMatch(/\/legal\/help\/paying\?helpful=yes#helpful$/);
    expect(events()).toHaveLength(1);
    expect(events()[0]).toMatchObject({ kind: 'guide_feedback', guide: 'paying', answer: 'yes', memberId: lin.id, groupId: 'club-x' });
  });

  it('thanks a signed-out reader too, and records nothing', async () => {
    const res = await post({ guide: 'stats', answer: 'no' });
    expect(res.status).toBe(303);
    expect(res.headers.get('location')).toMatch(/\/legal\/help\/stats\?helpful=no#helpful$/);
    expect(events()).toHaveLength(0);
  });

  it('a guide or answer it does not know goes back to the index and records nothing', async () => {
    const cookie = `member_session=${memberCookieValue('Lin', lin.id, undefined, 'bpm')}`;
    for (const fields of [{ guide: 'nope', answer: 'yes' }, { guide: 'paying', answer: 'maybe' }]) {
      const res = await post(fields, cookie);
      expect(res.status).toBe(303);
      expect(res.headers.get('location')).toMatch(/\/legal\/help$/);
    }
    expect(events()).toHaveLength(0);
  });
});
