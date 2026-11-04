import { describe, expect, it } from 'vitest';
import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { RACKET_LOOKS } from '../lib/racketLook';
import { RACKET_LIVERIES, bandWeight, headColour, liveryProblems, sampleStops, shapeFromMeasure, type Livery } from '../lib/racketLivery';
import { modelInputs } from '../lib/racketCustom';

/**
 * The accurate renders (`docs/plans/racket-fidelity.md`): each catalog racket's
 * paint as a livery, painted by `lib/racketModel.ts`. These pin the table and
 * the maths the model paints with; the images themselves are pinned by
 * `racket-look.test.ts`.
 */

const near = (a: readonly number[], b: readonly number[]) => a.every((v, i) => Math.abs(v - b[i]) < 1e-6);

describe('the livery table', () => {
  it('names only catalog rackets, so a livery can never paint a racket that is not there', () => {
    expect(Object.keys(RACKET_LIVERIES).filter((id) => !RACKET_LOOKS[id])).toEqual([]);
  });

  it('every entry is well formed: hex colours, ordered stops, angles in range, a measured shape, a source', () => {
    const bad = Object.entries(RACKET_LIVERIES).flatMap(([id, l]) => liveryProblems(l).map((p) => `${id}: ${p}`));
    expect(bad).toEqual([]);
  });

  it('rides with three.js: only the model imports it, never a module the main bundle loads', () => {
    // The table is a few hundred lines of paint; the list images already show
    // it, so only the 3D model needs it. racketCustom passes the id, not the livery.
    for (const f of ['lib/racketLook.ts', 'lib/racketCustom.ts', 'lib/memberAvatar.ts']) {
      expect(readFileSync(join(process.cwd(), f), 'utf8'), f).not.toMatch(/from ['"](@\/lib|\.)\/racketLivery['"]/);
    }
  });
});

describe('livery maths', () => {
  const l: Livery = {
    source: 'test',
    head: [[0, '#000000'], [1, '#ffffff']],
    shaft: '#000000',
    grip: '#000000',
  };

  it('a fade up the head is sampled by height', () => {
    expect(near(headColour(l, 0, 0), [0, 0, 0])).toBe(true);
    expect(near(headColour(l, 0, 1), [1, 1, 1])).toBe(true);
    expect(near(sampleStops(l.head, 0.5), [0.5, 0.5, 0.5])).toBe(true);
  });

  it('a split livery paints the left half its own colour', () => {
    const split: Livery = { ...l, head: '#ff0000', left: '#0000ff' };
    expect(near(headColour(split, 0, 0.5), [1, 0, 0])).toBe(true);
    expect(near(headColour(split, 180, 0.5), [0, 0, 1])).toBe(true);
    expect(near(headColour(split, -180, 0.5), [0, 0, 1])).toBe(true);
  });

  it('a band covers its arc, and one written from > to wraps through ±180', () => {
    const crown = { from: 80, to: 100, colour: '#ffffff', soft: 2 };
    expect(bandWeight(crown, 90)).toBe(1);
    expect(bandWeight(crown, 60)).toBe(0);
    expect(bandWeight(crown, -90)).toBe(0);
    const left = { from: 150, to: -150, colour: '#ffffff', soft: 2 };
    expect(bandWeight(left, 180)).toBe(1);
    expect(bandWeight(left, -170)).toBe(1);
    expect(bandWeight(left, 0)).toBe(0);
    expect(bandWeight(left, 120)).toBe(0);
  });

  it('a measured outline comes back the size that was measured', () => {
    const frameHalf = 0.0039;
    const len = 0.249;
    const s = shapeFromMeasure({ ratio: 0.774, widest: 0.578 }, len, frameHalf);
    expect(s.ryTop + s.ryBot).toBeCloseTo(len, 6);
    expect((2 * s.rx + 2 * frameHalf) / (len + 2 * frameHalf)).toBeCloseTo(0.774, 6);
    expect((s.ryTop + frameHalf) / (len + 2 * frameHalf)).toBeCloseTo(0.578, 6);
  });

  it('liveryProblems names a bad colour and an out-of-range shape', () => {
    expect(liveryProblems({ ...l, grip: 'black' })).toContain('colour black');
    expect(liveryProblems({ ...l, shape: { ratio: 0.5, widest: 0.55 } })).toContain('ratio 0.5');
  });
});

describe('the model is told which racket it paints', () => {
  it('modelInputs passes the catalog id through, and only that', () => {
    const base = RACKET_LOOKS['racket-li-ning-halbertec-9000'];
    expect(modelInputs(base, undefined, 'racket-li-ning-halbertec-9000').look.liveryId).toBe('racket-li-ning-halbertec-9000');
    expect(modelInputs(base, undefined).look.liveryId).toBeNull();
  });
});
