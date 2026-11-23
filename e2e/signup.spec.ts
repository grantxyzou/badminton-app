/**
 * The sign-up journey (docs/plans/e2e-test-club.md, step 4): one week, two
 * spots, three players and the organiser, each on their own phone.
 *
 *   1. Player 1 signs up                      → "you have signed up"
 *   2. Player 2 signs up                      → the session is full
 *   3. Player 3 joins the waitlist            → "You're on the waitlist"
 *   4. Player 1 cancels                       → the spot frees
 *   5. Player 3 is moved in automatically     → "you have signed up"
 *   6. The organiser sees the week in Admin
 *
 * Every tap is the player's own, on Home, the way a thumb does it. The list
 * is cleared of the cast before AND after, so a crashed run cannot leave
 * anyone holding a spot. The session costs $0 in the E2E test club, so no
 * money moves.
 */
import { expect, test, type Page } from '@playwright/test';
import { cast } from './personas';
import { assertMockIsLocal } from './target';
import { api, finish, nav, openAs, shot, tapTab, type Actor } from './journey';
import { clearSignups, ensureMockCast, prepareSession } from './cast';

const SIGNED_UP = /you have signed up for this week/i;
const WAITLISTED = /You're on the waitlist/;

const { members, missing } = cast(['organiser', 'player1', 'player2', 'player3']);

test.beforeAll(() => {
  assertMockIsLocal();
});

async function home(page: Page) {
  await tapTab(page, 'Home');
}

async function signUp(actor: Actor) {
  await home(actor.page);
  await actor.page.getByRole('button', { name: 'Sign up for this week' }).tap();
  await expect(actor.page.getByText(SIGNED_UP)).toBeVisible({ timeout: 20_000 });
}

test('sign up, fill, waitlist, cancel, promote', async ({ browser }, testInfo) => {
  test.skip(missing.length > 0, `E2E_ACCOUNTS has no ${missing.join(', ')}`);
  const actors: Actor[] = [];
  const open = async (label: keyof typeof members) => {
    const a = await openAs(browser, members[label]!);
    actors.push(a);
    return a;
  };

  const org = await open('organiser');
  await ensureMockCast(org);
  const p1 = await open('player1');
  const p2 = await open('player2');
  const p3 = await open('player3');
  const names = [p1, p2, p3].map((a) => a.who.rosterName);
  expect(names.every(Boolean), 'every player has a name on the list').toBe(true);

  try {
    await test.step('reset: an open week with two spots and none of the cast on it', async () => {
      await clearSignups(org, names);
      await prepareSession(org, 2);
      for (const a of [p1, p2, p3]) await a.page.reload();
    });

    await test.step('player 1 signs up', async () => {
      await home(p1.page);
      await shot(p1, 'home-before', testInfo);
      await signUp(p1);
      await shot(p1, 'signed-up', testInfo);
    });

    await test.step('player 2 takes the last spot', async () => {
      await signUp(p2);
      await shot(p2, 'signed-up', testInfo);
    });

    await test.step('player 3 finds it full and joins the waitlist', async () => {
      await p3.page.reload();
      await home(p3.page);
      const join = p3.page.getByRole('button', { name: 'Join the waitlist' });
      await expect(join, 'a full week offers the waitlist').toBeVisible({ timeout: 20_000 });
      await shot(p3, 'full', testInfo);
      await join.tap();
      await expect(p3.page.getByText(WAITLISTED)).toBeVisible({ timeout: 20_000 });
      await shot(p3, 'waitlisted', testInfo);
    });

    await test.step('player 1 cancels', async () => {
      await home(p1.page);
      await p1.page.getByRole('button', { name: 'Cancel my spot' }).first().tap();
      const sheet = p1.page.getByRole('dialog');
      await expect(sheet).toBeVisible();
      await shot(p1, 'cancel-sheet', testInfo);
      await sheet.getByRole('button', { name: 'Cancel my spot' }).tap();
      // Inside the club's late-cancel window the sheet asks once more.
      const late = p1.page.getByRole('button', { name: 'Cancel anyway' });
      if (await late.isVisible().catch(() => false)) await late.tap();
      await expect(p1.page.getByText(SIGNED_UP)).toHaveCount(0, { timeout: 20_000 });
      await shot(p1, 'cancelled', testInfo);
    });

    await test.step('player 3 is moved into the freed spot', async () => {
      const rows = await api<Array<{ name: string; waitlisted?: boolean; removed?: boolean }>>(org, 'GET', '/api/players?all=true');
      const row = rows.data.find((r) => r.name === p3.who.rosterName && r.removed !== true);
      expect(row, 'player 3 is on the list').toBeTruthy();
      expect(row?.waitlisted, 'player 3 was promoted off the waitlist').not.toBe(true);
      await p3.page.reload();
      await home(p3.page);
      await expect(p3.page.getByText(SIGNED_UP)).toBeVisible({ timeout: 20_000 });
      await shot(p3, 'promoted', testInfo);
    });

    await test.step('the organiser sees the week', async () => {
      await nav(org.page).getByRole('button', { name: 'Profile', exact: true }).tap();
      await org.page.getByRole('button', { name: /^Admin tools/ }).first().tap();
      await shot(org, 'admin-week', testInfo);
    });
  } finally {
    await clearSignups(org, names).catch((err) => testInfo.annotations.push({ type: 'warning:cleanup', description: String(err) }));
    try {
      await finish(actors, testInfo);
    } finally {
      for (const a of actors) await a.close();
    }
  }
});
