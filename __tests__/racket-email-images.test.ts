import { describe, it, expect } from 'vitest';
import { readdirSync } from 'node:fs';
import { join } from 'node:path';
import sharp from 'sharp';
import { EMAIL_RACKET_GROUND, racketEmailSrc } from '@/lib/racketLook';
import { racketCard } from '@/lib/emailLayout';

/**
 * A stringing email's racket is a JPEG on the tile's green, made from the list
 * picture by `scripts/make-racket-email-images.mjs` (docs/plans/branded-emails.md).
 * Gmail drops a WebP's transparency, and the transparent list picture showed as
 * a black box inside the tile (2026-11-23).
 *
 * What goes wrong unseen: a racket added with no email copy (a broken picture
 * in that player's email), and the tile's green changed without re-running the
 * script (a square of the old green inside the new). Run the script to fix
 * either.
 */
const DIR = join(process.cwd(), 'public', 'rackets');
const ids = readdirSync(DIR)
  .filter((f) => f.endsWith('.webp') && f !== '_default.webp')
  .map((f) => f.slice(0, -'.webp'.length));
const emails = new Set(readdirSync(join(DIR, 'email')));
const RUN = 'run: node scripts/make-racket-email-images.mjs';

function rgb(c: string): [number, number, number] {
  const n = parseInt(c.slice(1), 16);
  return [(n >> 16) & 255, (n >> 8) & 255, n & 255];
}

describe('racket email pictures', () => {
  it('every racket an email can show has its JPEG, and none is orphaned', () => {
    expect(ids.filter((id) => !emails.has(`${id}.jpg`)), RUN).toEqual([]);
    expect([...emails].filter((f) => !ids.includes(f.slice(0, -'.jpg'.length))), RUN).toEqual([]);
  });

  it('each is 176 px wide, opaque, and sits on the tile’s own green', async () => {
    const [r, g, b] = rgb(EMAIL_RACKET_GROUND);
    const wrong: string[] = [];
    for (const id of ids) {
      const { data, info } = await sharp(join(DIR, 'email', `${id}.jpg`)).raw().toBuffer({ resolveWithObject: true });
      if (info.width !== 176) wrong.push(`${id}: ${info.width}px wide`);
      if (info.channels !== 3) wrong.push(`${id}: ${info.channels} channels`);
      const d = Math.abs(data[0] - r) + Math.abs(data[1] - g) + Math.abs(data[2] - b);
      if (d > 12) wrong.push(`${id}: corner is not ${EMAIL_RACKET_GROUND}`);
    }
    expect(wrong, RUN).toEqual([]);
  });

  it('the email asks for the JPEG, never the WebP, and paints the tile the same green', () => {
    expect(racketEmailSrc('racket-yonex-astrox-88d-pro')).toMatch(/\/rackets\/email\/racket-yonex-astrox-88d-pro\.jpg$/);
    expect(racketEmailSrc('racket-nobody-makes')).toMatch(/\/rackets\/email\/_unknown\.jpg$/);
    const html = racketCard({
      job: { racketLabel: 'R', stringLabel: 'BG80', tensionMains: 26, tensionCrosses: 28 } as never,
      pictureUrl: 'https://x.test/p.jpg',
      refs: {},
      facts: [],
      cost: { label: 'Quote', value: '$28' },
    } as never);
    expect(html).toContain(`background:${EMAIL_RACKET_GROUND}">`);
  });
});
