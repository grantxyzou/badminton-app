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
import { test } from '@playwright/test';
import { tourPersonas } from './personas';
import { assertMockIsLocal, target } from './target';
import { dismissArrivalSheet, finish, nav, openAs, shot, tapTab, type Actor } from './journey';

const TABS = ['Home', 'Stringing', 'Stats', 'Profile'] as const;

test.beforeAll(() => {
  assertMockIsLocal();
});

for (const persona of tourPersonas()) {
  test(`tour as ${persona.label} (${target()})`, async ({ browser }, testInfo) => {
    let actor: Actor | null = null;
    try {
      actor = await openAs(browser, persona);
      testInfo.annotations.push({ type: 'persona', description: `${persona.label}: ${actor.who.role}` });

      for (const tab of TABS) {
        // A club with stringing switched off has three tabs.
        if (!(await tapTab(actor.page, tab))) continue;
        await shot(actor, tab.toLowerCase(), testInfo);
        await dismissArrivalSheet(actor.page);
      }

      if (actor.who.privileged) {
        await nav(actor.page).getByRole('button', { name: 'Profile', exact: true }).tap();
        await actor.page.getByRole('button', { name: /^Admin tools/ }).first().tap();
        await shot(actor, 'admin', testInfo);
      }
    } finally {
      if (actor) {
        await finish([actor], testInfo).finally(() => actor?.close());
      }
    }
  });
}
