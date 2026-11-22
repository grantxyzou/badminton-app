/**
 * The read-only tour (docs/plans/e2e-test-club.md, step 3).
 *
 * Each persona signs in, passes the club guard, and opens every tab it can
 * reach — Admin tools too, for an organiser — by TAPPING the bottom nav the
 * way a thumb does (a `?tab=` URL is read after hydration, so it is not a way
 * to reach a screen). On each screen it waits for the data to land, takes a
 * full-page screenshot, and runs the checks in `capture.ts`.
 *
 * It writes nothing but the sign-in itself and the app's own usage beacons,
 * which count toward the E2E test club's Metrics page and no other.
 */
import { mkdirSync } from 'node:fs';
import { join } from 'node:path';
import { test, expect, type Page } from '@playwright/test';
import { tourPersonas } from './personas';
import { assertMockIsLocal, baseUrl, target } from './target';
import { clubGuard, pinEnglish, signIn } from './session';
import { Recorder } from './capture';

const SCREENS_DIR = join(__dirname, '..', 'e2e-results', 'screens');
const TABS = ['Home', 'Stringing', 'Stats', 'Profile'] as const;
const FULL_PAGE_STYLE = '.rail-bar, nextjs-portal { visibility: hidden !important; }';

/** Network quiet, then no skeleton left on screen. Each wait is bounded. */
async function settle(page: Page): Promise<void> {
  await page.waitForLoadState('networkidle', { timeout: 15_000 }).catch(() => {});
  await page
    .waitForFunction(
      () =>
        !Array.from(document.querySelectorAll('.shimmer-line')).some((el) => {
          const r = (el as HTMLElement).getBoundingClientRect();
          return r.width > 0 && r.height > 0;
        }),
      undefined,
      { timeout: 10_000 },
    )
    .catch(() => {});
  // The tab crossfade and any reveal stagger.
  await page.waitForTimeout(400);
}

test.beforeAll(() => {
  assertMockIsLocal();
});

for (const persona of tourPersonas()) {
  test(`tour as ${persona.label} (${target()})`, async ({ browser }, testInfo) => {
    const context = await browser.newContext();
    await pinEnglish(context);
    const page = await context.newPage();
    const rec = new Recorder(page);
    mkdirSync(SCREENS_DIR, { recursive: true });

    const shot = async (screen: string) => {
      rec.at(screen);
      await settle(page);
      await rec.inspect();
      const file = join(SCREENS_DIR, `${persona.label}-${screen}.png`);
      // A full-page capture stitches fixed elements into the middle of the
      // image; the tab bar (and the dev server's badge) would read as a bug.
      await page.screenshot({ path: file, fullPage: true, style: FULL_PAGE_STYLE });
      await testInfo.attach(`${persona.label}-${screen}`, { path: file, contentType: 'image/png' });
      await dismissArrivalSheet();
    };

    /**
     * A sheet that opens by itself on arrival (Stats asks once whether to
     * compare you with the club) covers the tab bar. It is already in the
     * screenshot above; close it the way a person would. For the Stats ask,
     * closing IS an answer — "Keep it private", the persona's own setting,
     * asked once (docs/plans/e2e-test-club.md, Safety rules).
     */
    const dismissArrivalSheet = async () => {
      const sheet = page.locator('[role="dialog"][aria-modal="true"]');
      if ((await sheet.count()) === 0 || !(await sheet.first().isVisible())) return;
      await page.keyboard.press('Escape');
      await expect(sheet, 'an arrival sheet would not close').toHaveCount(0, { timeout: 10_000 });
    };

    try {
      rec.at('sign-in');
      await signIn(page, persona);
      const who = await clubGuard(page, persona);
      testInfo.annotations.push({ type: 'persona', description: `${persona.label}: ${who.role}` });

      rec.at('launch');
      await page.goto(`${baseUrl()}/`);
      // The launch screen hands over once the app has settled (at most a few
      // seconds); a signed-out welcome here means the sign-in did not hold.
      await page.waitForFunction(
        () => {
          const s = document.documentElement.getAttribute('data-launch');
          return !s || s === 'done' || s === 'lifted' || s === 'welcome';
        },
        undefined,
        { timeout: 20_000 },
      );
      await expect(page.locator('[data-signed-out-welcome]'), 'the app showed the signed-out welcome').toHaveCount(0);
      const nav = page.getByRole('navigation', { name: 'Main tabs' });
      await expect(nav).toBeVisible();

      for (const tab of TABS) {
        const button = nav.getByRole('button', { name: tab, exact: true });
        // A club with stringing switched off has three tabs.
        if ((await button.count()) === 0) continue;
        await button.tap();
        await shot(tab.toLowerCase());
      }

      if (who.privileged) {
        await nav.getByRole('button', { name: 'Profile', exact: true }).tap();
        await page.getByRole('button', { name: /^Admin tools/ }).first().tap();
        await shot('admin');
      }
    } finally {
      await rec.attach(testInfo);
      await context.close();
    }

    const errors = rec.errors();
    expect(errors, errors.map((e) => `[${e.screen}] ${e.kind}: ${e.detail}`).join('\n')).toEqual([]);
  });
}
