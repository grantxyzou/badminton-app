/**
 * The stringing journey (docs/plans/e2e-test-club.md, step 4): one racket
 * through the shop, seen from both sides.
 *
 *   1. Player 1 asks for a restring with their own string, no price
 *   2. The stringer finds it on the bench, takes it, and moves it along:
 *      received → strung → ready
 *   3. Player 1 sees it ready
 *   4. The stringer marks it picked up
 *   5. The organiser archives and deletes it
 *
 * Kept off production on purpose: a price (it would reach the player's
 * balance and the append-only ledger) and shelf string (a job counts against
 * stock even once deleted). "I have my own" string and no price keep both
 * untouched. The request and the status moves go through the same API the
 * request sheet and the bench buttons call; every screen in between is the
 * real one, photographed and checked.
 */
import { expect, test } from '@playwright/test';
import { cast } from './personas';
import { assertMockIsLocal } from './target';
import { api, finish, openAs, shot, tapTab, type Actor } from './journey';
import { clearJobs, ensureMockCast } from './cast';

const RACKET = 'E2E test racket';
const { members, missing } = cast(['organiser', 'player1', 'stringer']);

test.beforeAll(() => {
  assertMockIsLocal();
});

interface BenchJob {
  id: string;
  memberId: string;
  memberName: string;
  racketLabel: string;
  status: string;
}

test('a restring from request to pick-up', async ({ browser }, testInfo) => {
  test.skip(missing.length > 0, `E2E_ACCOUNTS has no ${missing.join(', ')}`);
  const actors: Actor[] = [];
  const open = async (label: keyof typeof members) => {
    const a = await openAs(browser, members[label]!);
    actors.push(a);
    return a;
  };

  const org = await open('organiser');
  await ensureMockCast(org);
  const player = await open('player1');
  const stringer = await open('stringer');
  const names = [player.who.rosterName];

  const findJob = async () => {
    const bench = await api<{ jobs?: BenchJob[] }>(org, 'GET', '/api/stringing/jobs');
    const job = (bench.data.jobs ?? []).find((j) => j.memberName === player.who.rosterName && j.racketLabel === RACKET);
    if (!job) throw new Error('the request is not on the bench');
    return job;
  };
  const move = async (job: BenchJob, status: string) => {
    await api(stringer, 'PATCH', `/api/stringing/jobs/${encodeURIComponent(job.id)}`, { memberId: job.memberId, status });
  };

  try {
    await test.step('reset: the shop is open and player 1 has no job', async () => {
      await clearJobs(org, names);
      await api(org, 'PATCH', '/api/stringing/shop', { open: true });
    });

    await test.step('player 1 asks for a restring', async () => {
      await player.page.reload();
      await tapTab(player.page, 'Stringing');
      await shot(player, 'stringing-open', testInfo);
      await api(player, 'POST', '/api/stringing/requests', {
        racketLabel: RACKET,
        stringLabel: 'Own string (E2E)',
        ownString: true,
        tensionMains: 24,
        tensionCrosses: 26,
      });
      await player.page.reload();
      await tapTab(player.page, 'Stringing');
      await expect(player.page.getByText(RACKET).first()).toBeVisible({ timeout: 20_000 });
      await shot(player, 'requested', testInfo);
      await tapTab(player.page, 'Home');
      await shot(player, 'home-requested', testInfo);
    });

    const job = await findJob();

    await test.step('the stringer sees it on the bench and takes it', async () => {
      await stringer.page.reload();
      await tapTab(stringer.page, 'Stringing');
      await stringer.page.getByRole('button', { name: 'Stringing jobs' }).first().tap();
      await expect(stringer.page.getByText(RACKET).first(), 'the request is on the stringer’s bench').toBeVisible({ timeout: 20_000 });
      await shot(stringer, 'bench-requested', testInfo);
      await api(stringer, 'PATCH', `/api/stringing/jobs/${encodeURIComponent(job.id)}`, { memberId: job.memberId, claim: true });
    });

    await test.step('received → strung → ready', async () => {
      for (const status of ['received', 'strung', 'ready']) await move(job, status);
      expect((await findJob()).status).toBe('ready');
      await stringer.page.reload();
      await tapTab(stringer.page, 'Stringing');
      await stringer.page.getByRole('button', { name: 'Stringing jobs' }).first().tap();
      await shot(stringer, 'bench-ready', testInfo);
    });

    await test.step('player 1 sees it ready', async () => {
      // The player's view speaks in its own stages (playerStageFor in lib/stringing.ts).
      const mine = await api<{ jobs?: Array<{ racketLabel?: string; stage?: string }> }>(player, 'GET', '/api/stringing/jobs?view=player');
      expect(mine.data.jobs?.find((j) => j.racketLabel === RACKET)?.stage, 'the player’s own view says ready').toBe('ready_for_you');
      await player.page.reload();
      await tapTab(player.page, 'Stringing');
      await shot(player, 'ready', testInfo);
      await tapTab(player.page, 'Home');
      await shot(player, 'home-ready', testInfo);
    });

    await test.step('picked up', async () => {
      await move(job, 'picked_up');
      await player.page.reload();
      await tapTab(player.page, 'Stringing');
      await shot(player, 'picked-up', testInfo);
    });
  } finally {
    await clearJobs(org, names).catch((err) => testInfo.annotations.push({ type: 'warning:cleanup', description: String(err) }));
    try {
      await finish(actors, testInfo);
    } finally {
      for (const a of actors) await a.close();
    }
  }
});
