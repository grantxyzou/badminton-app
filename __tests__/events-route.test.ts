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
  it('404s when the value-hub flag is off, leaving no live write endpoint behind', async () => {
    process.env.NEXT_PUBLIC_FLAG_VALUE_HUB_SLICE = 'false';
    const res = await POST(postAs('member-lin', 'Lin', { kind: 'rec_card_tap' }));
    expect(res.status).toBe(404);
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
