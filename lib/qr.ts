import { encode } from 'uqr';

/**
 * A QR code as ONE SVG path, for the Invite card's QR
 * (docs/superpowers/plans/2026-11-04-app-clip.md, Task 1.3).
 *
 * `uqr` (MIT, no dependencies, pinned) does the encoding and hands back the
 * grid of squares; this draws it, so the code takes the app's own colours from
 * CSS (`.invite-qr` in `app/globals.css`) instead of a library's inline
 * styles, and nothing is fetched over the network.
 *
 * `border` is the quiet zone: four squares of light ground all round, which is
 * what the QR spec asks for and what a camera needs to find the code against a
 * phone screen's edge. Error correction is M (about 15% of the code can be
 * lost), the usual choice for a code shown on a screen and read up close.
 */
export interface QrPath {
  /** Squares per side, quiet zone included. The SVG's viewBox is 0 0 size size. */
  size: number;
  /** Every dark square, as one path of unit squares. */
  d: string;
}

export const QR_QUIET_ZONE = 4;

/** The grid itself, quiet zone included: `data[y][x]` is true for a dark square. Drawn as SVG on the page and on a canvas for the poster (`lib/invitePoster.ts`). */
export function qrGrid(text: string): { size: number; data: boolean[][] } {
  const { data, size } = encode(text, { ecc: 'M', border: QR_QUIET_ZONE });
  return { size, data };
}

export function qrPath(text: string): QrPath {
  const { data, size } = qrGrid(text);
  let d = '';
  for (let y = 0; y < size; y += 1) {
    const row = data[y]!;
    for (let x = 0; x < size; x += 1) {
      if (row[x]) d += `M${x} ${y}h1v1h-1z`;
    }
  }
  return { size, d };
}
