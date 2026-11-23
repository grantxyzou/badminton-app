#!/usr/bin/env node
/**
 * Make each racket's EMAIL picture from its list picture:
 * `public/rackets/<id>.webp` (240×624, transparent) →
 * `public/rackets/email/<id>.jpg` (176 wide, on the email tile's green).
 *
 *   node scripts/make-racket-email-images.mjs
 *
 * Gmail re-encodes every picture it shows and drops a WebP's transparency, so
 * the list picture arrived in a stringing email as a black box inside the green
 * tile (Grant's inbox, 2026-11-23). A JPEG flattened onto the tile's own colour
 * (`EMAIL_RACKET_GROUND`, imported from `lib/racketLook.ts` so the email and
 * the picture cannot drift apart) has no transparency to lose, and is ~10 KB.
 * 176 px is twice the 88 px the email draws it at (`lib/emailLayout.ts`).
 *
 * Every list picture but `_default` (an email shows the matte black `_unknown`
 * for a racket the catalog does not know, never BPM's colourway). Re-run after
 * `render-racket-images.mjs`; `__tests__/racket-email-images.test.ts` fails
 * until every picture has its email copy.
 */
import sharp from 'sharp';
import { mkdirSync, readdirSync, existsSync, unlinkSync } from 'node:fs';
import { join } from 'node:path';
import { register } from 'node:module';

// `lib/racketLook.ts` is TypeScript with an extensionless relative import, as
// the app's bundler writes them; this hook tries `.ts` for such a name (the
// same hook as `make-racket-avatars.mjs`).
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
const { EMAIL_RACKET_GROUND } = await import('../lib/racketLook.ts');

const src = join(process.cwd(), 'public', 'rackets');
const out = join(src, 'email');
mkdirSync(out, { recursive: true });
const only = process.argv.includes('--missing');

const ids = readdirSync(src)
  .filter((f) => f.endsWith('.webp') && f !== '_default.webp')
  .map((f) => f.slice(0, -'.webp'.length));

let n = 0;
for (const id of ids) {
  const dest = join(out, `${id}.jpg`);
  if (only && existsSync(dest)) continue;
  await sharp(join(src, `${id}.webp`))
    .resize({ width: 176 })
    .flatten({ background: EMAIL_RACKET_GROUND })
    .jpeg({ quality: 82, mozjpeg: true })
    .toFile(dest);
  n += 1;
}
// A racket that left the catalog takes its email picture with it.
const keep = new Set(ids.map((id) => `${id}.jpg`));
for (const f of readdirSync(out)) if (!keep.has(f)) unlinkSync(join(out, f));
console.log(`wrote ${n} email picture${n === 1 ? '' : 's'} to public/rackets/email/`);
