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
