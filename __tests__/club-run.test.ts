import { describe, it, expect } from 'vitest';
import {
  applyStyle,
  capacityForCourts,
  clubRunOf,
  courtLine,
  playersPerCourtFor,
  parseClubRun,
  styleOf,
  withSetting,
  CLUB_STYLES,
} from '../lib/clubRun';

/**
 * How a club runs (lib/clubRun.ts; docs/plans/six-feathers-onboarding.md).
 * The rule that matters most: a club with no `run` is BPM Core, unchanged.
 */
describe('clubRunOf', () => {
  it('reads a club with no settings as BPM runs today', () => {
    for (const settings of [undefined, null, {}, { run: null }, { run: 'members_first' }]) {
      expect(clubRunOf(settings)).toEqual({ style: 'first_come', playersPerCourt: null, money: 'split' });
    }
  });

  it('keeps every stored value, including an explicit null', () => {
    expect(clubRunOf({ run: { style: 'custom', playersPerCourt: 6, money: 'off' } })).toEqual({
      style: 'custom',
      playersPerCourt: 6,
      money: 'off',
    });
    expect(clubRunOf({ run: { style: 'members_first', playersPerCourt: null, money: 'off' } }).playersPerCourt).toBeNull();
  });

  it("fills a gap from the club's own style, so a setting added later follows the style it chose", () => {
    expect(clubRunOf({ run: { style: 'members_first' } })).toEqual(applyStyle('members_first'));
    // A custom club, or a corrupt value, falls back to how BPM runs.
    expect(clubRunOf({ run: { style: 'custom' } })).toEqual({ style: 'custom', playersPerCourt: null, money: 'split' });
    expect(clubRunOf({ run: { style: 'members_first', playersPerCourt: 99, money: 'maybe' } })).toEqual(
      applyStyle('members_first'),
    );
  });
});

describe('styles', () => {
  it('a style writes all of its values', () => {
    expect(applyStyle('members_first')).toEqual({ style: 'members_first', ...CLUB_STYLES.members_first.values });
    expect(applyStyle('first_come')).toEqual({ style: 'first_come', ...CLUB_STYLES.first_come.values });
  });

  it('changing one setting turns a style custom, and changing it back restores the style', () => {
    const custom = withSetting(applyStyle('members_first'), 'playersPerCourt', 6);
    expect(custom.style).toBe('custom');
    expect(withSetting(custom, 'playersPerCourt', 8).style).toBe('members_first');
    expect(withSetting(applyStyle('first_come'), 'money', 'off').style).toBe('custom');
  });

  it('no two styles share their values, so a style can always be read back from them', () => {
    const seen = new Set(Object.values(CLUB_STYLES).map((s) => JSON.stringify(s.values)));
    expect(seen.size).toBe(Object.keys(CLUB_STYLES).length);
    for (const [name, s] of Object.entries(CLUB_STYLES)) expect(styleOf(s.values)).toBe(name);
  });
});

describe('parseClubRun', () => {
  it('derives the style from the values, never from the request', () => {
    expect(parseClubRun({ style: 'first_come', playersPerCourt: 8, money: 'off' })).toEqual(applyStyle('members_first'));
    expect(parseClubRun({ playersPerCourt: 4, money: 'split' })).toEqual({ style: 'custom', playersPerCourt: 4, money: 'split' });
  });

  it('refuses a partial, unknown or out-of-range value', () => {
    for (const bad of [
      null,
      [],
      'members_first',
      { money: 'off' },
      { playersPerCourt: 8 },
      { playersPerCourt: 1, money: 'off' },
      { playersPerCourt: 13, money: 'off' },
      { playersPerCourt: 7.5, money: 'off' },
      { playersPerCourt: 8, money: 'flat' },
      { playersPerCourt: 8, money: 'off', guests: 2 },
    ]) {
      expect(parseClubRun(bad)).toBeNull();
    }
  });
});

describe('capacityForCourts', () => {
  const sf = applyStyle('members_first');
  it('is courts × players per court, inside the 1–100 the session accepts', () => {
    expect(capacityForCourts(4, sf)).toBe(32);
    expect(capacityForCourts(5, sf)).toBe(40);
    expect(capacityForCourts(20, sf)).toBe(100);
  });

  it('says nothing when the cap is typed by hand or there are no courts', () => {
    expect(capacityForCourts(4, applyStyle('first_come'))).toBeNull();
    expect(capacityForCourts(null, sf)).toBeNull();
    expect(capacityForCourts(0, sf)).toBeNull();
  });
});

/** docs/plans/waitlist-court-line.md: how close the waitlist is to another court. */
describe('playersPerCourtFor', () => {
  const bpm = clubRunOf(undefined);
  it("uses the club's own players per court when it sets one", () => {
    expect(playersPerCourtFor({ courts: 4, maxPlayers: 30 }, applyStyle('members_first'))).toBe(8);
  });
  it('divides the cap by the courts for BPM (6 per court)', () => {
    expect(playersPerCourtFor({ courts: 2, maxPlayers: 12 }, bpm)).toBe(6);
  });
  it('says nothing when the cap does not divide evenly', () => {
    expect(playersPerCourtFor({ courts: 2, maxPlayers: 13 }, bpm)).toBeNull();
  });
  it('says nothing without courts or a cap', () => {
    for (const s of [null, undefined, {}, { courts: 0, maxPlayers: 12 }, { courts: 2 }, { maxPlayers: 12 }]) {
      expect(playersPerCourtFor(s, bpm)).toBeNull();
    }
  });
});

describe('courtLine', () => {
  const bpm = clubRunOf(undefined);
  const session = { courts: 2, maxPlayers: 12 };
  const wait = (n: number) => Array.from({ length: n }, () => ({ waitlisted: true }));

  it('counts how many more would fill a court', () => {
    expect(courtLine(session, bpm, [...wait(3), { waitlisted: false }])).toEqual({ perCourt: 6, waiting: 3, more: 3 });
  });
  it("reads a court's worth once the waitlist reaches it", () => {
    expect(courtLine(session, bpm, wait(8))).toEqual({ perCourt: 6, waiting: 8, more: 0 });
  });
  it('leaves out removed and held-for-unpaid rows, which would not move up', () => {
    const rows = [...wait(2), { waitlisted: true, removed: true }, { waitlisted: true, heldForUnpaid: true }];
    expect(courtLine(session, bpm, rows)).toEqual({ perCourt: 6, waiting: 2, more: 4 });
  });
  it('is null when a court cannot be worked out', () => {
    expect(courtLine({ courts: 2, maxPlayers: 13 }, bpm, wait(3))).toBeNull();
  });
});
