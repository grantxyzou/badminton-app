import { describe, it, expect, beforeEach } from 'vitest';
import { POST as settle } from '@/app/api/session/settle/route';
import { POST as advance } from '@/app/api/session/advance/route';
import { clubRunOf, parseClubRun, applyStyle, withSetting, isOrganiserFee } from '@/lib/clubRun';
import { costSplit, type SplitPlayer } from '@/lib/sessionCost';
import { buildReceiptInput } from '@/lib/buildReceiptInput';
import { breakdownRows, receiptHeight, renderGroupText, RECEIPT_H, type ReceiptInput } from '@/lib/receiptTemplate';
import type { Session } from '@/lib/types';
import {
  resetMockStore,
  setupAdminPin,
  makeAdminRequest,
  seedPointer,
  seedSession,
  seedPlayer,
  seedGroup,
  getStore,
  seedAdminMember,
} from './helpers';

/**
 * THE ORGANISER FEE (docs/plans/organiser-fee.md): a per-player amount a club
 * adds to every share of a priced session, however the player pays. Default
 * $0, so nothing changes until an organiser types a number; copied onto the
 * session at advance so a change never moves a bill already out.
 */

const SID = 'session-2026-05-04';
const run = (fee?: number) => ({ playersPerCourt: null, money: 'split', membersFirst: null, guests: 0, ...(fee === undefined ? {} : { organiserFee: fee }) });
const p = (over: Partial<SplitPlayer> & { name?: string } = {}) => ({ name: 'x', removed: false, ...over });

describe('the setting', () => {
  it('is $0 for a club that never set it, and for BPM with no run at all', () => {
    expect(clubRunOf(undefined).organiserFee).toBe(0);
    expect(clubRunOf({ run: run() }).organiserFee).toBe(0);
    expect(clubRunOf({ run: run(1.5) }).organiserFee).toBe(1.5);
  });

  it('accepts dollars to the cent up to $20, and refuses anything else', () => {
    for (const ok of [0, 1, 1.1, 1.5, 2.25, 20]) expect(isOrganiserFee(ok)).toBe(true);
    for (const bad of [-1, 20.01, 1.005, Number.NaN, '2', null]) expect(isOrganiserFee(bad)).toBe(false);
    expect(parseClubRun(run(1.75))?.organiserFee).toBe(1.75);
    expect(parseClubRun(run(-1))).toBeNull();
    expect(parseClubRun(run(25))).toBeNull();
  });

  it('a save that does not name it keeps the club’s fee (an older screen cannot zero it)', () => {
    expect(parseClubRun(run(), { organiserFee: 1.5 })?.organiserFee).toBe(1.5);
  });

  it('is not part of a style: a fee keeps the style, and picking a style keeps the fee', () => {
    const withFee = withSetting(clubRunOf({ run: run() }), 'organiserFee', 2);
    expect(withFee.style).toBe('first_come');
    expect(applyStyle('members_first', withFee).organiserFee).toBe(2);
  });
});

describe('costSplit', () => {
  const session = (fee?: number) => ({ costPerCourt: 30, courts: 2, ...(fee === undefined ? {} : { organiserFee: fee }) });

  it('adds the fee to every share and reports it beside costPerPerson', () => {
    const split = costSplit(session(1.5), [p(), p(), p(), p()]);
    expect(split.costPerPerson).toBe(16.5); // $60 / 4 + $1.50
    expect(split.organiserFee).toBe(1.5);
    expect(split.totalCost).toBe(60); // the night's cost is unchanged
  });

  it('a session with no fee splits exactly as before', () => {
    expect(costSplit(session(), [p(), p(), p(), p()])).toMatchObject({ costPerPerson: 15, organiserFee: 0 });
  });

  it('charges no fee on an unpriced night', () => {
    expect(costSplit({ costPerCourt: 0, courts: 2, organiserFee: 1.5 }, [p(), p()])).toMatchObject({ costPerPerson: 0, organiserFee: 0 });
  });

  it('a resplit cover spreads the cost share, never the fee; an absorb cover forgives the fee with the share', () => {
    const resplit = costSplit(session(1.5), [p(), p(), p({ writtenOff: true, coverMode: 'resplit' })]);
    expect(resplit.costPerPerson).toBe(31.5); // $60 / 2 + $1.50
    const absorb = costSplit(session(1.5), [p(), p(), p(), p({ writtenOff: true, coverMode: 'absorb' })]);
    expect(absorb.costPerPerson).toBe(16.5);
    expect(absorb.coveredTotal).toBe(16.5);
  });
});

