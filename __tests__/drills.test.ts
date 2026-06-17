import { describe, it, expect } from 'vitest';
import { SKILLS } from '../lib/assessment';
import { DRILLS, recommendDrills, type WorkOnSkill } from '../lib/drills';

const wo = (key: string, value: number, label = key): WorkOnSkill => ({ key, label, value });

describe('drill library coverage', () => {
  it('has at least one drill for every assessment skill key', () => {
    const covered = new Set(DRILLS.map((d) => d.skillKey));
    const missing = SKILLS.map((s) => s.key).filter((k) => !covered.has(k));
    expect(missing).toEqual([]);
  });

  it('every drill has a valid band, minutes and setting', () => {
    for (const d of DRILLS) {
      expect(d.band[0]).toBeLessThanOrEqual(d.band[1]);
      expect(d.band[0]).toBeGreaterThanOrEqual(1);
      expect(d.band[1]).toBeLessThanOrEqual(5);
      expect(d.minutes).toBeGreaterThan(0);
      expect(['solo', 'pair', 'group']).toContain(d.setting);
    }
  });
});

describe('recommendDrills — selection', () => {
  it('returns [] for an empty work-on list', () => {
    expect(recommendDrills({ workOn: [], level: 3, rotationSeed: 's' })).toEqual([]);
  });

  it('picks a band-appropriate drill for the skill\'s own rating', () => {
    const low = recommendDrills({ workOn: [wo('net_play', 1, 'Net Play')], level: 2, rotationSeed: 's' });
    expect(low).toHaveLength(1);
    expect(low[0].skillKey).toBe('net_play');
    expect(low[0].band[0]).toBeLessThanOrEqual(1);
    expect(low[0].band[1]).toBeGreaterThanOrEqual(1); // band contains 1 → foundation [1,3]

    const high = recommendDrills({ workOn: [wo('net_play', 5, 'Net Play')], level: 5, rotationSeed: 's' });
    expect(high[0].band[0]).toBeLessThanOrEqual(5);
    expect(high[0].band[1]).toBe(5); // value 5 → sharpen [3,5]
    expect(high[0].id).not.toBe(low[0].id); // a 1 and a 5 get different drills
  });

  it('includes a human-readable reason naming the skill and rating', () => {
    const [pick] = recommendDrills({ workOn: [wo('smashes', 2, 'Smashes')], level: 2, rotationSeed: 's' });
    expect(pick.reason).toMatch(/smashes/i);
    expect(pick.reason).toContain('2/5');
  });

  it('caps the output at `count`', () => {
    const many = [wo('net_play', 2), wo('smashes', 2), wo('drops', 2), wo('drives', 2)];
    expect(recommendDrills({ workOn: many, level: 2, rotationSeed: 's', count: 2 })).toHaveLength(2);
  });

  it('skips skills with no drills rather than throwing', () => {
    const picks = recommendDrills({ workOn: [wo('not_a_real_skill', 2), wo('net_play', 2, 'Net Play')], level: 2, rotationSeed: 's' });
    expect(picks).toHaveLength(1);
    expect(picks[0].skillKey).toBe('net_play');
  });
});

describe('recommendDrills — rotation', () => {
  it('is deterministic for the same (workOn, seed)', () => {
    const input = { workOn: [wo('consistency', 3, 'Consistency')], level: 3, rotationSeed: 'session-2026-06-13' };
    expect(recommendDrills(input)).toEqual(recommendDrills(input));
  });

  it('rotates the drill week to week for a skill with multiple in-band options', () => {
    // A rating of 3 sits in BOTH bands ([1,3] and [3,5]) → two candidates, so
    // different sessions surface different drills.
    const seeds = ['session-2026-06-05', 'session-2026-06-12', 'session-2026-06-19', 'session-2026-06-26'];
    const ids = new Set(
      seeds.map((rotationSeed) => recommendDrills({ workOn: [wo('drives', 3, 'Drives')], level: 3, rotationSeed })[0].id),
    );
    expect(ids.size).toBeGreaterThan(1);
  });
});
