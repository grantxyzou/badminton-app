#!/usr/bin/env node
/**
 * Pre-render one packet image per catalog string from `lib/stringPacks.ts`.
 *
 *   PORT=3106 npm run dev:next:mock        # in another terminal
 *   node scripts/render-string-images.mjs [--base http://localhost:3106/bpm] [--only <id>] [--executable <chromium>]
 *
 * Drives `/design/string-render` (dev-only) and writes
 * `public/strings/<id>.webp`, removing an image whose packet left the table.
 * `--executable` uses that Chromium instead of system Chrome (a cloud session:
 * `/opt/pw-browsers/chromium`). Re-run whenever a packet is added or changed —
 * `__tests__/string-pack.test.ts` fails until you do.
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
const executable = arg('executable', null);
const outDir = join(process.cwd(), 'public', 'strings');
mkdirSync(outDir, { recursive: true });

const browser = await chromium.launch(executable ? { executablePath: executable, headless: true } : { channel: 'chrome', headless: true });
try {
  const page = await browser.newPage({ viewport: { width: 600, height: 900 }, deviceScaleFactor: 1 });
  await page.goto(`${base}/design/string-render`, { waitUntil: 'networkidle' });
  await page.waitForFunction(() => typeof window.__renderString === 'function', null, { timeout: 120_000 });
  const ids = only ? [only] : await page.evaluate(() => window.__stringIds);
  if (!only) {
    const keep = new Set(ids.map((id) => `${id}.webp`));
    for (const f of readdirSync(outDir)) if (f.endsWith('.webp') && !keep.has(f)) unlinkSync(join(outDir, f));
  }
  let bytes = 0;
  for (const id of ids) {
    const url = await page.evaluate((stringId) => window.__renderString(stringId), id);
    if (!url.startsWith('data:image/webp')) throw new Error(`${id}: the browser returned ${url.slice(0, 20)}, not a WebP`);
    const buf = Buffer.from(url.slice(url.indexOf(',') + 1), 'base64');
    writeFileSync(join(outDir, `${id}.webp`), buf);
    bytes += buf.length;
  }
  console.log(`rendered ${ids.length} packets, ${(bytes / 1024).toFixed(0)} KB, into public/strings`);
} finally {
  await browser.close();
}
