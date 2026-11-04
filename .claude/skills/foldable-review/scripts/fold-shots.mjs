#!/usr/bin/env node
/**
 * Screenshot and measure the app at the sizes foldable phones report, with a
 * fold injected where one would be (docs/plans/foldable-layout.md).
 *
 *   node .claude/skills/foldable-review/scripts/fold-shots.mjs --out /tmp/fold --as Lin:2468
 *   node .claude/skills/foldable-review/scripts/fold-shots.mjs --sizes duo-landscape,fold-laptop --tab stats --open keep-score
 *
 * Needs the mock app up (`PORT=3100 npm run dev:next:mock`, wait for `Ready`)
 * and the pre-installed Playwright. Each browser context gets its own
 * x-forwarded-for, because sign-in is rate-limited 5/hour per (name, IP).
 *
 * The fold is injected through the WEB APIs (navigator.devicePosture and
 * window.viewport.segments) before the page's scripts run — what Chrome on a
 * Z Fold reports today and Safari 27.1 reports behind its flag — so
 * lib/fold.ts takes its second source and the layout lands on the injected
 * hinge. The CSS panes need no injection: they split at the centre regardless.
 */
import { createRequire } from 'node:module';
import { mkdirSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';

// Resolved through require, not import: the cloud box pre-installs Playwright
// where only `require('playwright')` finds it from any directory, and a Mac
// usually has it as @playwright/test. Either works; say so when neither does.
const require = createRequire(import.meta.url);
function loadChromium() {
  // The repo itself declares only playwright-core (the MCP server's engine),
  // which launches a browser only if one is installed: `npx playwright
  // install chromium` once on a Mac.
  for (const pkg of ['playwright', '@playwright/test', 'playwright-core']) {
    try {
      return require(pkg).chromium;
    } catch {
      /* try the next */
    }
  }
  console.error('fold-shots: no Playwright found. `npm i -D playwright && npx playwright install chromium` once, then re-run.');
  process.exit(2);
}
const chromium = loadChromium();

const PRESETS = {
  phone: { w: 430, h: 932, touch: true, note: 'an iPhone; must be untouched' },
  'duo-outer': { w: 382, h: 618, touch: true, note: 'iPhone Duo closed' },
  'duo-portrait': { w: 669, h: 902, touch: true, fold: 'horizontal', note: 'Duo open, upright' },
  'duo-landscape': { w: 951, h: 620, touch: true, fold: 'vertical', note: 'Duo open, sideways' },
  'duo-book': { w: 951, h: 620, touch: true, fold: 'vertical', gap: 31, note: 'Duo half-open like a book' },
  'fold-cover': { w: 412, h: 915, touch: true, note: 'Galaxy Z Fold closed' },
  'fold-inner': { w: 884, h: 1000, touch: true, fold: 'vertical', note: 'Z Fold open' },
  'fold-laptop': { w: 884, h: 1000, touch: true, fold: 'horizontal', gap: 24, note: 'Z Fold propped like a laptop' },
  tablet: { w: 1180, h: 820, touch: true, note: 'a touch tablet sideways' },
  desktop: { w: 1280, h: 800, touch: false, note: 'mouse, not touch; must be untouched' },
};

const args = Object.fromEntries(
  process.argv.slice(2).reduce((acc, a, i, all) => {
    if (a.startsWith('--')) acc.push([a.slice(2), all[i + 1] && !all[i + 1].startsWith('--') ? all[i + 1] : 'true']);
    return acc;
  }, []),
);
if (args.help) {
  console.log(`fold-shots.mjs
  --url <base>        default http://localhost:3100/bpm
  --as <Name:PIN>     sign in first (default Lin:2468; "none" to stay signed out)
  --sizes <a,b,c>     presets, default all: ${Object.keys(PRESETS).join(', ')}
  --tab <home|stringing|stats|profile>   tab to land on (default home)
  --register <you|equipment|play|learn>  Stats register to open
  --open keep-score   open the courtside scoreboard (implies --tab stats --register play)
  --points <a,b>      +1 taps per side on the board (default 11,7)
  --out <dir>         where PNGs and measurements.json go (default ./fold-shots)
  --reduced-motion    emulate prefers-reduced-motion (steadier screenshots)`);
  process.exit(0);
}
const url = args.url ?? 'http://localhost:3100/bpm';
const out = args.out ?? './fold-shots';
const sizes = (args.sizes ? args.sizes.split(',') : Object.keys(PRESETS)).map((s) => s.trim());
const [who, pin] = (args.as ?? 'Lin:2468').split(':');
const open = args.open;
const tab = open === 'keep-score' ? 'stats' : (args.tab ?? 'home');
const register = open === 'keep-score' ? 'play' : args.register;
const [pa, pb] = (args.points ?? '11,7').split(',').map(Number);
mkdirSync(out, { recursive: true });

/** Two segments either side of a fold of `gap` px, in the given direction. */
function segments(p) {
  const gap = p.gap ?? 30;
  if (p.fold === 'vertical') {
    const half = Math.floor((p.w - gap) / 2);
    return [{ left: 0, top: 0, right: half, bottom: p.h }, { left: half + gap, top: 0, right: p.w, bottom: p.h }];
  }
  const half = Math.floor((p.h - gap) / 2);
  return [{ left: 0, top: 0, right: p.w, bottom: half }, { left: 0, top: half + gap, right: p.w, bottom: p.h }];
}

const measurements = {};
const browser = await chromium.launch();
let n = 0;
for (const name of sizes) {
  const p = PRESETS[name];
  if (!p) { console.error(`unknown preset ${name}`); continue; }
  n++;
  const ctx = await browser.newContext({
    viewport: { width: p.w, height: p.h },
    deviceScaleFactor: 1,
    hasTouch: p.touch,
    isMobile: p.touch,
    reducedMotion: args['reduced-motion'] ? 'reduce' : undefined,
    extraHTTPHeaders: { 'x-forwarded-for': `10.${(Date.now() >> 8) % 200 + 20}.${n}.1` },
  });
  if (p.fold) {
    await ctx.addInitScript((segs) => {
      Object.defineProperty(navigator, 'devicePosture', {
        value: { type: 'folded', addEventListener() {}, removeEventListener() {} },
        configurable: true,
      });
      window.viewport = { segments: segs };
    }, segments(p));
  }
  const page = await ctx.newPage();
  await page.goto(url, { waitUntil: 'networkidle' });
  await page.waitForTimeout(2500);

  if (who !== 'none') {
    const login = page.getByRole('button', { name: /log in/i }).first();
    if (await login.count()) {
      await login.click();
      await page.waitForTimeout(500);
      await page.locator('input').nth(0).fill(who);
      await page.locator('input').nth(1).fill(pin);
      await page.getByRole('button', { name: /^sign in$/i }).first().click();
      await page.waitForTimeout(7000);
    }
  }
  if (tab !== 'home') {
    await page.getByRole('button', { name: new RegExp(`^${tab}$`, 'i') }).first().click();
    await page.waitForTimeout(2500);
    const consent = page.getByRole('button', { name: /keep it private/i });
    if (await consent.count()) { await consent.first().click(); await page.waitForTimeout(400); }
  }
  if (register) {
    await page.getByRole('button', { name: new RegExp(`^${register}$`, 'i') }).first().click();
    await page.waitForTimeout(2000);
  }
  if (open === 'keep-score') {
    const btn = page.getByRole('button', { name: /keep score/i }).first();
    await btn.scrollIntoViewIfNeeded();
    await btn.click();
    await page.waitForTimeout(800);
    for (let i = 0; i < pa; i++) await page.getByRole('button', { name: '+1 A side' }).click();
    for (let i = 0; i < pb; i++) await page.getByRole('button', { name: '+1 B side' }).click();
    await page.waitForTimeout(400);
  }

  const m = await page.evaluate(() => {
    const r = (sel) => {
      const el = document.querySelector(sel);
      if (!el) return null;
      const b = el.getBoundingClientRect();
      return { left: Math.round(b.left), right: Math.round(b.right), top: Math.round(b.top), bottom: Math.round(b.bottom), width: Math.round(b.width) };
    };
    const board = document.querySelector('.courtside');
    return {
      viewport: [innerWidth, innerHeight],
      centre: innerWidth / 2,
      week: r('.bpm-home-week'),
      account: r('.vt-home-account'),
      rail: r('.rail-bar'),
      sheet: r('.bottom-sheet'),
      paneFlip: document.documentElement.getAttribute('data-pane-flip'),
      board: board && {
        axis: board.dataset.axis,
        posture: board.dataset.posture,
        split: ['--court-first', '--court-gap', '--court-second'].map((v) => board.style.getPropertyValue(v)),
        rows: getComputedStyle(board).gridTemplateRows,
        cols: getComputedStyle(board).gridTemplateColumns,
      },
    };
  });
  measurements[name] = { ...p, ...m };
  const file = join(out, `${name}.png`);
  await page.screenshot({ path: file });
  console.log(name.padEnd(14), JSON.stringify({ week: m.week && [m.week.left, m.week.right], account: m.account && [m.account.left, m.account.right], rail: m.rail && [m.rail.left, m.rail.right], sheet: m.sheet && [m.sheet.left, m.sheet.right], board: m.board && m.board.split, centre: m.centre }), '→', file);
  await ctx.close();
}
await browser.close();
writeFileSync(join(out, 'measurements.json'), JSON.stringify(measurements, null, 2));
console.log(`measurements → ${join(out, 'measurements.json')}`);
