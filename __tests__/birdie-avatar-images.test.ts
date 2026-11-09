import { describe, it, expect } from 'vitest';
import { readdirSync } from 'node:fs';
import { join } from 'node:path';
import sharp from 'sharp';
import { BIRDIE_COLOURS } from '@/lib/memberAvatar';

/**
 * The six birdie avatars are pre-rendered (`scripts/make-birdie-avatars.mjs`),
 * one file per colour in `BIRDIE_COLOURS`. A colour added to the list without
 * its file would draw a broken image in every roster that member appears in;
 * a file left behind for a removed colour is dead weight. Run the script to fix
 * either.
 */
const DIR = join(process.cwd(), 'public', 'brand', 'birdies');

describe('birdie avatars', () => {
  it('every colour has its picture, and no picture is orphaned', () => {
    const files = readdirSync(DIR).filter((f) => f.endsWith('.webp'));
    const expected = BIRDIE_COLOURS.map((c) => `${c}.webp`);
    expect(files.filter((f) => !expected.includes(f))).toEqual([]);
    expect(expected.filter((f) => !files.includes(f)), 'run: node scripts/make-birdie-avatars.mjs').toEqual([]);
  });

  it('each picture is a 256 px square with no transparency (it carries its own ground)', async () => {
    for (const c of BIRDIE_COLOURS) {
      const meta = await sharp(join(DIR, `${c}.webp`)).metadata();
      expect([meta.width, meta.height, meta.hasAlpha], c).toEqual([256, 256, false]);
    }
  });
});
