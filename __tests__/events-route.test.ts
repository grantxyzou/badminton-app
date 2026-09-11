// @vitest-environment node
import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import { POST } from '@/app/api/events/route';
import { NextRequest, NextResponse } from 'next/server';
import { setMemberCookie } from '@/lib/auth';
import { resetMockStore, getStore, setupAdminPin } from './helpers';

/**
 * The `events` container is what makes the Value-Hub Slice-0 kill-criterion
 * answerable ("interact with the rec card MORE THAN ONCE"), so the two things
 * that matter most here are (a) it can't be written anonymously, and (b) it
 * appends rather than upserts — an upsert would silently destroy the very
 * signal the criterion needs.
 */

function memberCookieValue(memberId: string, name: string): string {
  const r = NextResponse.json({});
  setMemberCookie(r, memberId, name);
  return r.cookies.get('member_session')!.value;
}

let ipCounter = 0;
function post(body: unknown, cookie?: string): NextRequest {
  ipCounter++;
  const headers: Record<string, string> = {
    'content-type': 'application/json',
    'x-client-ip': `events-${ipCounter}`,
  };
  if (cookie) headers.cookie = cookie;
  return new NextRequest(new URL('/api/events', 'http://localhost/bpm'), {
    method: 'POST',
    body: JSON.stringify(body),
    headers,
  });
}

function postAs(memberId: string, name: string, body: unknown): NextRequest {
  return post(body, `member_session=${memberCookieValue(memberId, name)}`);
}

beforeEach(() => {
  resetMockStore();
  setupAdminPin();
  process.env.NEXT_PUBLIC_FLAG_VALUE_HUB_SLICE = 'true';
});

afterEach(() => {
  delete process.env.NEXT_PUBLIC_FLAG_VALUE_HUB_SLICE;
});

describe('POST /api/events', () => {
  /**
   * The flag gate is PER-KIND, not blanket.
   *
   * Equipment kinds keep the original posture — flag off leaves no live write
   * endpoint behind. The skill-funnel kinds deliberately do not, because this
   * gate was a blanket 404 on a flag carrying a retirement date, so every
   * beacon in the app would have gone silent on the day that flag was deleted.
   * A measurement that switches itself off on a date is not a measurement.
   */
  it('404s an EQUIPMENT kind when the value-hub flag is off, leaving no live write endpoint behind', async () => {
    process.env.NEXT_PUBLIC_FLAG_VALUE_HUB_SLICE = 'false';
    const res = await POST(postAs('member-lin', 'Lin', { kind: 'rec_card_tap' }));
    expect(res.status).toBe(404);
    expect(getStore()['events'] ?? []).toHaveLength(0);
  });

  it('still records a SKILL kind when the value-hub flag is off — the funnel outlives the flag', async () => {
    process.env.NEXT_PUBLIC_FLAG_VALUE_HUB_SLICE = 'false';
    const res = await POST(postAs('member-lin', 'Lin', { kind: 'stats_open' }));
    expect(res.status).toBe(201);
    expect(getStore()['events'] ?? []).toHaveLength(1);
  });

  it('keeps rate limit and auth AHEAD of the per-kind gate (rules 4 and 12)', async () => {
    // A skill kind is ungated, but that must not become an unauthenticated
    // write path: the cookie check still runs first.
    process.env.NEXT_PUBLIC_FLAG_VALUE_HUB_SLICE = 'false';
    const res = await POST(post({ kind: 'stats_open' }));
    expect(res.status).toBe(401);
    expect(getStore()['events'] ?? []).toHaveLength(0);
  });

  it('bounds the check-in source to the enum rather than storing free text', async () => {
    const ok = await POST(postAs('member-lin', 'Lin', { kind: 'checkin_open', source: 'strip' }));
    expect(ok.status).toBe(201);
    expect((getStore()['events'] as Array<{ source?: string }>)[0].source).toBe('strip');

    const junk = await POST(postAs('member-viktor', 'Viktor', { kind: 'checkin_open', source: 'wherever' }));
    expect(junk.status).toBe(201);
    expect((getStore()['events'] as Array<{ source?: string }>)[1].source).toBeUndefined();
  });

  it('401s without a member cookie, so anonymous and preview-name taps do not count', async () => {
    const res = await POST(post({ kind: 'rec_card_tap' }));
    expect(res.status).toBe(401);
    expect(getStore()['events'] ?? []).toHaveLength(0);
  });

  it('rejects an unknown kind rather than accepting free text', async () => {
    const res = await POST(postAs('member-lin', 'Lin', { kind: 'whatever_i_want' }));
    expect(res.status).toBe(400);
    expect((await res.json()).error).toBe('unknown_kind');
  });

  it('rejects a malformed body', async () => {
    const req = new NextRequest(new URL('/api/events', 'http://localhost/bpm'), {
      method: 'POST',
      body: 'not json',
      headers: {
        'content-type': 'application/json',
        'x-client-ip': 'events-badbody',
        cookie: `member_session=${memberCookieValue('member-lin', 'Lin')}`,
      },
    });
    expect((await POST(req)).status).toBe(400);
  });

  it('records a tap bound to the cookie identity, not to anything client-supplied', async () => {
    const res = await POST(
      postAs('member-lin', 'Lin', { kind: 'rec_card_tap', memberId: 'member-someone-else', name: 'Viktor' }),
    );
    expect(res.status).toBe(201);

    const events = getStore()['events'] as Array<Record<string, unknown>>;
    expect(events).toHaveLength(1);
    expect(events[0].memberId).toBe('member-lin');
    expect(events[0].name).toBe('Lin');
    expect(events[0].kind).toBe('rec_card_tap');
    expect(typeof events[0].at).toBe('string');
  });

  it('APPENDS one doc per tap — "more than once" depends on this not being an upsert', async () => {
    await POST(postAs('member-lin', 'Lin', { kind: 'rec_card_tap' }));
    await POST(postAs('member-lin', 'Lin', { kind: 'rec_card_tap' }));
    await POST(postAs('member-lin', 'Lin', { kind: 'rec_card_tap' }));

    const events = getStore()['events'] as Array<Record<string, unknown>>;
    expect(events).toHaveLength(3);
    // Distinct ids, so nothing collapses on write.
    expect(new Set(events.map((e) => e.id)).size).toBe(3);
  });

  it('keeps separate members separate', async () => {
    await POST(postAs('member-lin', 'Lin', { kind: 'rec_card_tap' }));
    await POST(postAs('member-viktor', 'Viktor', { kind: 'rec_card_tap' }));

    const events = getStore()['events'] as Array<Record<string, unknown>>;
    expect(new Set(events.map((e) => e.memberId))).toEqual(new Set(['member-lin', 'member-viktor']));
  });

  it('rate limits before checking auth, so the limit cannot be bypassed', async () => {
    // Same IP for every call; the limit is 120/hr.
    const ip = 'events-flood';
    const hammer = () =>
      new NextRequest(new URL('/api/events', 'http://localhost/bpm'), {
        method: 'POST',
        body: JSON.stringify({ kind: 'rec_card_tap' }),
        headers: { 'content-type': 'application/json', 'x-client-ip': ip },
      });

    let sawRateLimit = false;
    for (let i = 0; i < 130; i++) {
      const res = await POST(hammer());
      if (res.status === 429) { sawRateLimit = true; break; }
      // Until the limit trips these are 401s (anonymous) — never 201.
      expect(res.status).toBe(401);
    }
    expect(sawRateLimit).toBe(true);
  });
});

