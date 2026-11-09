#!/usr/bin/env node
/**
 * Take the "How to use BPM" guides' screenshots
 * (docs/superpowers/specs/2026-11-09-profile-reorg-design.md §8).
 *
 * NEVER against production. Each shot comes from the OFFLINE mock store, whose
 * people are famous players (Lin, Viktor, …), and is cropped to the one card it
 * explains, so no address, date or other name sits beside it (Grant,
 * 2026-11-09: "add images? data should not leak"). Start the app first:
 *
 *   NEXT_PUBLIC_BASE_PATH=/bpm COSMOS_CONNECTION_STRING= \
 *   NEXT_PUBLIC_FLAG_STRINGING=true NEXT_PUBLIC_FLAG_MULTI_GROUP=true \
 *   NEXT_PUBLIC_FLAG_PAYMENTS_AUTO=true NEXT_PUBLIC_FLAG_STORE_CREDIT=true \
 *   SEED_DEV_SCENARIO=metrics-history SEED_DEV_ADMIN=Grant:1130 \
 *   npx next dev --port 3100
 *
 *   node scripts/help-screenshots.mjs [http://localhost:3100]
 *
 * Writes `public/help/<locale>/<name>.webp` for both locales and
 * `lib/helpImages.ts` with every image's size. The script refuses any host
 * but localhost, so it cannot be pointed at a real club by mistake.
 */
