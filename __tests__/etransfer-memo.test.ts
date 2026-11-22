import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import { memberMemo } from '@/lib/receiptTemplate';
import { memoRosterName } from '@/lib/paymentsInbox';
import { GET as unpaidGet } from '@/app/api/players/unpaid/route';
import {
  resetMockStore,
  setupAdminPin,
  seedTestAdminMember,
  seedGroup,
  seedPointer,
  seedSession,
  seedPlayer,
  makeRequest,
  memberCookieValue,
  ADMIN_MEMBER_ID,
} from './helpers';

/**
 * THE MEMO A MEMBER PASTES (docs/plans/payment-order.md; Grant, 2026-11-22:
 * "Memo, tailored to each user account"). The club's memo template filled in
 * for one member and everything they owe, and the name lands where the
 * payments inbox reads it back.
 */

const OCT1 = '2026-10-01T19:00:00-07:00';
const OCT8 = '2026-10-08T19:00:00-07:00';

describe('memberMemo', () => {
  it('fills the default template with the club, the nights owed oldest first, and the name last', () => {
    expect(memberMemo({ club: 'BPM Core', name: 'Lin', dates: [OCT8, OCT1], stringing: false })).toBe('BPM Core Oct 1, Oct 8 - Lin');
  });

  it('reads the night on the club\'s clock, not the server\'s', () => {
    // 7 PM in Vancouver is the next day in UTC.
    expect(memberMemo({ club: 'BPM Core', name: 'Lin', dates: ['2026-10-01T19:30:00-07:00'], stringing: false })).toBe('BPM Core Oct 1 - Lin');
  });

  it('names three nights and counts the rest; a racket reads as stringing', () => {
    const dates = ['2026-09-10', '2026-09-17', '2026-09-24', '2026-10-01', '2026-10-08'].map((d) => `${d}T19:00:00-07:00`);
    expect(memberMemo({ club: 'BPM Core', name: 'Lin', dates, stringing: true })).toBe('BPM Core Sep 10, Sep 17, Sep 24 +2 + stringing - Lin');
    expect(memberMemo({ club: 'BPM Core', name: 'Lin', dates: [], stringing: true })).toBe('BPM Core stringing - Lin');
  });

  it('uses the club\'s own template when it set one, and leaves out an unknown club', () => {
    expect(memberMemo({ template: 'Badminton {date} ({name})', club: 'BPM Core', name: 'Lin', dates: [OCT1], stringing: false })).toBe('Badminton Oct 1 (Lin)');
    expect(memberMemo({ name: 'Lin', dates: [OCT1], stringing: false })).toBe('Oct 1 - Lin');
  });

  it('the payments inbox reads the name back out of it', () => {
    const memo = memberMemo({ club: 'BPM Core', name: 'Lin Dan', dates: [OCT1, OCT8], stringing: true })!;
    expect(memoRosterName(memo, ['Viktor', 'Lin Dan'])).toBe('Lin Dan');
  });
});

describe('GET /api/players/unpaid', () => {
  const FLAG = 'NEXT_PUBLIC_FLAG_MULTI_GROUP';
  const before = process.env[FLAG];
  const ask = async () =>
    (await unpaidGet(makeRequest('GET', 'http://x/api/players/unpaid?name=Lin', undefined, { Cookie: `member_session=${memberCookieValue('Lin')}` }))).json();

  beforeEach(async () => {
    resetMockStore();
    setupAdminPin();
    await seedTestAdminMember();
    delete process.env[FLAG];
    seedPointer('session-2026-10-08');
    const settled = { at: new Date().toISOString(), costPerPerson: 10, totalCost: 40, courtTotal: 40, birdTotal: 0, playerCount: 4, playerNames: [] };
    seedSession('session-2026-10-01', { datetime: OCT1, settled });
    seedSession('session-2026-10-08', { datetime: OCT8, settled });
    seedPlayer('session-2026-10-01', 'Lin', { owedAmount: 10, paid: false });
    seedPlayer('session-2026-10-08', 'Lin', { owedAmount: 10, paid: false });
  });
  afterEach(() => {
    if (before === undefined) delete process.env[FLAG];
    else process.env[FLAG] = before;
  });

  it('answers the memo beside the address, and never the club\'s template', async () => {
    seedGroup('bpm', { name: 'BPM Core', ownerMemberId: ADMIN_MEMBER_ID, settings: { skipDates: [], maxPlayers: 12, eTransferRecipient: { name: 'Club', email: 'club@example.com', memo: '{club} {date} - {name}' } } });
    const body = await ask();
    expect(body.payTo).toEqual({ name: 'Club', email: 'club@example.com' });
    expect(body.memo).toBe('BPM Core Oct 1, Oct 8 - Lin');
  });

  it('no address, no memo', async () => {
    seedGroup('bpm', { name: 'BPM Core', ownerMemberId: ADMIN_MEMBER_ID, settings: { skipDates: [], maxPlayers: 12 } });
    const body = await ask();
    expect(body.payTo).toBeNull();
    expect(body.memo).toBeNull();
  });
});
