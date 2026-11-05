import { describe, it, expect } from 'vitest';
import { wrapText, storyLayout, SHARE_W, SHARE_H } from '../lib/setupShareCanvas';

/**
 * Grant, 2026-11-05: the share card "should mirror what the card in app looks
 * like and not truncate". Names wrap onto a second line; only a name longer
 * than two whole lines is shortened, which no racket or string name reaches.
 */

// A fixed-width face: every character is 7 px wide.
const m = { font: '', measureText: (t: string) => ({ width: t.length * 7 }) as TextMetrics };

describe('the share card wraps names instead of cutting them', () => {
  it('a name that fits stays on one line, untouched', () => {
    expect(wrapText(m, 'Yonex BG80', 200)).toEqual(['Yonex BG80']);
  });

  it('a long string name goes onto a second line, every word kept', () => {
    // "VBS-66 Nan…" was the card's old rendering of this name.
    const lines = wrapText(m, 'Victor VBS-66 Nano', 84);
    expect(lines).toEqual(['Victor', 'VBS-66 Nano']);
    expect(lines.join(' ')).toBe('Victor VBS-66 Nano');
  });

  it('a long racket name wraps at word boundaries', () => {
    expect(wrapText(m, 'Yonex Astrox 99 Pro 3rd Gen', 140)).toEqual(['Yonex Astrox 99 Pro', '3rd Gen']);
  });

  it('only past two full lines is the tail shortened', () => {
    const lines = wrapText(m, 'one two three four five six seven eight', 70);
    expect(lines).toHaveLength(2);
    expect(lines[1].endsWith('…')).toBe(true);
  });
});

/**
 * Grant, 2026-11-05: "Omg it's so busy. We can break out of the current size.
 * Can be vertical ig story size". The image is a 9:16 story, and the words
 * stack up from the bottom of the story's safe area, so long names push the
 * racket up instead of pushing words off the frame.
 */
describe('the share image is a story', () => {
  const content = (name: string, n = 2) => ({
    eyebrow: 'Equipment', name: 'Lin', lbUnit: 'lb', footer: 'Grip G5 · At BPM Core since 2024',
    racket: { name: 'Li-Ning Halbertec 9000', sub: 'Main racket · 4U · even' },
    strings: Array.from({ length: n }, () => ({ packet: null, name, sub: 'Mains · 0.66mm · repulsion', lbs: 29 })),
  });

  it('is 9:16, exported at 1080 × 1920', () => {
    expect(SHARE_W * 3).toBe(1080);
    expect(SHARE_H * 3).toBe(1920);
  });

  it('long names move the words up, and they stay clear of the name at the top', () => {
    const short = storyLayout(m, content('Yonex BG80')).blockTop;
    const long = storyLayout(m, content('Victor VBS-66 Nano Ultra Repulsion Tournament Edition')).blockTop;
    expect(long).toBeLessThan(short);
    expect(long).toBeGreaterThan(200);
    expect(short).toBeLessThan(SHARE_H);
  });

  it('a long string name keeps every word across three lines', () => {
    const name = 'Victor VBS-66 Nano Ultra Repulsion Tournament Edition';
    expect(wrapText(m, name, 160, 3).join(' ')).toBe(name);
  });
});
