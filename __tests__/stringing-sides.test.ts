import { describe, it, expect } from 'vitest';
import { jobSides } from '@/lib/stringingSides';

/**
 * A job's mains and crosses, read off its one stored spec (Grant's canvas,
 * 2026-11-16): the bench row draws M and C as two stacked pills, each with its
 * colour, tension and string, and calls out a request the player chose.
 */
describe('jobSides', () => {
  it('one string in one colour, the usual pair: both sides the same, nothing custom', () => {
    const s = jobSides({ stringLabel: 'BG80', stringColor: 'Yellow', tensionMains: 23, tensionCrosses: 25 });
    expect(s.mains).toEqual({ string: 'BG80', colour: 'yellow', tension: 23 });
    expect(s.crosses).toEqual({ string: 'BG80', colour: 'yellow', tension: 25 });
    expect(s.customTension).toBe(false);
    expect(s.customStrings).toBe(false);
  });

  it('a hybrid splits on " / " and reads as the player’s own strings', () => {
    const s = jobSides({ stringLabel: 'Victor VBS-66 Nano / Victor VBS-61', tensionMains: 27, tensionCrosses: 28 });
    expect(s.mains.string).toBe('Victor VBS-66 Nano');
    expect(s.crosses.string).toBe('Victor VBS-61');
    expect(s.mains.colour).toBeNull();
    expect(s.customStrings).toBe(true);
    expect(s.customTension).toBe(true);
  });

  it('a two-colour set gives each side its own colour', () => {
    const s = jobSides({ stringLabel: 'Yonex Aerobite', stringColor: 'White/Red', tensionMains: 26, tensionCrosses: 28 });
    expect(s.mains.colour).toBe('white');
    expect(s.crosses.colour).toBe('red');
    expect(s.customTension).toBe(false);
  });

  it('a bare slash stays part of the name', () => {
    const s = jobSides({ stringLabel: 'Li-Ning No.1/2', tensionMains: 26, tensionCrosses: 28 });
    expect(s.mains.string).toBe('Li-Ning No.1/2');
    expect(s.customStrings).toBe(false);
  });

  it('a bench label ending in a known colour gives the colour and drops the word', () => {
    const s = jobSides({ stringLabel: 'BG80 · white', tensionMains: 26, tensionCrosses: 28 });
    expect(s.mains).toEqual({ string: 'BG80', colour: 'white', tension: 26 });
    expect(s.crosses.colour).toBe('white');
  });

  it('a " · " tail that is not a colour stays part of the name', () => {
    const s = jobSides({ stringLabel: 'BG80 · 0.68mm', tensionMains: 26, tensionCrosses: 28 });
    expect(s.mains.string).toBe('BG80 · 0.68mm');
    expect(s.mains.colour).toBeNull();
  });
});