import { createRequire } from 'node:module';
import { mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import sharp from 'sharp';

const require = createRequire(import.meta.url);
const { chromium } = require('playwright');

const ORIGIN = process.argv[2] ?? 'http://localhost:3100';
if (!/^http:\/\/(localhost|127\.0\.0\.1)(:\d+)?$/.test(ORIGIN)) {
  console.error('help-screenshots: the mock store only (localhost). Refusing', ORIGIN);
  process.exit(1);
}
const B = `${ORIGIN}/bpm`;
const H = { origin: ORIGIN };
const LOCALES = ['en', 'zh-CN'];
const WIDTH = 390;

const messages = Object.fromEntries(
  LOCALES.map((l) => [l, JSON.parse(readFileSync(join(process.cwd(), 'messages', `${l}.json`), 'utf8'))]),
);
const m = (l, path) => path.split('.').reduce((o, k) => o?.[k], messages[l]);

async function save(locale, name, png, sizes) {
  const dir = join(process.cwd(), 'public', 'help', locale);
  mkdirSync(dir, { recursive: true });
  const img = sharp(png).webp({ quality: 82, effort: 6 });
  const info = await img.toFile(join(dir, `${name}.webp`));
  (sizes[locale] ??= {})[name] = { w: info.width, h: info.height };
  console.log(`  ${locale}/${name}.webp ${info.width}×${info.height}`);
}

/** The fixed layers that would sit over a card mid-screen: the tab bar and the dev badge. */
const HIDE_OVERLAYS = 'nav, nextjs-portal { visibility: hidden !important; }';

async function shoot(locator) {
  await locator.evaluate((el) => el.scrollIntoView({ block: 'center' }));
  // Hidden for the shot only: the next step clicks the tab bar.
  const style = await locator.page().addStyleTag({ content: HIDE_OVERLAYS });
  await locator.page().waitForTimeout(400);
  const png = await locator.screenshot({ animations: 'disabled' });
  await style.evaluate((el) => el.remove());
  return png;
}

async function main() {
  const browser = await chromium.launch();
  const admin = await browser.newContext();
  const ok = (r, what) => { if (!r.ok()) throw new Error(`${what}: ${r.status()}`); };
  ok(await admin.request.post(`${B}/api/admin`, { data: { name: 'Grant', pin: '1130' }, headers: H }), 'admin sign-in');
  ok(await admin.request.patch(`${B}/api/stringing/shop`, { data: { open: true }, headers: H }), 'open the shop');
  ok(await admin.request.patch(`${B}/api/admin/settings`, { data: { eTransferRecipient: { name: 'BPM Core', email: 'pay@example.com' } }, headers: H }), 'pay-to');
  ok(await admin.request.post(`${B}/api/admin/credit`, { data: { memberId: 'dev-member-lin', amountCents: 4500, note: 'Raffle' }, headers: H }), 'credit');

  const sizes = {};
  for (const locale of LOCALES) {
    console.log(locale);
    const ctx = await browser.newContext({ viewport: { width: WIDTH, height: 844 }, deviceScaleFactor: 2, colorScheme: 'light' });
    await ctx.addCookies([{ name: 'NEXT_LOCALE', value: locale, url: B }]);
    ok(await ctx.request.post(`${B}/api/players/recover`, { data: { name: 'Lin', pin: '2468' }, headers: H }), 'Lin sign-in');
    const p = await ctx.newPage();
    const tab = (key) => p.getByRole('button', { name: m(locale, `nav.${key}`), exact: true }).last();
    await p.goto(B);
    await p.waitForSelector('nav', { timeout: 60000 });
    await p.waitForTimeout(4000);

    // Home: the sign-up card and the balance card.
    await save(locale, 'signup-card', await shoot(p.locator('.glass-card').filter({ has: p.getByRole('button', { name: m(locale, 'home.signup.button') }) }).first()), sizes);
    await save(locale, 'balance-card', await shoot(p.locator('.glass-card').filter({ has: p.getByRole('button', { name: m(locale, 'home.balance.details') }) }).first()), sizes);

    // Stringing: the request register.
    await tab('stringing').click();
    await p.waitForTimeout(2500);
    await p.getByRole('button', { name: m(locale, 'home.stringing.registers.racket') }).first().click();
    await p.waitForTimeout(1500);
    await save(locale, 'stringing-request', await shoot(p.locator('[data-tab-panel="stringing"] .glass-card, .glass-card').filter({ visible: true }).nth(0)), sizes);

    // Stats: the three tiles at the top (the comparison question dismissed first).
    await tab('skills').click();
    await p.waitForTimeout(3000);
    const keep = p.getByRole('button', { name: m(locale, 'stats.consent.no') });
    if (await keep.count()) await keep.first().click().catch(() => {});
    await p.waitForTimeout(800);
    await save(locale, 'stats-tiles', await shoot(p.locator('[data-stats-tiles]').first()), sizes);

    // Profile: the App group (Notifications).
    await tab('profile').click();
    await p.waitForTimeout(2500);
    await save(locale, 'profile-app', await shoot(p.locator('.glass-card').filter({ has: p.getByRole('button', { name: new RegExp(m(locale, 'profile.settings.notifications')) }) }).first()), sizes);

    // Profile → Account balance: the top card.
    await p.getByRole('button', { name: new RegExp(m(locale, 'profile.settings.accountBalance')) }).click();
    await p.waitForTimeout(2500);
    await save(locale, 'account-balance', await shoot(p.locator('[data-account-balance-page] .glass-card').first()), sizes);
    await ctx.close();

    // Admin: the next session card, as the organiser.
    const actx = await browser.newContext({ viewport: { width: WIDTH, height: 844 }, deviceScaleFactor: 2, colorScheme: 'light' });
    await actx.addCookies([{ name: 'NEXT_LOCALE', value: locale, url: B }]);
    ok(await actx.request.post(`${B}/api/players/recover`, { data: { name: 'Grant', pin: '1130' }, headers: H }), 'Grant sign-in');
    ok(await actx.request.post(`${B}/api/admin`, { data: { name: 'Grant', pin: '1130' }, headers: H }), 'Grant admin');
    const a = await actx.newPage();
    await a.goto(B);
    await a.waitForSelector('nav', { timeout: 60000 });
    await a.waitForTimeout(3000);
    await a.getByRole('button', { name: m(locale, 'nav.profile'), exact: true }).last().click();
    await a.waitForTimeout(2000);
    await a.getByRole('button', { name: new RegExp(m(locale, 'profile.admin.console')) }).click();
    await a.waitForTimeout(4000);
    await save(locale, 'admin-session', await shoot(a.locator('section[aria-label="Next session"]').first()), sizes);
    await actx.close();
  }
  await browser.close();

  const body = `/**
 * The guides' screenshots and their pixel sizes, per locale (written by
 * \`node scripts/help-screenshots.mjs\`, which takes them from the OFFLINE mock
 * store and crops each to the one card it explains — never production, so no
 * real name, address or amount is in any of them; Grant, 2026-11-09).
 *
 * The sizes are here so a guide page sets \`width\` / \`height\` on every image
 * and nothing below it jumps when it loads. \`__tests__/legal-pages.test.ts\`
 * fails on a guide naming an image that has no file in a locale.
 */
export const HELP_IMAGES: Record<string, Record<string, { w: number; h: number }>> = ${JSON.stringify(sizes, null, 2)};
`;
  writeFileSync(join(process.cwd(), 'lib', 'helpImages.ts'), body);
  console.log('wrote lib/helpImages.ts');
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
