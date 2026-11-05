import { describe, it, expect } from 'vitest';
import { wrapText } from '../lib/setupShareCanvas';

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
