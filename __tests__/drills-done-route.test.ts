import { describe, it, expect, beforeEach, afterAll } from 'vitest';
import { POST } from '../app/api/stats/drills/done/route';
import { GET } from '../app/api/stats/drills/route';
import {
  resetMockStore,
  setupAdminPin,
  seedMember,
  seedPointer,
  makeRequest,
  memberCookieValue,
  getStore,
} from './helpers';
import { drillDocId, readDone } from '../lib/drillsDone';

const URL = 'http://localhost:3000/api/stats/drills/done';

function postAs(name: string, body: Record<string, unknown>) {
  return makeRequest('POST', URL, body, {
    Cookie: `member_session=${memberCookieValue(name)}`,
  });
}

function docFor(memberId: string, weekKey: string) {
  return (getStore()['drillCompletions'] ?? []).find(
    (d) => (d as { id: string }).id === drillDocId(memberId, weekKey),
  ) as { done: string[] } | undefined;
}

describe('lib/drillsDone', () => {
  it('reads a missing doc as nothing done', () => {
    expect(readDone(null)).toEqual([]);
    expect(readDone(undefined)).toEqual([]);
  });

  it('tolerates a doc with a missing or junk array', () => {
    expect(readDone({ done: undefined } as never)).toEqual([]);
    expect(readDone({ done: ['a', 1, '', null, 'b'] } as never)).toEqual(['a', 'b']);
  });

  it('keys one doc per member-week', () => {
    expect(drillDocId('m1', 'session-2026-08-20')).toBe('m1:session-2026-08-20');
  });
});

describe('POST /api/stats/drills/done', () => {
  beforeEach(() => {
    resetMockStore();
    setupAdminPin();
    seedPointer('session-2026-08-20');
  });
  afterAll(() => {
  });

  // ── The writer is the cookie, never a name in the body ──────────────────
  it('401s without a member cookie', async () => {
    seedMember('Lin', { id: 'member-lin' });
    const res = await POST(makeRequest('POST', URL, { drillId: 'd1', done: true }));
    expect(res.status).toBe(401);
  });

  it('ignores any name in the body — the cookie decides whose drill it is', async () => {
    seedMember('Lin', { id: 'member-lin' });
    seedMember('Viktor', { id: 'member-viktor' });
    // Lin's cookie, Viktor's name in the body. The write must land on Lin.
    const res = await POST(postAs('Lin', { drillId: 'd1', done: true, name: 'Viktor' }));
    expect(res.status).toBe(200);
    expect(docFor('member-lin', 'session-2026-08-20')?.done).toEqual(['d1']);
    expect(docFor('member-viktor', 'session-2026-08-20')).toBeUndefined();
  });

  it('rejects a malformed body', async () => {
    seedMember('Lin', { id: 'member-lin' });
    expect((await POST(postAs('Lin', { done: true }))).status).toBe(400);
    expect((await POST(postAs('Lin', { drillId: 'd1' }))).status).toBe(400);
    expect((await POST(postAs('Lin', { drillId: 'd1', done: 'yes' }))).status).toBe(400);
  });

  // ── Idempotence ─────────────────────────────────────────────────────────
  it('is idempotent — a double-tap cannot double-count', async () => {
    seedMember('Lin', { id: 'member-lin' });
    await POST(postAs('Lin', { drillId: 'd1', done: true }));
    const res = await POST(postAs('Lin', { drillId: 'd1', done: true }));
    const body = await res.json();
    expect(body.done).toEqual(['d1']);
  });

  it('un-marks a drill', async () => {
    seedMember('Lin', { id: 'member-lin' });
    await POST(postAs('Lin', { drillId: 'd1', done: true }));
    await POST(postAs('Lin', { drillId: 'd2', done: true }));
    const res = await POST(postAs('Lin', { drillId: 'd1', done: false }));
    const body = await res.json();
    expect(body.done).toEqual(['d2']);
  });

  it('un-marking something never marked is a no-op, not an error', async () => {
    seedMember('Lin', { id: 'member-lin' });
    const res = await POST(postAs('Lin', { drillId: 'ghost', done: false }));
    expect(res.status).toBe(200);
    expect((await res.json()).done).toEqual([]);
  });

  // ── weekKey is server-derived ───────────────────────────────────────────
  it('derives weekKey from the active session, ignoring the client', async () => {
    seedMember('Lin', { id: 'member-lin' });
    const res = await POST(postAs('Lin', { drillId: 'd1', done: true, weekKey: 'session-1999-01-01' }));
    const body = await res.json();
    expect(body.weekKey).toBe('session-2026-08-20');
    expect(docFor('member-lin', 'session-1999-01-01')).toBeUndefined();
  });

  it('keeps weeks separate, so advancing the session resets the counter', async () => {
    seedMember('Lin', { id: 'member-lin' });
    await POST(postAs('Lin', { drillId: 'd1', done: true }));
    resetMockStore();
    setupAdminPin();
    seedPointer('session-2026-08-27');
    seedMember('Lin', { id: 'member-lin' });
    const res = await POST(postAs('Lin', { drillId: 'd2', done: true }));
    const body = await res.json();
    expect(body.weekKey).toBe('session-2026-08-27');
    expect(body.done).toEqual(['d2']);
  });
});

describe('GET /api/stats/drills — done field', () => {
  beforeEach(() => {
    resetMockStore();
    setupAdminPin();
    seedPointer('session-2026-08-20');
  });
  afterAll(() => {
  });

  it('ships completions with the picks so the counter is right on first paint', async () => {
    seedMember('Lin', { id: 'member-lin' });
    await POST(postAs('Lin', { drillId: 'd1', done: true }));

    const res = await GET(
      makeRequest('GET', 'http://localhost:3000/api/stats/drills?name=Lin', undefined, {
        Cookie: `member_session=${memberCookieValue('Lin')}`,
      }),
    );
    expect(res.status).toBe(200);
    const body = await res.json();
    expect(body.done).toEqual(['d1']);
  });

  it('returns an empty done list rather than omitting the field', async () => {
    seedMember('Lin', { id: 'member-lin' });
    const res = await GET(
      makeRequest('GET', 'http://localhost:3000/api/stats/drills?name=Lin', undefined, {
        Cookie: `member_session=${memberCookieValue('Lin')}`,
      }),
    );
    const body = await res.json();
    expect(body.done).toEqual([]);
  });
});
