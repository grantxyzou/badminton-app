#!/usr/bin/env node
/**
 * Pre-render one list image per catalog racket from the 3D model.
 *
 *   PORT=3106 npm run dev:next:mock        # in another terminal
 *   node scripts/render-racket-images.mjs [--base http://localhost:3106/bpm] [--only <id>]
 *
 * Drives `/design/racket-render` (dev-only) in system Chrome, asks it to render
 * each look in `lib/racketLook.ts`, and writes `public/rackets/<id>.webp` plus
 * `_default.webp`. The live 3D viewer and these images share one model and one
 * studio (`lib/racketModel.ts`, `lib/racketStage.ts`), so they cannot drift
 * apart. Re-run whenever a look is added or changed — the coverage test in
 * `__tests__/racket-look.test.ts` fails until you do.
 */
import { chromium } from 'playwright-core';
import { mkdirSync, writeFileSync, readdirSync, unlinkSync } from 'node:fs';
import { join } from 'node:path';

const args = process.argv.slice(2);
const arg = (name, fallback) => {
  const i = args.indexOf(`--${name}`);
  return i >= 0 ? args[i + 1] : fallback;
};
const base = arg('base', 'http://localhost:3106/bpm');
const only = arg('only', null);
const outDir = join(process.cwd(), 'public', 'rackets');
mkdirSync(outDir, { recursive: true });

const browser = await chromium.launch({ channel: 'chrome', headless: true, args: ['--use-angle=metal', '--enable-webgl', '--ignore-gpu-blocklist'] });
try {
  const page = await browser.newPage({ viewport: { width: 600, height: 900 }, deviceScaleFactor: 1 });
  await page.goto(`${base}/design/racket-render`, { waitUntil: 'networkidle' });
  await page.waitForFunction(() => typeof window.__renderRacket === 'function', null, { timeout: 120_000 });
  const ids = only ? [only] : ['_default', ...(await page.evaluate(() => window.__racketIds))];
  if (!only) {
    // A look that left the table must not leave its image behind.
    const keep = new Set(ids.map((id) => `${id}.webp`));
    for (const f of readdirSync(outDir)) if (f.endsWith('.webp') && !keep.has(f)) unlinkSync(join(outDir, f));
  }
  let bytes = 0;
  for (const id of ids) {
    const url = await page.evaluate((racketId) => window.__renderRacket(racketId), id);
    const buf = Buffer.from(url.slice(url.indexOf(',') + 1), 'base64');
    writeFileSync(join(outDir, `${id}.webp`), buf);
    bytes += buf.length;
  }
  console.log(`rendered ${ids.length} images, ${(bytes / 1024).toFixed(0)} KB, into public/rackets`);
} finally {
  await browser.close();
}
