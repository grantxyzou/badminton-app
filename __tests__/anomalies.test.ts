import { describe, it, expect } from 'vitest';
import { detectSettingsDrift, detectLongBreak, detectSkipDate, evaluateAnomalies } from '@/lib/anomalies';
import type { Session, PrevSessionSnapshot } from '@/lib/types';

const makeSession = (overrides: Partial<Session> = {}): Session => ({
  id: 'session-2026-05-13',
  title: 'Test',
  datetime: '2026-05-13T20:00:00-04:00',
  deadline: '2026-05-13T18:00:00-04:00',
  courts: 2,
  maxPlayers: 12,
  costPerCourt: 32,
  ...overrides,
});

const makeSnapshot = (overrides: Partial<PrevSessionSnapshot> = {}): PrevSessionSnapshot => ({
  courtCount: 2,
  costPerCourt: 32,
  maxPlayers: 12,
  deadlineOffsetHours: -2,
  signupOpensOffsetHours: 0,
  ...overrides,
});

describe('detectSettingsDrift', () => {
  it('returns no codes when settings match snapshot', () => {
    expect(detectSettingsDrift(makeSession(), makeSnapshot())).toEqual([]);
  });

  it('returns cost_changed when costPerCourt differs', () => {
    expect(detectSettingsDrift(makeSession({ costPerCourt: 40 }), makeSnapshot({ costPerCourt: 32 })))
      .toContain('cost_changed');
  });

  it('returns courts_changed when courts differs', () => {
    expect(detectSettingsDrift(makeSession({ courts: 3 }), makeSnapshot({ courtCount: 2 })))
      .toContain('courts_changed');
  });

  it('returns max_players_changed when maxPlayers differs', () => {
    expect(detectSettingsDrift(makeSession({ maxPlayers: 16 }), makeSnapshot({ maxPlayers: 12 })))
      .toContain('max_players_changed');
  });

  /**
   * THE ONE THIS SET WAS MISSING, found in production on 2026-08-28.
   *
   * The Sep 3 session closed sign-ups on Tuesday when every prior week closed
   * on Wednesday — a full day less to sign up — and nothing said a word,
   * because the snapshot RECORDED `deadlineOffsetHours` and `SetupPage`
   * DISPLAYED it while no code ever compared it. maxPlayers going 11 -> 12
   * raised a warning in the same doc; a deadline moving a day did not.
   */
  it('returns deadline_changed when sign-ups close a day earlier than last week', () => {
    // Session Thu 20:00; last week closed 23h before (Wed 21:00). This one
    // closes Tue 21:00 — 47h before.
    const session = makeSession({
      datetime: '2026-09-03T20:00:00-07:00',
      deadline: '2026-09-01T21:00:00-07:00',
    });
    expect(detectSettingsDrift(session, makeSnapshot({ deadlineOffsetHours: -23 })))
      .toContain('deadline_changed');
  });

  it('ignores a small shift, so a DST hour or a tidied time is not an alarm', () => {
    // A weekly session crossing a DST boundary moves the wall-clock offset by
    // exactly an hour through nobody's decision. Flagging that would teach
    // someone to dismiss this warning without reading it.
    const session = makeSession({
      datetime: '2026-09-03T20:00:00-07:00',
      deadline: '2026-09-02T20:00:00-07:00', // 24h before
    });
    expect(detectSettingsDrift(session, makeSnapshot({ deadlineOffsetHours: -23 })))
      .not.toContain('deadline_changed');
  });

  it('says nothing when the deadline keeps its usual distance', () => {
    const session = makeSession({
      datetime: '2026-09-03T20:00:00-07:00',
      deadline: '2026-09-02T21:00:00-07:00', // exactly 23h before
    });
    expect(detectSettingsDrift(session, makeSnapshot({ deadlineOffsetHours: -23 }))).toEqual([]);
  });

  /**
   * THE OTHER DIRECTION, found in review on 2026-10-21. The first cut
   * compared only when BOTH sides had a deadline, so a deadline that was
   * there last week and is gone this week — sign-ups that used to close now
   * stay open — was never mentioned. Presence against absence fires with no
   * tolerance: the tolerance exists for DST, and nothing about DST removes a
   * deadline.
   */
  it('flags a deadline removed since the snapshot', () => {
    const session = makeSession({ deadline: undefined });
    expect(detectSettingsDrift(session, makeSnapshot({ deadlineOffsetHours: -23 })))
      .toContain('deadline_changed');
  });

  it('flags a deadline added since a snapshot that recorded none', () => {
    // 2h before — inside the tolerance, which must not apply here: last week
    // there was nothing to be within 6h of.
    expect(detectSettingsDrift(makeSession(), makeSnapshot({ deadlineOffsetHours: null })))
      .toContain('deadline_changed');
  });

  it('reads a legacy snapshot offset of 0 as "no deadline"', () => {
    // Before 2026-10-21 the advance route wrote 0 for a missing deadline, and
    // a deadline at the session's own start closes nothing anyway.
    expect(detectSettingsDrift(makeSession(), makeSnapshot({ deadlineOffsetHours: 0 })))
      .toContain('deadline_changed');
    expect(detectSettingsDrift(makeSession({ deadline: undefined }), makeSnapshot({ deadlineOffsetHours: 0 })))
      .not.toContain('deadline_changed');
  });

  it('does not flag a snapshot that never recorded the offset', () => {
    // undefined is "not recorded", not "recorded as none" — a doc from before
    // the field existed has nothing to compare, and inventing a drift would be
    // a lying warning.
    const snapshot = makeSnapshot();
    delete (snapshot as Partial<PrevSessionSnapshot>).deadlineOffsetHours;
    expect(detectSettingsDrift(makeSession(), snapshot)).not.toContain('deadline_changed');
    expect(detectSettingsDrift(makeSession({ deadline: undefined }), snapshot)).not.toContain('deadline_changed');
  });

  it('does not flag no deadline on either side', () => {
    const session = makeSession({ deadline: undefined });
    expect(detectSettingsDrift(session, makeSnapshot({ deadlineOffsetHours: null }))).toEqual([]);
  });

  it('handles missing snapshot gracefully (returns [])', () => {
    expect(detectSettingsDrift(makeSession(), undefined)).toEqual([]);
  });
});

