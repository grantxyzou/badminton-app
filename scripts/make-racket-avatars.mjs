#!/usr/bin/env node
/**
 * Cut each racket's AVATAR from its list picture: `public/rackets/<id>.webp`
 * (240×624) → `public/rackets/avatar/<id>.webp` (128 wide).
 *
 *   node scripts/make-racket-avatars.mjs
 *
 * A roster avatar is at most 48 px across, and `.member-avatar__racket` shows
 * only the top 256 rows of the list picture (the head), so every avatar was
 * downloading ~19 KB to show ~1 KB of it (audit, 2026-11-05). The crop is the
 * same region the CSS shows — full width, rows 0..256 — so the same rule draws
 * both. 128 px covers a 48 px circle on a 3× screen (48 × 3 × 0.9 = 130).
 * FLATTENED onto the racket's own avatar ground (`racketGround`, imported from
 * `lib/racketLook.ts` so the rule exists once): the circle behind it is that
 * same colour, so the seam cannot show, and with no alpha channel the file is
 * ~3 KB. A lossy alpha channel was tried first and smudged the strings grey.
 *
 * Re-run after `render-racket-images.mjs`; `__tests__/racket-avatar-images.test.ts`
 * fails until every list picture has its avatar.
 */
import sharp from 'sharp';
import { mkdirSync, readdirSync, existsSync } from 'node:fs';
import { join } from 'node:path';
import { register } from 'node:module';

// `lib/racketLook.ts` is TypeScript with an extensionless relative import
// (`./assetUrl`), as the app's bundler writes them. Node runs the TypeScript
// itself but resolves only full file names, so this hook tries `.ts` for a
// relative name with no extension. The ground rule is imported, never copied:
// a second copy is how the avatar and the circle behind it would drift apart.
register(
  'data:text/javascript,' +
    encodeURIComponent(`
export async function resolve(spec, ctx, next) {
  if (/^\\.\\.?\\//.test(spec) && !/\\.[cm]?[jt]s$/.test(spec)) {
    try { return await next(spec + '.ts', ctx); } catch {}
  }
  return next(spec, ctx);
}`),
);
const { racketGround } = await import('../lib/racketLook.ts');

const src = join(process.cwd(), 'public', 'rackets');
const out = join(src, 'avatar');
mkdirSync(out, { recursive: true });
const only = process.argv.includes('--missing');

let n = 0;
for (const name of readdirSync(src)) {
  if (!name.endsWith('.webp')) continue;
  const dest = join(out, name);
  if (only && existsSync(dest)) continue;
  const id = name.slice(0, -'.webp'.length);
  await sharp(join(src, name))
    .extract({ left: 0, top: 0, width: 240, height: 256 })
    .resize({ width: 128 })
    .flatten({ background: racketGround(id === '_default' ? null : id) })
    .webp({ quality: 82, effort: 6 })
    .toFile(dest);
  n += 1;
}
console.log(`wrote ${n} avatar${n === 1 ? '' : 's'} to public/rackets/avatar/`);
