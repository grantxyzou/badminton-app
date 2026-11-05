import { describe, it, expect, beforeEach } from 'vitest';
import { NextResponse } from 'next/server';
import {
  resetMockStore,
  getStore,
  setupAdminPin,
  seedPointer,
  seedSession,
  seedMember,
  seedPlayer,
  makeRequest,
} from './helpers';
import { POST } from '@/app/api/players/route';
import { setMemberCookie } from '@/lib/auth';

/**
 * Two sign-ups for the last spot (audit, 2026-11-05). The capacity check and
 * the write are not one step, so both can pass the check. A NEW row was
 * already re-counted after its insert (#79); a REJOIN — a cancelled row
 * brought back — was not, so a rejoin racing a new sign-up filled the session
 * past its cap. A rejoin past the cap goes back to how it was (its row holds
 * its history, and maybe its bill), never deleted.
 */
function cookieFor(memberId: string, name: string): string {
  const res = NextResponse.json({});
  setMemberCookie(res, memberId, name);
  return `member_session=${res.cookies.get('member_session')!.value}`;
}
const sessionId = 'session-2026-12-03';
type Row = { id: string; name: string; removed?: boolean; waitlisted?: boolean; sessionId: string };
const rows = () => ((getStore().players ?? []) as Row[]).filter((r) => r.sessionId === sessionId);
const confirmed = () => rows().filter((r) => !r.removed && !r.waitlisted);

setupAdminPin();

describe('the last spot, taken twice at once', () => {
  let lin: { id: string };
  let kento: { id: string };

  beforeEach(() => {
    resetMockStore();
    seedPointer(sessionId);
    seedSession(sessionId, { maxPlayers: 1, signupOpen: true });
    lin = seedMember('Lin') as { id: string };
    kento = seedMember('Kento') as { id: string };
    // Kento signed up earlier and cancelled; his row is still there.
    seedPlayer(sessionId, 'Kento', { id: 'p-kento', memberId: kento.id, removed: true, removedAt: '2026-12-01T00:00:00Z' });
  });

  const signUp = (memberId: string, name: string, ip: string) =>
    POST(makeRequest('POST', 'http://x/api/players', { name }, { 'X-Client-IP': ip, Cookie: cookieFor(memberId, name) }));

  it('never confirms more people than there are spots, when a rejoin races a new sign-up', async () => {
    const results = await Promise.all([signUp(lin.id, 'Lin', '10.9.0.1'), signUp(kento.id, 'Kento', '10.9.0.2')]);
    expect(confirmed().length).toBe(1);
    // Exactly one of them was told "Session is full".
    expect(results.map((r) => r.status).sort()).toEqual([201, 409]);
  });

  it('a rejoin that lost the race keeps its row, cancelled as it was', async () => {
    await Promise.all([signUp(lin.id, 'Lin', '10.9.0.3'), signUp(kento.id, 'Kento', '10.9.0.4')]);
    const kentoRow = rows().find((r) => r.id === 'p-kento');
    expect(kentoRow, 'the rejoining row must never be deleted').toBeTruthy();
    if (confirmed()[0]?.id !== 'p-kento') expect(kentoRow!.removed).toBe(true);
  });
});
