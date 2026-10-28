import { describe, it, expect } from 'vitest';
import {
  STRINGING_FLOW,
  PLAYER_TRACK,
  isStringingStatus,
  canTransition,
  playerStageFor,
  playerStageIndex,
  playerTensionText,
  formatPriceExact,
  isValidTension,
  formatJobNo,
  TENSION_MIN_LB,
  TENSION_MAX_LB,
  type StringingStatus,
} from '../lib/stringing';

/**
 * The two rules the design encodes that are easy to implement wrongly, plus
 * the vocabulary split that keeps the bench's words off the player's screen.
 */

describe('prices and tensions as the two sides read them', () => {
  it('names one tension when the crosses are the usual +2, both when they are not', () => {
    // The request sheet's "Main + Cross" stepper is one number; a separate
    // pair is shown as the pair (docs/plans/stringing-canvas-redesign.md).
    expect(playerTensionText(26, 28)).toBe('26');
    expect(playerTensionText(26, 30)).toBe('26/30');
    expect(playerTensionText(28, 28)).toBe('28/28');
  });

  it('formats the exact price only through the stringer-facing helper', () => {
    expect(formatPriceExact(3000)).toBe('$30.00');
    expect(formatPriceExact(null)).toBeNull();
  });
});

describe('the player never sees the bench vocabulary', () => {
  it('maps every bench status to a player stage', () => {
    for (const status of STRINGING_FLOW) {
      expect(PLAYER_TRACK).toContain(playerStageFor(status));
    }
  });

  it('keeps requested apart from received: a racket still in the bag is not "with" anybody', () => {
    // The two were folded together when every job began with a racket handed
    // over in person. The request sheet is now the main way a job starts, and
    // a player who filed one from the sofa read "With Grant" about a racket
    // still in their bag (audit 2026-10-11, finding 03).
    expect(playerStageFor('requested')).toBe('awaiting_dropoff');
    expect(playerStageFor('received')).toBe('with_stringer');
    expect(playerStageIndex('requested')).toBeLessThan(playerStageIndex('received'));
  });

  it('shares no vocabulary between the two audiences', () => {
    // A word in both lists means a bench status has leaked to the player, or a
    // player stage has been reused as a workflow step. Either way the wall the
    // whole design rests on is gone.
    //
    // This is a TYPE-SAFETY assertion as much as a copy one: overlapping
    // string-literal unions are mutually assignable, so an overlap means the
    // compiler stops catching `job.status` passed where a stage belongs. It
    // caught exactly that on `ready`, which is now `ready_for_you`.
    const overlap = (STRINGING_FLOW as readonly string[]).filter((s) =>
      (PLAYER_TRACK as readonly string[]).includes(s),
    );
    expect(overlap).toEqual([]);
  });

  it('advances the track monotonically along the bench flow', () => {
    const indices = STRINGING_FLOW.map(playerStageIndex);
    for (let i = 1; i < indices.length; i++) {
      expect(indices[i]).toBeGreaterThanOrEqual(indices[i - 1]);
    }
    expect(indices[indices.length - 1]).toBe(PLAYER_TRACK.length - 1);
  });
});

describe('status transitions', () => {
  it('allows going backwards, because the bench does', () => {
    // A racket gets handed back before it is paid for; a row gets tapped by
    // mistake. A forward-only machine would make the app wrong about the
    // physical world and offer no way to say so. `history` carries the truth.
    expect(canTransition('ready', 'received')).toBe(true);
    expect(canTransition('picked_up', 'requested')).toBe(true);
  });

  it('still rejects anything that is not a known status', () => {
    expect(isStringingStatus('lost_it')).toBe(false);
    expect(isStringingStatus('')).toBe(false);
    expect(isStringingStatus(undefined)).toBe(false);
    expect(canTransition('ready', 'lost_it' as StringingStatus)).toBe(false);
  });
});

describe('tension bounds are the bench’s, not the recommender’s', () => {
  it('accepts what a machine can actually be set to', () => {
    // Deliberately wider than lib/tension.ts's advisory 20–30. That range
    // bounds a suggestion made to someone who has not chosen; this one bounds
    // a real job. Narrowing it here would refuse a correct request.
    expect(TENSION_MIN_LB).toBe(18);
    expect(TENSION_MAX_LB).toBe(32);
    expect(isValidTension(18)).toBe(true);
    expect(isValidTension(32)).toBe(true);
  });

  it('rejects out-of-range, fractional and non-numeric values', () => {
    expect(isValidTension(17)).toBe(false);
    expect(isValidTension(33)).toBe(false);
    expect(isValidTension(26.5)).toBe(false);
    expect(isValidTension('26')).toBe(false);
    expect(isValidTension(NaN)).toBe(false);
  });
});

describe('job numbers are labels, not identifiers', () => {
  it('formats the design’s example', () => {
    expect(formatJobNo(42)).toBe('J-0042');
  });

  it('stays printable for values outside the happy path', () => {
    expect(formatJobNo(0)).toBe('J-0000');
    expect(formatJobNo(-5)).toBe('J-0000');
    expect(formatJobNo(12345)).toBe('J-12345');
  });
});