describe('detectLongBreak', () => {
  it('returns false when gap is <= 21 days', () => {
    expect(detectLongBreak('2026-05-06T20:00:00-04:00', '2026-05-13T20:00:00-04:00')).toBe(false);
  });

  it('returns true when gap is > 21 days', () => {
    expect(detectLongBreak('2026-04-01T20:00:00-04:00', '2026-04-29T20:00:00-04:00')).toBe(true);
  });

  it('returns false when previous date is missing', () => {
    expect(detectLongBreak(undefined, '2026-05-13T20:00:00-04:00')).toBe(false);
  });
});

describe('detectSkipDate', () => {
  it('returns true when current session date matches a skip entry', () => {
    expect(detectSkipDate('2026-05-13T20:00:00-04:00', ['2026-05-13'])).toBe(true);
  });

  it('returns false when no skip entry matches', () => {
    expect(detectSkipDate('2026-05-13T20:00:00-04:00', ['2026-05-20'])).toBe(false);
  });

  it('returns false when skipDates is empty or undefined', () => {
    expect(detectSkipDate('2026-05-13T20:00:00-04:00', [])).toBe(false);
    expect(detectSkipDate('2026-05-13T20:00:00-04:00', undefined)).toBe(false);
  });
});

describe('evaluateAnomalies — deadline_changed message', () => {
  const run = (session: Session, snapshot: PrevSessionSnapshot) =>
    evaluateAnomalies({ session, prevSnapshot: snapshot, prevSessionDatetime: undefined, skipDates: undefined, dismissed: [] })
      .find((a) => a.code === 'deadline_changed')?.message ?? '';

  it('says how far it moved when both weeks had one', () => {
    const session = makeSession({ datetime: '2026-09-03T20:00:00-07:00', deadline: '2026-09-01T21:00:00-07:00' });
    const msg = run(session, makeSnapshot({ deadlineOffsetHours: -23 }));
    expect(msg).toBe('Sign-ups close 47h before this session, was 23h last week.');
  });

  it('says last week stayed open when a deadline was added', () => {
    const msg = run(makeSession(), makeSnapshot({ deadlineOffsetHours: null }));
    expect(msg).toContain('close 2h before');
    expect(msg).toContain('stayed open');
    expect(msg).not.toContain('NaN');
  });

  it('says this week stays open when a deadline was removed', () => {
    const msg = run(makeSession({ deadline: undefined }), makeSnapshot({ deadlineOffsetHours: -23 }));
    expect(msg).toContain('stay open this week');
    expect(msg).toContain('23h');
    expect(msg).not.toContain('NaN');
  });
});

describe('evaluateAnomalies', () => {
  it('aggregates all checks into a list of anomaly objects', () => {
    const result = evaluateAnomalies({
      session: makeSession({ costPerCourt: 40, datetime: '2026-05-20T20:00:00-04:00' }),
      prevSnapshot: makeSnapshot({ costPerCourt: 32 }),
      prevSessionDatetime: '2026-05-13T20:00:00-04:00',
      skipDates: ['2026-05-20'],
      dismissed: [],
    });

    const codes = result.map((a) => a.code);
    expect(codes).toContain('cost_changed');
    expect(codes).toContain('skip_date');
    expect(codes).not.toContain('long_break');
  });

  it('filters out dismissed codes', () => {
    const result = evaluateAnomalies({
      session: makeSession({ costPerCourt: 40 }),
      prevSnapshot: makeSnapshot({ costPerCourt: 32 }),
      prevSessionDatetime: undefined,
      skipDates: undefined,
      dismissed: ['cost_changed'],
    });
    expect(result).toEqual([]);
  });

  it('marks skip_date as blocking severity', () => {
    const result = evaluateAnomalies({
      session: makeSession({ datetime: '2026-05-20T20:00:00-04:00' }),
      prevSnapshot: undefined,
      prevSessionDatetime: undefined,
      skipDates: ['2026-05-20'],
      dismissed: [],
    });
    expect(result.find((a) => a.code === 'skip_date')?.severity).toBe('blocking');
  });

  it('marks settings drift and long_break as warning severity', () => {
    const result = evaluateAnomalies({
      session: makeSession({ costPerCourt: 40, datetime: '2026-04-29T20:00:00-04:00' }),
      prevSnapshot: makeSnapshot({ costPerCourt: 32 }),
      prevSessionDatetime: '2026-04-01T20:00:00-04:00',
      skipDates: undefined,
      dismissed: [],
    });
    expect(result.find((a) => a.code === 'cost_changed')?.severity).toBe('warning');
    expect(result.find((a) => a.code === 'long_break')?.severity).toBe('warning');
  });
});