describe('advance copies the club’s fee onto the new session', () => {
  beforeEach(() => {
    setupAdminPin();
    resetMockStore();
    seedAdminMember();
    seedPointer(SID);
    seedSession(SID, { costPerCourt: 30, courts: 2 });
  });
  const advanceOnce = async () => {
    const res = await advance(
      makeAdminRequest('POST', 'http://localhost:3000/api/session/advance', {
        datetime: '2026-05-11T20:00:00-04:00',
        deadline: '2026-05-11T18:00:00-04:00',
        courts: 2,
        maxPlayers: 12,
      }),
    );
    expect(res.status).toBe(201);
    return (await res.json()) as Session;
  };

  it('copies a set fee', async () => {
    seedGroup('bpm', { settings: { skipDates: [], maxPlayers: 12, run: run(1.5) } });
    expect((await advanceOnce()).organiserFee).toBe(1.5);
  });

  it('writes nothing at $0, and nothing for a club that keeps its money outside the app', async () => {
    seedGroup('bpm', { settings: { skipDates: [], maxPlayers: 12, run: run(0) } });
    expect((await advanceOnce()).organiserFee).toBeUndefined();
    resetMockStore();
    seedAdminMember();
    seedPointer(SID);
    seedSession(SID, { costPerCourt: 30, courts: 2 });
    seedGroup('bpm', { settings: { skipDates: [], maxPlayers: 12, run: { ...run(2), money: 'off' } } });
    expect((await advanceOnce()).organiserFee).toBeUndefined();
  });
});

describe('settle freezes the fee into the bill', () => {
  beforeEach(() => {
    setupAdminPin();
    resetMockStore();
    seedAdminMember();
    seedPointer(SID);
    seedSession(SID, { costPerCourt: 30, courts: 2, organiserFee: 1.5 });
  });

  it('stamps every row with share + fee and records the fee on the snapshot', async () => {
    for (const n of ['Alice', 'Bob', 'Carol', 'Dan']) seedPlayer(SID, n);
    const res = await settle(makeAdminRequest('POST', 'http://localhost:3000/api/session/settle'));
    expect(res.status).toBe(200);
    const { settled } = await res.json();
    expect(settled).toMatchObject({ costPerPerson: 16.5, totalCost: 60, organiserFee: 1.5, playerCount: 4 });
    const rows = (getStore()['players'] as Array<{ owedAmount?: number }>).map((r) => r.owedAmount);
    expect(rows).toEqual([16.5, 16.5, 16.5, 16.5]);
  });
});

describe('the receipt shows the fee as its own line', () => {
  const recipient = { name: 'Grant', email: 'pay@example.com' };
  const session = { id: SID, title: 't', datetime: '2026-05-04T19:00:00-07:00', costPerCourt: 30, courts: 2 } as Session;

  it('Split → Organiser fee → Per person, and the text says what is included', () => {
    const build = buildReceiptInput({ ...session, organiserFee: 1.5 }, [p({ name: 'A' }), p({ name: 'B' }), p({ name: 'C' }), p({ name: 'D' })], recipient);
    const input = build.input!;
    expect(build.costPerPerson).toBe(16.5);
    expect(breakdownRows(input).map((r) => [r.label, r.amount])).toEqual([
      ['2 courts × $30', '$60'],
      ['Total', '$60'],
      ['Split 4 ways', '$15 each'],
      ['Organiser fee', '$1.50 each'],
      ['Per person', '$16.50'],
    ]);
    expect(renderGroupText(input)).toContain('includes a $1.50 organiser fee each');
  });

  it('a settled bill reads the frozen fee, not today’s setting', () => {
    const settled = { ...session, settled: { at: 'x', costPerPerson: 16.5, totalCost: 60, courtTotal: 60, birdTotal: 0, playerCount: 4, playerNames: [], organiserFee: 1.5 } };
    expect(buildReceiptInput(settled, [], recipient).input!.breakdown!.organiserFee).toBe(1.5);
  });

  it('without a fee the receipt is unchanged, and keeps its 3:4 size', () => {
    const input = buildReceiptInput(session, [p({ name: 'A' }), p({ name: 'B' })], recipient).input!;
    expect(breakdownRows(input).map((r) => r.label)).toEqual(['2 courts × $30', 'Total', 'Split 2 ways']);
    expect(receiptHeight(input)).toBe(RECEIPT_H);
  });

  it('grows to fit rather than running into the footer when a fee meets a Wealthsimple handle', () => {
    const input: ReceiptInput = {
      ...buildReceiptInput({ ...session, birdUsages: [], organiserFee: 1.5 }, [p({ name: 'A' }), p({ name: 'B' })], recipient).input!,
      recipient: { ...recipient, wealthsimple: '$grant' },
      breakdown: { courtTotal: 60, costPerCourt: 30, birdTotal: 12, tubes: 1, splitCount: 2, organiserFee: 1.5 },
    };
    expect(receiptHeight(input)).toBeGreaterThan(RECEIPT_H);
  });
});
