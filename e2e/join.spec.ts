/**
 * The join journey (docs/plans/e2e-test-club.md, step 4): a person in no club
 * opens the club's link, asks to join, the organiser says yes, and they land
 * in the club.
 *
 *   1. The joiner, in no club, opens /bpm/j/<token>   → "Join E2E test", their name
 *   2. They ask                                       → "Request sent"
 *   3. The organiser sees the request and approves it
 *   4. The joiner opens the app                       → the club's Home
 *
 * The joiner's own guard (`joinerGuard`) passes only when they belong to NO
 * club, so the only club this can ever put them in is the one whose link the
 * organiser — already through the club guard — read. The reset before and the
 * clean-up after take the joiner off the roster and decline any request left
 * waiting, so every run starts the same.
 */
import { expect, test } from '@playwright/test';
import { cast } from './personas';
import { assertMockIsLocal, baseUrl, target } from './target';
import { api, finish, nav, openApp, openAs, shot, type Actor } from './journey';
import { clubLinkToken, ensureMockCast, removeFromClub } from './cast';
import { Recorder } from './capture';
import { clubGuard, joinerGuard, pinEnglish, signIn } from './session';

const { members, missing } = cast(['organiser', 'joiner']);
/** What the joiner calls themselves on the club's list. */
const JOINER_NAME = 'E2E Joiner';

test.beforeAll(() => {
  assertMockIsLocal();
});

test('a new person asks through the club link and is let in', async ({ browser }, testInfo) => {
  // Production only. The mock store's one club is BPM Core, and removing
  // someone from BPM Core also switches their account off (the rollback copy,
  // `writesMemberCopy` in app/api/members/route.ts), so the joiner the reset
  // removes could never sign in again. The E2E test club is not BPM.
  test.skip(target() === 'mock', 'the mock store’s only club is BPM Core: a removal there switches the account off');
  test.skip(missing.length > 0, `E2E_ACCOUNTS has no ${missing.join(', ')}`);
  const actors: Actor[] = [];
  const org = await openAs(browser, members.organiser!);
  actors.push(org);
  await ensureMockCast(org);

  try {
    await test.step('reset: the joiner is on no roster and has no request waiting', async () => {
      await removeFromClub(org, JOINER_NAME);
    });
    const token = await clubLinkToken(org);

    // The joiner: their own phone, signed in, in no club yet.
    const persona = members.joiner!;
    const context = await browser.newContext();
    await pinEnglish(context);
    const page = await context.newPage();
    const joiner: Actor = {
      persona,
      page,
      rec: new Recorder(page),
      who: { groupId: '', role: 'member', privileged: false, rosterName: JOINER_NAME },
      close: () => context.close(),
    };
    actors.push(joiner);
    joiner.rec.at('joiner:sign-in');
    await signIn(page, persona);
    await joinerGuard(page, persona);

    await test.step('the joiner opens the club link and asks to join', async () => {
      await page.goto(`${baseUrl()}/j/${token}`);
      const form = page.locator('[data-page="join-name"]');
      await expect(form, 'the link opens the club’s join page').toBeVisible({ timeout: 20_000 });
      await shot(joiner, 'join-page', testInfo);
      const field = form.getByRole('textbox').first();
      await field.tap();
      await field.fill('');
      await page.keyboard.type(JOINER_NAME);
      await form.locator('.auth-btn--primary').tap();
      await expect(page.locator('[data-page="request-sent"]'), 'the request was sent').toBeVisible({ timeout: 20_000 });
      await shot(joiner, 'request-sent', testInfo);
    });

    await test.step('the organiser sees the request and approves it', async () => {
      await nav(org.page).getByRole('button', { name: 'Profile', exact: true }).tap();
      await org.page.getByRole('button', { name: /^Admin tools/ }).first().tap();
      await shot(org, 'admin-join-request', testInfo);
      const asks = await api<{ joins?: Array<{ joinRequestId: string; name: string }> }>(org, 'GET', '/api/admin/access-requests');
      const ask = (asks.data.joins ?? []).find((j) => j.name === JOINER_NAME);
      expect(ask, 'the organiser sees the request').toBeTruthy();
      await api(org, 'POST', '/api/admin/access-requests', { joinRequestId: ask!.joinRequestId, decision: 'approve', regular: false });
    });

    await test.step('the joiner lands in the club', async () => {
      // Now in exactly one club; the ordinary guard takes over.
      joiner.who = await clubGuard(page, persona);
      joiner.rec.at('joiner:launch');
      await openApp(page);
      await shot(joiner, 'joined-home', testInfo);
    });
  } finally {
    await removeFromClub(org, JOINER_NAME).catch((err) => testInfo.annotations.push({ type: 'warning:cleanup', description: String(err) }));
    try {
      await finish(actors, testInfo);
    } finally {
      for (const a of actors) await a.close();
    }
  }
});
