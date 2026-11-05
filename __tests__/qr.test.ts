import { describe, it, expect } from 'vitest';
import { encode } from 'uqr';
import { qrPath, QR_QUIET_ZONE } from '@/lib/qr';

/**
 * The invite QR (Task 1.3 of docs/superpowers/plans/2026-11-04-app-clip.md).
 * `uqr` encodes; `qrPath` draws. These pin the drawing to the encoding, keep
 * the quiet zone a camera needs, and keep the three finder squares where a
 * reader looks for them.
 */
const URL = `https://bpm.grantzou.com/bpm/j/${'a1'.repeat(16)}`;

function dark(d: string): Set<string> {
  return new Set([...d.matchAll(/M(\d+) (\d+)h1v1h-1z/g)].map((m) => `${m[1]},${m[2]}`));
}

describe('qrPath', () => {
  it('draws exactly the encoder’s dark squares, one unit square each', () => {
    const { data, size } = encode(URL, { ecc: 'M', border: QR_QUIET_ZONE });
    const drawn = dark(qrPath(URL).d);
    let expected = 0;
    for (let y = 0; y < size; y += 1) for (let x = 0; x < size; x += 1) if (data[y]![x]) {
      expected += 1;
      expect(drawn.has(`${x},${y}`)).toBe(true);
    }
    expect(drawn.size).toBe(expected);
    expect(qrPath(URL).d.replace(/M\d+ \d+h1v1h-1z/g, '')).toBe('');
  });

  it('keeps a four-square quiet zone all round', () => {
    const { size, d } = qrPath(URL);
    for (const key of dark(d)) {
      const [x, y] = key.split(',').map(Number) as [number, number];
      expect(x).toBeGreaterThanOrEqual(QR_QUIET_ZONE);
      expect(y).toBeGreaterThanOrEqual(QR_QUIET_ZONE);
      expect(x).toBeLessThan(size - QR_QUIET_ZONE);
      expect(y).toBeLessThan(size - QR_QUIET_ZONE);
    }
  });

  it('has the three finder squares in their corners', () => {
    const { size, d } = qrPath(URL);
    const on = dark(d);
    const q = QR_QUIET_ZONE;
    // Each finder is a dark 7x7 ring around a light ring around a dark 3x3.
    for (const [ox, oy] of [[q, q], [size - q - 7, q], [q, size - q - 7]] as const) {
      for (let i = 0; i < 7; i += 1) {
        expect(on.has(`${ox + i},${oy}`)).toBe(true);
        expect(on.has(`${ox + i},${oy + 6}`)).toBe(true);
        expect(on.has(`${ox},${oy + i}`)).toBe(true);
        expect(on.has(`${ox + 6},${oy + i}`)).toBe(true);
      }
      expect(on.has(`${ox + 1},${oy + 1}`)).toBe(false);
      expect(on.has(`${ox + 3},${oy + 3}`)).toBe(true);
    }
  });

  it('is the same drawing every time for the same link', () => {
    expect(qrPath(URL)).toEqual(qrPath(URL));
    expect(qrPath(URL).d).not.toBe(qrPath(`${URL.slice(0, -1)}b`).d);
  });
});
