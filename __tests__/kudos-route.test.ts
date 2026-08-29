import { describe, it, expect, beforeEach, afterAll } from 'vitest';
import { POST, GET } from '../app/api/kudos/route';
import {
  resetMockStore, getStore, seedMember, setupAdminPin, makeRequest, makeGetRequest, memberCookieValue,
} from './helpers';

const BASE = 'http://localhost:3000/api/kudos';

function postAs(name: string, body: Record<string, unknown>) {
  const cookie = `member_session=${memberCookieValue(name)}`;
  return makeRequest('POST', BASE, body, { Cookie: cookie });
}
function getAs(name: string, cookieName?: string) {
  const cookie = `member_session=${memberCookieValue(cookieName ?? name)}`;
  return makeRequest('GET', `${BASE}?name=${encodeURIComponent(name)}`, undefined, { Cookie: cookie });
}

/** Seed a non-removed roster for the active (fallback) session so co-play passes. */
function seedRoster(names: string[]) {
  const store = getStore();
  if (!store['players']) store['players'] = [];
  for (const n of names) {
    store['players'].push({ id: `p-${n.toLowerCase()}`, sessionId: 'current-session', name: n, removed: false });
  }
}

describe('/api/kudos', () => {
  beforeEach(() => {
    resetMockStore();
    setupAdminPin();
    process.env.NEXT_PUBLIC_FLAG_KUDOS = 'true';
  });
  afterAll(() => {
    delete process.env.NEXT_PUBLIC_FLAG_KUDOS;
  });

  describe('POST', () => {
    it('404s when the flag is off', async () => {
      process.env.NEXT_PUBLIC_FLAG_KUDOS = 'false';
      const res = await POST(postAs('Viktor', { recipientName: 'Lin', tag: 'clutch' }));
      expect(res.status).toBe(404);
    });

    it('401s without a member cookie (rater identity comes from the cookie)', async () => {
      const res = await POST(makeRequest('POST', BASE, { recipientName: 'Lin', tag: 'clutch' }));
      expect(res.status).toBe(401);
    });

    it('400s on an invalid tag', async () => {
      seedRoster(['Viktor', 'Lin']);
      const res = await POST(postAs('Viktor', { recipientName: 'Lin', tag: 'mvp' }));
      expect(res.status).toBe(400);
    });

    it('403s on self-kudos', async () => {
      seedRoster(['Viktor']);
      const res = await POST(postAs('Viktor', { recipientName: 'Viktor', tag: 'clutch' }));
      expect(res.status).toBe(403);
    });

    it('403s when the two did not play together', async () => {
      seedRoster(['Viktor']); // Lin not in the session
      seedMember('Lin');
      const res = await POST(postAs('Viktor', { recipientName: 'Lin', tag: 'clutch' }));
      expect(res.status).toBe(403);
      expect((await res.json()).error).toBe('not_co_player');
    });

    it('201s on a valid co-play kudos, and a duplicate is 409', async () => {
      seedRoster(['Viktor', 'Lin']);
      seedMember('Lin');
      const ok = await POST(postAs('Viktor', { recipientName: 'Lin', tag: 'clutch' }));
      expect(ok.status).toBe(201);
      const dupe = await POST(postAs('Viktor', { recipientName: 'Lin', tag: 'clutch' }));
      expect(dupe.status).toBe(409);
      // A DIFFERENT tag from the same rater is allowed.
      const other = await POST(postAs('Viktor', { recipientName: 'Lin', tag: 'nice_shot' }));
      expect(other.status).toBe(201);
    });

    it('accepts co-play proven via a logged game (not just the roster)', async () => {
      const store = getStore();
      store['gameResults'] = [{ id: 'g1', sessionId: 'current-session', teamA: ['Viktor', 'Lin'], teamB: ['A', 'B'], scoreA: 21, scoreB: 10, loggedAt: '2026-06-13T00:00:00Z' }];
      seedMember('Lin');
      const res = await POST(postAs('Viktor', { recipientName: 'Lin', tag: 'good_sport' }));
      expect(res.status).toBe(201);
    });
  });

  describe('GET', () => {
    async function sendKudos(rater: string, recipient: string, tag: string) {
      seedRoster([rater, recipient]);
      const res = await POST(postAs(rater, { recipientName: recipient, tag }));
      expect(res.status).toBe(201);
    }

    it('404s when the flag is off', async () => {
      process.env.NEXT_PUBLIC_FLAG_KUDOS = 'false';
      const res = await GET(getAs('Lin'));
      expect(res.status).toBe(404);
    });

    it('400s with no name', async () => {
      const res = await GET(makeRequest('GET', BASE));
      expect(res.status).toBe(400);
    });

    it('403s for a non-owner without admin', async () => {
      const res = await GET(getAs('Lin', 'Viktor'));
      expect(res.status).toBe(403);
    });

    it('returns counts to the owning member and never leaks rater identity', async () => {
      seedMember('Lin');
      await sendKudos('Viktor', 'Lin', 'clutch');
      await sendKudos('Akane', 'Lin', 'clutch');
      const res = await GET(getAs('Lin'));
      expect(res.status).toBe(200);
      const text = await res.text();
      expect(text).not.toMatch(/raterName|raterMemberId|Viktor|Akane/);
      const body = JSON.parse(text);
      expect(body.kudos).toEqual([{ tag: 'clutch', count: 2 }]);
    });

    it('lets an admin read another member\'s counts', async () => {
      seedMember('Lin');
      await sendKudos('Viktor', 'Lin', 'nice_shot');
      const res = await GET(makeGetRequest(`${BASE}?name=Lin`, true));
      expect(res.status).toBe(200);
      expect((await res.json()).kudos).toEqual([{ tag: 'nice_shot', count: 1 }]);
    });
  });
});

