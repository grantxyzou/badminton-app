import { describe, it, expect, beforeEach } from 'vitest';
import { GET as CLUB_TENSION } from '../app/api/stats/club/tension/route';
import { resetMockStore, setupAdminPin, makeRequest, getStore } from './helpers';
import { tallyClubTension, clubTensionFor } from '../lib/clubTension';
import type { PlayerGear } from '../lib/types';

/**
 * "The club strings this frame 24–27 lb" — a band per racket frame, built from
 * frame, string and tension only, and never below three members.
 */

const FRAME = 'racket-li-ning-air-force-79';

function doc(i: number, frame: string, lbs: number | undefined, extra: Partial<PlayerGear> = {}): PlayerGear {
  return {
    id: `gear-m${i}`, memberId: `m${i}`, updatedAt: '',
    items: [
      { id: `r${i}`, catalogId: frame, category: 'racket', label: 'Racket' },
      { id: `old${i}`, catalogId: 's1', category: 'string', label: 'Old', tensionLbs: 30 },
      { id: `s${i}`, catalogId: 's2', category: 'string', label: 'BG65', ...(lbs === undefined ? {} : { tensionLbs: lbs }) },
    ],
    activeRacketId: `r${i}`,
    ...extra,
  } as PlayerGear;
}

describe('tallyClubTension', () => {
  it('draws no band from two members, and a min–max band from three', () => {
    expect(clubTensionFor([doc(1, FRAME, 24), doc(2, FRAME, 27)], FRAME)).toBeNull();
    expect(clubTensionFor([doc(1, FRAME, 24), doc(2, FRAME, 27), doc(3, FRAME, 25)], FRAME))
      .toEqual({ sampleSize: 3, low: 24, high: 27, mean: 25.5 });
  });

  it('reads the NEWEST string, the racket IN PLAY, and skips a string with no tension', () => {
    const noTension = doc(4, FRAME, undefined);
    const spare = { ...doc(5, FRAME, 22), activeRacketId: 'elsewhere', items: [
      { id: 'p', catalogId: 'racket-other', category: 'racket', label: 'Other' },
      ...doc(5, FRAME, 22).items,
    ] } as PlayerGear;
    const bands = tallyClubTension([doc(1, FRAME, 24), doc(2, FRAME, 26), doc(3, FRAME, 25), noTension, spare]);
    // The old 30 lb string never counts; neither does the member with no tension.
    expect(bands.get(FRAME)).toEqual({ sampleSize: 3, low: 24, high: 26, mean: 25 });
  });
});

describe('GET /api/stats/club/tension', () => {
  beforeEach(() => {
    resetMockStore();
    setupAdminPin();
  });

  it('answers a band and nothing about the people in it — no ids, no fit answers', async () => {
    getStore()['playerGear'] = [1, 2, 3].map((i) => doc(i, FRAME, 23 + i, { fitArmComfort: 'often_sore', fitSwing: 'fast' }));
    const res = await CLUB_TENSION(makeRequest('GET', `http://localhost/api/stats/club/tension?frame=${FRAME}`));
    const body = await res.json();
    expect(body).toEqual({ band: { sampleSize: 3, low: 24, high: 26, mean: 25 } });
    expect(JSON.stringify(body)).not.toMatch(/m1|sore|fast|gear-/);
  });

  it('requires a frame', async () => {
    const res = await CLUB_TENSION(makeRequest('GET', 'http://localhost/api/stats/club/tension'));
    expect(res.status).toBe(400);
  });
});
