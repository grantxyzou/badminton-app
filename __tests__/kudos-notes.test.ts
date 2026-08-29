import { describe, it, expect } from 'vitest';
import {
  normalizeNote,
  visibleNotes,
  isoWeekKey,
  aggregateKudos,
  KUDOS_NOTE_MAX,
  type KudosDoc,
} from '@/lib/kudos';

/**
 * The kudos redesign (2026-08-29), from real user feedback: a player could not
 * find how to give kudos at all, and kudos vanished the moment the session
 * advanced.
 *
 * These cover the two rules that are easy to break silently — the attribution
 * exception, and the dedupe unit that replaced "per session" once eligibility
 * stopped being session-scoped.
 */

function doc(over: Partial<KudosDoc> = {}): KudosDoc {
  return {
    id: 'k1',
    recipientMemberId: 'm-recipient',
    recipientName: '[name-redacted]',
    raterMemberId: 'm-rater',
    raterName: 'Lin',
    sessionId: 'session-2026-08-27',
    tag: 'most_improved',
    createdAt: '2026-08-27T12:00:00.000Z',
    ...over,
  };
}

describe('normalizeNote', () => {
  it('trims, and treats blank as absent so a signed blank line is impossible', () => {
    expect(normalizeNote('  nice net play  ')).toBe('nice net play');
    expect(normalizeNote('   ')).toBeUndefined();
    expect(normalizeNote('')).toBeUndefined();
  });

  it('ignores non-strings rather than coercing them', () => {
    expect(normalizeNote(undefined)).toBeUndefined();
    expect(normalizeNote(null)).toBeUndefined();
    expect(normalizeNote(42)).toBeUndefined();
    expect(normalizeNote({ note: 'x' })).toBeUndefined();
  });

  it('bounds the length', () => {
    const long = 'x'.repeat(KUDOS_NOTE_MAX + 50);
    expect(normalizeNote(long)).toHaveLength(KUDOS_NOTE_MAX);
  });
});

describe('visibleNotes — the ONE path that carries a name', () => {
  it('signs a noted kudos', () => {
    const [n] = visibleNotes([doc({ note: 'your net play got sharper' })]);
    expect(n.raterName).toBe('Lin');
    expect(n.note).toBe('your net play got sharper');
    expect(n.tag).toBe('most_improved');
  });

  /**
   * THE ATTRIBUTION RULE. Tags stay anonymous; only a note is signed. An
   * unsigned tag must not become attributable just because it sits beside one
   * that is.
   */
  it('drops kudos with NO note, so a bare tag never becomes attributable', () => {
    const out = visibleNotes([
      doc({ id: 'a', tag: 'clutch' }),
      doc({ id: 'b', tag: 'nice_shot', note: 'that cross-court' }),
      doc({ id: 'c', tag: 'good_sport', note: '   ' }),
    ]);
    expect(out).toHaveLength(1);
    expect(out[0].note).toBe('that cross-court');
  });

  it('never carries raterMemberId — the field does not exist on the type', () => {
    const [n] = visibleNotes([doc({ note: 'good game' })]);
    expect(JSON.stringify(n)).not.toContain('m-rater');
    expect(JSON.stringify(n)).not.toContain('raterMemberId');
  });

  it('carries the skill only when one was chosen', () => {
    const [withSkill] = visibleNotes([doc({ note: 'x', skillKey: 'net_play' })]);
    const [without] = visibleNotes([doc({ note: 'x' })]);
    expect(withSkill.skillKey).toBe('net_play');
    expect('skillKey' in without).toBe(false);
  });

  it('is newest first', () => {
    const out = visibleNotes([
      doc({ id: 'old', note: 'older', createdAt: '2026-08-01T00:00:00.000Z' }),
      doc({ id: 'new', note: 'newer', createdAt: '2026-08-28T00:00:00.000Z' }),
    ]);
    expect(out.map((n) => n.note)).toEqual(['newer', 'older']);
  });

  /** The aggregate path is untouched by any of this. */
  it('aggregateKudos still returns counts only, notes or not', () => {
    const counts = aggregateKudos([doc({ note: 'signed' }), doc({ tag: 'clutch' })]);
    expect(JSON.stringify(counts)).not.toContain('Lin');
    expect(counts).toEqual([
      { tag: 'clutch', count: 1 },
      { tag: 'most_improved', count: 1 },
    ]);
  });
});

describe('isoWeekKey — the dedupe unit', () => {
  it('gives the same key for two days in one ISO week', () => {
    // Thu 2026-08-27 and Sat 2026-08-29 are the same ISO week.
    expect(isoWeekKey('2026-08-27T12:00:00.000Z')).toBe(isoWeekKey('2026-08-29T12:00:00.000Z'));
  });

  it('gives different keys across a week boundary', () => {
    // Sunday closes an ISO week; Monday opens the next.
    expect(isoWeekKey('2026-08-30T12:00:00.000Z')).not.toBe(isoWeekKey('2026-08-31T12:00:00.000Z'));
  });

  it('formats as YYYY-Www', () => {
    expect(isoWeekKey('2026-08-27T12:00:00.000Z')).toMatch(/^\d{4}-W\d{2}$/);
  });

  it('does not throw on a bad date', () => {
    expect(isoWeekKey('not-a-date')).toBe('invalid');
  });
});