/**
 * The 2026-08-29 redesign, from real user feedback: kudos were unreachable
 * because eligibility and the window both keyed off the ACTIVE session, and the
 * owner advances the session minutes after play.
 */
describe('/api/kudos — the redesign', () => {
  beforeEach(() => {
    resetMockStore();
    setupAdminPin();
    process.env.NEXT_PUBLIC_FLAG_KUDOS = 'true';
  });

  /** Seed a roster row against an arbitrary session id. */
  function seedRosterFor(sessionId: string, names: string[]) {
    const store = getStore();
    if (!store['players']) store['players'] = [];
    for (const n of names) {
      store['players'].push({ id: `p-${sessionId}-${n}`, sessionId, name: n, removed: false });
    }
  }
  function seedSessions(ids: string[]) {
    const store = getStore();
    if (!store['sessions']) store['sessions'] = [];
    for (const id of ids) store['sessions'].push({ id, sessionId: id });
  }

  /**
   * THE BUG THAT STARTED THIS. They played last week; the club has since
   * advanced to a new, empty session. Kudos must still work.
   */
  it('accepts co-play from a PAST session after the club advanced', async () => {
    seedMember('Viktor');
    seedMember('Lin');
    seedSessions(['session-2026-08-20', 'session-2026-08-27']);
    // They played on the 20th. The active session is a fresh, empty one.
    seedRosterFor('session-2026-08-20', ['Viktor', 'Lin']);
    seedRosterFor('current-session', []);

    const res = await POST(postAs('Viktor', { recipientName: 'Lin', tag: 'most_improved' }));
    expect(res.status).toBe(201);
  });

  it('still refuses two people who never shared any recent session', async () => {
    seedMember('Viktor');
    seedMember('Akane');
    seedSessions(['session-2026-08-20']);
    seedRosterFor('session-2026-08-20', ['Viktor']);
    seedRosterFor('session-2026-08-20', ['Akane'].filter(() => false));

    const res = await POST(postAs('Viktor', { recipientName: 'Akane', tag: 'clutch' }));
    expect(res.status).toBe(403);
  });

  it('stores an optional note and signs it, and echoes no rater identity', async () => {
    seedMember('Viktor');
    seedMember('Lin');
    seedRoster(['Viktor', 'Lin']);

    const res = await POST(
      postAs('Viktor', {
        recipientName: 'Lin',
        tag: 'most_improved',
        note: '  your net play got a lot sharper  ',
        skillKey: 'net_play',
      }),
    );
    expect(res.status).toBe(201);
    expect(JSON.stringify(await res.json())).not.toContain('Viktor');

    const stored = getStore()['kudos'][0] as { note?: string; skillKey?: string; raterName?: string };
    expect(stored.note).toBe('your net play got a lot sharper'); // trimmed
    expect(stored.skillKey).toBe('net_play');
    expect(stored.raterName).toBe('Viktor');
  });

  it('drops a skillKey that is not a real assessment skill', async () => {
    seedMember('Viktor');
    seedMember('Lin');
    seedRoster(['Viktor', 'Lin']);
    await POST(postAs('Viktor', { recipientName: 'Lin', tag: 'clutch', note: 'x', skillKey: 'vibes' }));
    expect((getStore()['kudos'][0] as { skillKey?: string }).skillKey).toBeUndefined();
  });

  /** A structured field must not hold free text just because a note was sent. */
  it('drops a skillKey when there is no note to attach it to', async () => {
    seedMember('Viktor');
    seedMember('Lin');
    seedRoster(['Viktor', 'Lin']);
    await POST(postAs('Viktor', { recipientName: 'Lin', tag: 'clutch', skillKey: 'net_play' }));
    expect((getStore()['kudos'][0] as { skillKey?: string }).skillKey).toBeUndefined();
  });

  it('returns signed notes to the owner, but never a bare tag’s rater', async () => {
    seedMember('Viktor');
    seedMember('Lin');
    seedRoster(['Viktor', 'Lin']);
    await POST(postAs('Viktor', { recipientName: 'Lin', tag: 'most_improved', note: 'sharper net play' }));
    await POST(postAs('Viktor', { recipientName: 'Lin', tag: 'clutch' })); // no note

    const body = await (await GET(getAs('Lin'))).json();
    expect(body.notes).toHaveLength(1);
    expect(body.notes[0].raterName).toBe('Viktor');
    expect(body.notes[0].note).toBe('sharper net play');
    // Two tags aggregated, but only ONE of them is attributable.
    expect(body.kudos).toHaveLength(2);
    expect(JSON.stringify(body)).not.toContain('raterMemberId');
  });

  /**
   * DEDUPE MOVED FROM PER-SESSION TO PER ISO WEEK, and this test only means
   * something if the ACTIVE SESSION ACTUALLY CHANGES between the two posts —
   * otherwise per-session dedupe catches it too and the test proves nothing.
   * It did exactly that on the first attempt, and was caught by falsifying it.
   *
   * With the advance in place: session-dedupe would ALLOW the second (different
   * session), week-dedupe REFUSES it. That is the whole behaviour change.
   */
  it('refuses the same tag twice in one week, ACROSS an advance', async () => {
    seedMember('Viktor');
    seedMember('Lin');
    seedSessions(['session-2026-08-20', 'session-2026-08-27']);
    seedRosterFor('session-2026-08-20', ['Viktor', 'Lin']);
    seedRosterFor('session-2026-08-27', ['Viktor', 'Lin']);

    const store = getStore();
    const pointTo = (id: string) => {
      store['sessions'] = (store['sessions'] ?? []).filter((d) => (d as { id?: string }).id !== 'active-session-pointer');
      store['sessions'].push({ id: 'active-session-pointer', sessionId: 'active-session-pointer', activeSessionId: id });
    };

    pointTo('session-2026-08-20');
    expect((await POST(postAs('Viktor', { recipientName: 'Lin', tag: 'clutch' }))).status).toBe(201);

    // The club advances — a DIFFERENT active session now.
    pointTo('session-2026-08-27');
    const second = await POST(postAs('Viktor', { recipientName: 'Lin', tag: 'clutch' }));
    expect(second.status).toBe(409);
  });

  it('still allows a DIFFERENT tag to the same person', async () => {
    seedMember('Viktor');
    seedMember('Lin');
    seedRoster(['Viktor', 'Lin']);
    expect((await POST(postAs('Viktor', { recipientName: 'Lin', tag: 'clutch' }))).status).toBe(201);
    expect((await POST(postAs('Viktor', { recipientName: 'Lin', tag: 'nice_shot' }))).status).toBe(201);
  });
});
