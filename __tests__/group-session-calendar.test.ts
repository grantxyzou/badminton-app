import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import {
  resetMockStore,
  setupAdminPin,
  seedDoc,
  seedMember,
  seedGroup,
  seedMembership,
  seedSession,
  makeRequest,
  memberCookieValue,
} from './helpers';
import { POINTER_ID, sessionIdFromDate } from '@/lib/cosmos';
import { groupDocId } from '@/lib/groupScope';
import { GET } from '@/app/api/session/calendar/route';
import { buildIcs, sessionCalendarEvent, DEFAULT_SESSION_MINUTES } from '@/lib/calendarEvent';

/**
 * "Add to calendar" (docs/plans/add-to-calendar.md): the shared event builder,
 * and the web route that serves it — members only, and the CLAIMED club's
 * session, never another club's.
 */

describe('sessionCalendarEvent', () => {
  const base = {
    id: 'session-2026-10-29',
    title: 'Thursday badminton',
    datetime: '2026-10-29T20:00:00-07:00',
    endDatetime: '2026-10-29T22:00:00-07:00',
    locationName: "Wing's badminton",
    locationAddress: '123 Main St, Richmond',
  };

  it('carries the start, end, title and the place with its address', () => {
    const evt = sessionCalendarEvent(base, { fallbackTitle: 'BPM badminton' })!;
    expect(evt.start.toISOString()).toBe('2026-10-30T03:00:00.000Z');
    expect(evt.end.toISOString()).toBe('2026-10-30T05:00:00.000Z');
    expect(evt.title).toBe('Thursday badminton');
    expect(evt.location).toBe("Wing's badminton, 123 Main St, Richmond");
    expect(evt.uid).toBe('session-2026-10-29@bpm.grantzou.com');
  });

  it('runs two hours when no end is stored, or the end is not after the start', () => {
    for (const endDatetime of [undefined, '2026-10-29T19:00:00-07:00', 'nonsense']) {
      const evt = sessionCalendarEvent({ ...base, endDatetime }, { fallbackTitle: 'x' })!;
      expect(evt.end.getTime() - evt.start.getTime()).toBe(DEFAULT_SESSION_MINUTES * 60_000);
    }
  });

  it('falls back on a blank title and drops a blank place', () => {
    const evt = sessionCalendarEvent(
      { ...base, title: '  ', locationName: undefined, locationAddress: '' },
      { fallbackTitle: 'BPM badminton' },
    )!;
    expect(evt.title).toBe('BPM badminton');
    expect(evt.location).toBeUndefined();
  });

  it('is null without a usable start', () => {
    expect(sessionCalendarEvent({ ...base, datetime: '' }, { fallbackTitle: 'x' })).toBeNull();
  });
});

describe('buildIcs', () => {
  const evt = {
    uid: 'session-2026-10-29@bpm.grantzou.com',
    title: 'Thursday, late; \\ night',
    start: new Date('2026-10-30T03:00:00Z'),
    end: new Date('2026-10-30T05:00:00Z'),
    location: "Wing's badminton, 123 Main St",
  };
  const ics = buildIcs(evt, new Date('2026-10-28T12:00:00Z'));

  it('writes UTC times and a DTSTAMP, CRLF throughout', () => {
    expect(ics).toContain('DTSTART:20261030T030000Z\r\n');
    expect(ics).toContain('DTEND:20261030T050000Z\r\n');
    expect(ics).toContain('DTSTAMP:20261028T120000Z\r\n');
    expect(ics.replace(/\r\n/g, '')).not.toMatch(/\n/);
    expect(ics.startsWith('BEGIN:VCALENDAR\r\n')).toBe(true);
    expect(ics.endsWith('END:VCALENDAR\r\n')).toBe(true);
  });

  it('escapes commas, semicolons and backslashes in text', () => {
    expect(ics).toContain('SUMMARY:Thursday\\, late\\; \\\\ night\r\n');
    expect(ics).toContain("LOCATION:Wing's badminton\\, 123 Main St\r\n");
  });

  it('folds lines past 75 octets without splitting a character', () => {
    const long = buildIcs({ ...evt, location: '羽毛球'.repeat(40) }, new Date(0));
    const enc = new TextEncoder();
    for (const line of long.split('\r\n')) expect(enc.encode(line).length).toBeLessThanOrEqual(75);
    // Unfolding gives the original back.
    expect(long.replace(/\r\n /g, '')).toContain(`LOCATION:${'羽毛球'.repeat(40)}`);
  });
});

describe('GET /api/session/calendar', () => {
  const FLAG = 'NEXT_PUBLIC_FLAG_MULTI_GROUP';
  const NEXT = new Date(Date.now() + 7 * 86_400_000).toISOString();

  function seedClub(groupId: string, marker: string) {
    const activeId = sessionIdFromDate(NEXT, groupId);
    seedGroup(groupId, { name: `${marker} Club`, ownerMemberId: 'm-ana' });
    seedMembership(groupId, 'm-ana', { name: 'Ana' });
    seedSession(activeId, {
      groupId,
      datetime: NEXT,
      deadline: NEXT,
      title: `${marker} night`,
      locationName: `${marker} Gym`,
    });
    seedDoc('sessions', {
      id: groupDocId(groupId, POINTER_ID),
      sessionId: groupDocId(groupId, POINTER_ID),
      groupId,
      activeSessionId: activeId,
    });
  }

  const asAna = (groupId: string) =>
    makeRequest('GET', 'http://x/api/session/calendar', undefined, {
      Cookie: `member_session=${memberCookieValue('Ana', 'm-ana', 3600, groupId)}`,
    });

  beforeEach(() => {
    resetMockStore();
    setupAdminPin(); // sets the cookie-signing secret
    seedMember('Ana', { id: 'm-ana' });
    process.env[FLAG] = 'true';
    seedClub('club-a', 'Alpha');
    seedClub('club-b', 'Beta');
  });
  afterEach(() => {
    delete process.env[FLAG];
  });

  it('refuses a signed-out caller', async () => {
    const res = await GET(makeRequest('GET', 'http://x/api/session/calendar'));
    expect(res.status).toBe(401);
  });

  it("answers the claimed club's session as text/calendar, and only that one", async () => {
    for (const [mine, theirs] of [['club-a', 'Beta'], ['club-b', 'Alpha']] as const) {
      const res = await GET(asAna(mine));
      expect(res.status).toBe(200);
      expect(res.headers.get('content-type')).toContain('text/calendar');
      expect(res.headers.get('content-disposition')).toContain('inline');
      const ics = await res.text();
      const marker = mine === 'club-a' ? 'Alpha' : 'Beta';
      expect(ics).toContain(`SUMMARY:${marker} night`);
      expect(ics).toContain(`LOCATION:${marker} Gym`);
      expect(ics).not.toContain(theirs);
    }
  });

  it('answers no_active_session for a club with no session', async () => {
    seedGroup('club-c', { name: 'Gamma Club', ownerMemberId: 'm-ana' });
    seedMembership('club-c', 'm-ana', { name: 'Ana' });
    const res = await GET(asAna('club-c'));
    expect(res.status).toBe(404);
    expect(await res.json()).toMatchObject({ error: 'no_active_session' });
  });
});
