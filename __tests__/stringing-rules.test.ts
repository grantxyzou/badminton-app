import { describe, it, expect } from 'vitest';
import {
  STRINGING_FLOW,
  PLAYER_TRACK,
  isStringingStatus,
  canTransition,
  playerStageFor,
  playerStageIndex,
  priceBand,
  formatPriceBand,
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

describe('the price band actually hides the price', () => {
  it('reproduces the design: $30.00 shows as $28–32', () => {
    expect(formatPriceBand(priceBand(3000))).toBe('$28–32');
  });

  it('does NOT let a player recover the exact price from the band', () => {
    // THE WHOLE POINT. The obvious reading of "$30 → $28–32" is a symmetric
    // ±$2 margin — and a symmetric band's midpoint IS the price, so every
    // player could just average the two numbers and read it straight off.
    //
    // Snapping to a fixed grid means several real prices share one band, so
    // the band genuinely carries less information than the price does.
    const sameBand = [2800, 2900, 3000, 3100].map((c) => formatPriceBand(priceBand(c)));
    expect(new Set(sameBand).size).toBe(1);
    expect(sameBand[0]).toBe('$28–32');

    // And the midpoint of the band is NOT the price for most members of it.
    const midpoint = (2800 + 3200) / 2;
    expect([2800, 2900, 3100].every((c) => c !== midpoint)).toBe(true);
  });

  it('never reports a band narrower than the grid', () => {
    for (const cents of [0, 1, 99, 100, 2799, 2800, 999999]) {
      const band = priceBand(cents)!;
      expect(band.highCents - band.lowCents).toBe(400);
      // The real price is always inside the band it is shown as.
      expect(cents).toBeGreaterThanOrEqual(band.lowCents);
      expect(cents).toBeLessThan(band.highCents);
    }
  });

  it('distinguishes "not quoted yet" from "quoted at nothing"', () => {
    // null is not a band around zero — the UI says different things for
    // "Grant hasn't priced this" and "this one's free".
    expect(priceBand(null)).toBeNull();
    expect(priceBand(undefined)).toBeNull();
    expect(priceBand(-1)).toBeNull();
    expect(formatPriceBand(priceBand(0))).toBe('$0–4');
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

  it('collapses requested and received into one player-visible stage', () => {
    // The difference is bench bookkeeping — whether the racket is physically in
    // hand. Surfacing it would have a player who handed the racket over in
    // person wondering why their job is "only requested".
    expect(playerStageFor('requested')).toBe(playerStageFor('received'));
    expect(playerStageFor('requested')).toBe('with_stringer');
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