describe('POST /api/events — the fit engine\'s feedback beacons', () => {
  it('accepts pick_added / pick_tried / pick_rated with a bounded payload, dropping anything else', async () => {
    const res = await POST(postAs('m1', 'Lin', {
      kind: 'pick_rated', catalogId: 'racket-yonex-astrox-88d-pro', engineVersion: 'fit-1', rating: 'up', category: 'racket',
      extra: 'nope', memberId: 'someone-else',
    }));
    expect(res.status).toBe(201);
    const row = getStore().events[0] as Record<string, unknown>;
    expect(row).toMatchObject({ kind: 'pick_rated', memberId: 'm1', catalogId: 'racket-yonex-astrox-88d-pro', engineVersion: 'fit-1', rating: 'up', category: 'racket' });
    expect(row).not.toHaveProperty('extra');
    for (const kind of ['pick_added', 'pick_tried']) {
      expect((await POST(postAs('m1', 'Lin', { kind, catalogId: 'r1' }))).status).toBe(201);
    }
  });

  it('drops an out-of-vocabulary rating or category, and an over-long id, rather than storing them', async () => {
    const res = await POST(postAs('m1', 'Lin', { kind: 'pick_rated', rating: 'meh', category: 'shoe', catalogId: 'x'.repeat(200) }));
    expect(res.status).toBe(201);
    const row = getStore().events[0] as Record<string, unknown>;
    expect(row).not.toHaveProperty('rating');
    expect(row).not.toHaveProperty('category');
    expect(row).not.toHaveProperty('catalogId');
  });

  it('refuses pick_served from the client — it is the denominator and only the server writes it', async () => {
    const res = await POST(postAs('m1', 'Lin', { kind: 'pick_served', catalogId: 'r1' }));
    expect(res.status).toBe(400);
    expect(getStore().events ?? []).toHaveLength(0);
  });

  it('a rec_card_tap carries no payload even if one is sent', async () => {
    await POST(postAs('m1', 'Lin', { kind: 'rec_card_tap', catalogId: 'r1', rating: 'up' }));
    const row = getStore().events[0] as Record<string, unknown>;
    expect(row).not.toHaveProperty('catalogId');
    expect(row).not.toHaveProperty('rating');
  });
});

