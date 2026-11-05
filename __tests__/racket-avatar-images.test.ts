import { describe, it, expect } from 'vitest';
import { readdirSync } from 'node:fs';
import { join } from 'node:path';
import sharp from 'sharp';
import { racketGround, racketAvatarSrc, AVATAR_CROP_MAX_PX } from '@/lib/racketLook';

/**
 * A roster avatar is the head of its racket, cut from the list picture by
 * `scripts/make-racket-avatars.mjs` and flattened onto the racket's own avatar
 * ground (audit, 2026-11-05: each roster circle was downloading the whole
 * ~18 KB picture to show its head; the crop is ~3 KB).
 *
 * Two ways that goes wrong without anyone seeing it: a racket added to the
 * catalog with no avatar (MemberAvatar shows a broken image in every roster),
 * and a ground rule changed in `racketGround` without re-running the script (a
 * visible square of the old colour inside the circle). Run the script to fix
 * either.
 */
const DIR = join(process.cwd(), 'public', 'rackets');
const pictures = readdirSync(DIR).filter((f) => f.endsWith('.webp'));
const avatars = new Set(readdirSync(join(DIR, 'avatar')));

function parse(c: string): [number, number, number] {
  const n = parseInt(c.slice(1), 16);
  return [(n >> 16) & 255, (n >> 8) & 255, n & 255];
}

describe('racket avatars', () => {
  it('every list picture has its avatar, and no avatar is orphaned', () => {
    const missing = pictures.filter((f) => !avatars.has(f));
    const orphaned = [...avatars].filter((f) => !pictures.includes(f));
    expect(missing, 'run: node scripts/make-racket-avatars.mjs').toEqual([]);
    expect(orphaned).toEqual([]);
  });

  it('each avatar is 128 px wide and sits on its racket’s own ground', async () => {
    const wrong: string[] = [];
    for (const f of pictures) {
      const id = f.slice(0, -'.webp'.length);
      const { data, info } = await sharp(join(DIR, 'avatar', f)).raw().toBuffer({ resolveWithObject: true });
      if (info.width !== 128) wrong.push(`${f}: ${info.width}px wide`);
      // The top-left corner is background in every render.
      const [r, g, b] = parse(racketGround(id === '_default' ? null : id));
      const d = Math.abs(data[0] - r) + Math.abs(data[1] - g) + Math.abs(data[2] - b);
      if (d > 12) wrong.push(`${f}: corner is not ${racketGround(id === '_default' ? null : id)}`);
    }
    expect(wrong, 'run: node scripts/make-racket-avatars.mjs').toEqual([]);
  });

  it('a roster-sized circle takes the crop; the crop stays sharp up to that size on a 3× screen', () => {
    expect(racketAvatarSrc('nope')).toMatch(/\/rackets\/avatar\/_default\.webp$/);
    expect(AVATAR_CROP_MAX_PX * 3 * 0.9).toBeLessThanOrEqual(130);
  });
});
