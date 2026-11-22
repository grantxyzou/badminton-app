# End-to-end tests in the "E2E test" club

**Track:** the deploy gate. `scripts/smoke-prod.mjs` proves a deploy came back; nothing proves a member can still DO anything on it.
**Status:** in-flight (steps 1 and 3 built, 2026-11-22)
**Review on:** 2026-12-06 — are the personas set up and stored as secrets, and has the read-only tour (step 3) run green against production three times in a row?

## Problem

Grant, 2026-11-22: "I have created a test only group and some 'members'. How would we let this run. The goal is to capture and review the app to ensure there is no bugs."

Two gaps sit behind that. The first is in what we have now:

- **The vitest suite cannot see the app.** jsdom applies no stylesheet and no test walks a real journey across screens (`.claude/skills/verify-ui/SKILL.md`, "Why this exists").
- **`verify-ui` and `help-screenshots.mjs` only run when someone thinks to run them**, and only against the mock store.
- **The mock store hides a whole class of production bugs**: it ignores partition keys and filters by parameter name (CLAUDE.md, Gotchas). A wrong partition key passes CI and quietly does nothing in production.
- **`smoke-prod.mjs` is read-only by design.** It sends GETs only, never signs in and never runs JavaScript, because a monitor must not become a participant in a real club.

The second gap is that we had no safe place to be a participant. The test club fixes that.

## The idea, in one picture

Picture a restaurant that hires a "mystery diner". The diner orders, eats, pays and writes up what went wrong. The diner sits at a reserved table so no real guest's meal is touched, and the restaurant can reset that table afterwards.

- The **E2E test** club is the reserved table.
- The **test members** are the diners.
- A run's **screenshots and error log** are the write-up.

There are two layers, because each one catches bugs the other cannot:

| | Layer 1: mock rehearsal | Layer 2: production mystery diner |
|---|---|---|
| Where | CI, on the in-memory mock store (seeded `fresh-thursday` + `six-feathers`) | https://bpm.grantzou.com/bpm, signed in as test members of **E2E test** |
| When | Nightly and on demand; a required PR check once it has stayed flake-free | After each production deploy, plus "Run workflow" |
| May do | Anything: advance a session, delete an account, wrong PINs, card-pay screens | Only reversible actions inside the test club (see "Allowed on production") |
| Catches | Broken journeys before merge, layout regressions, missing i18n keys | Real-Cosmos-only bugs (partition keys, hand-made containers), CSP/nonce, cookies over HTTPS, `basePath`, the deploy itself |
| Pixel diffs | Yes, because the data is fixed | No, because dates and counts move. Screenshots are kept for review instead |

## Kill criterion

- **Stop at once** if a run ever writes to any club other than E2E test. The guard below exists to make that impossible, so a breach means the design is wrong, not merely unlucky.
- **After four weeks of Layer 2**, cut back to the read-only tour if it has found no real bug and has gone red for no reason more than twice. A red that people learn to ignore is worse than no check (the same reasoning as `smoke-prod.mjs`'s generous deadline).

## Non-goals

- **Apple and Google sign-in.** Both providers block automated browsers. The personas use email and password, which goes through the same `completeSignIn` underneath.
- **Live Stripe card payments on production.** These run in Layer 1 only, up to the hand-off.
- **Push delivery and the native shell.** The shell loads the same URL, so the web journeys cover what it shows. Native-only bits (badge, widgets) stay manual.
- **Load testing.** One instance at B1 serves real members, so we don't stress it.

## Safety rules for Layer 2 (production)

1. **The personas belong to E2E test and to no other club.** Grant's own account is never a persona. A session cookie's `groupId` claim is checked against the person's memberships when the cookie is minted (CLAUDE.md, Auth), so an account with no other membership cannot act on another club even when the code has a bug.
2. **A guard runs before the first write.** After sign-in, every persona reads `GET /api/groups/current` and `GET /api/groups/mine`. The run aborts unless the club is named exactly `E2E test` and it is the only club that persona belongs to.
3. **Allowed on production** (each one is undone in the same run):
   - sign up, cancel, join the waitlist and be promoted
   - mark paid, then unpaid again
   - post an announcement, then delete it
   - give kudos between personas
   - change a profile setting, then put it back
   - for the joiner persona: ask to join, be approved, then leave so they can ask again next run
   - the Stats tab's one-time "See how you compare?" ask, which opens by itself on a persona's first visit and covers the tab bar. Closing it saves "Keep it private" for that persona, which is the cautious answer and is asked only once.
4. **Never on production**:
   - advancing a session
   - `purgeAll`
   - deleting an account
   - wrong-PIN or wrong-password tests (the per-account lock would hold, and the per-IP limiters are shared)
   - card payments
   - anything that emails someone who isn't a persona
5. **Sign in once per persona per run.** The run reuses the cookies (Playwright `storageState`) and works one step at a time (`workers: 1`), because every journey shares one session list. The sign-in limits (20 per hour per IP, 5 per hour per address and IP, `app/api/auth/signin/route.ts`) are far above one sign-in per persona per run.
6. **Persona emails are plus-addresses on an inbox Grant controls**, so verification mail lands somewhere harmless.
7. **Usage metrics are not affected.** Every aggregate in `clubMetrics()` is narrowed to the club's roster, so test traffic only shows up in E2E test's own Metrics page. Step 1 confirms `GET /api/admin/slice0` narrows the same way. If it doesn't, the personas join the staff skip list in `lib/operator.ts`.

## What a run captures (the "write-up")

Each journey step saves the following:

- **A screenshot at a phone viewport (390 px)**, light theme. A weekly run adds dark theme, `zh-CN` and the foldable sizes.
- **Every console error and uncaught page error.**
- **Every response of 400 or above**, except the 401s a step expects.
- **Screen checks that tests can't see today**:
  - a visible i18n key path such as `home.signupCard.title`. next-intl prints the key instead of throwing (CLAUDE.md, Automation hooks).
  - a "Couldn't load" error pill
  - a horizontal scroll (`scrollWidth > innerWidth`)
  - a skeleton still on screen after 10 s
- **An axe-core accessibility pass** on each screen, reported but not failing the run at first.
- **A Playwright trace on failure only**, because a trace for every test costs about a third of the run's CPU.

The output is an HTML report plus a screenshot gallery, uploaded as a private workflow artifact. A review step then opens or updates **one** GitHub issue per red run. The issue lists the findings, each with its screenshot, and links the run. Claude reviewing the gallery for visual problems (an overlap, a clipped label, a card spanning the fold) comes later, in step 5, once the mechanical checks are steady.

## Journeys

Each role walks every tab it can reach. That alone exercises each GET with a real session on real Cosmos.

- **Player:** Home → sign up → see self on the list → cancel → Stats → Stringing → Profile (rank chip absent).
- **Waitlist:** fill the session to capacity with personas, then the next persona lands on the waitlist. One cancels, and the waitlisted persona is promoted.
- **Organiser:**
  - Profile shows the Admin chip
  - Admin: open sign-up, edit the deadline forward, mark paid and then unpaid
  - post and remove an announcement
  - approve the joiner's ask
- **Joiner:** open `/bpm/j/<token>`, which shows "E2E test" as the club. Ask to join, wait for the organiser's approval, land on Home, then leave.
- **Reset fixture (first step of every run, as the organiser):**
  - the session date is set to next week
  - sign-up is open
  - capacity is set
  - no persona is left on the list from a crashed run

## Steps

0. **Grant, about 15 minutes** (only Grant can do this, because it involves real accounts and secrets):
   - Make one organiser persona, an admin in E2E test only.
   - Make three or four player personas, plus one joiner who is in no club.
   - Give each one an email and password ("Keep your account").
   - Store them as GitHub Actions secrets: `E2E_ACCOUNTS` (JSON of persona → email and password; the shape is in `e2e/personas.ts`) and `E2E_INVITE_TOKEN`.
   - Optionally, set the club's id as the repository variable `E2E_GROUP_ID`, which pins the guard to the id as well as the name.
   - Passwords never go in the repo, a chat or a log.
1. **Scaffold.**
   - Add `@playwright/test` and an `e2e/` folder with two projects, `mock` and `prod`.
   - Write the persona sign-in helper with `storageState`.
   - Write the club guard (Safety rule 2).
   - Write the capture helpers listed under "What a run captures".
   - Write a canary test that fails if a `prod` spec runs without the guard.
2. **Layer 1 journeys on the mock store** as a nightly workflow plus "Run workflow". Not a required check until it has stayed flake-free for two weeks.
3. **Layer 2 read-only tour:** sign in, visit every tab as each role, capture. No writes beyond sign-in and the usage beacons. It runs as a job after `smoke` in `deploy-next.yml` with `continue-on-error: true`, so it cannot turn a deploy red until it has earned that.
4. **Layer 2 write journeys** with the reset fixture.
5. **Review automation:** one issue per red run, then Claude's visual pass over the gallery.

<!-- Everything below is appended as the work proceeds. -->

## Decisions

- **The tour signs in through the API, then drives the screens.** Typing a password into the sign-in page on every run would spend each run re-testing that one page. It gets its own journey in step 4. The API sign-in uses the same `completeSignIn`.
- **A persona's role comes from the server, never from its label.** `clubGuard` reads `GET /api/groups/current`. A secret labelled "organiser" that belongs to a player gets the player's tour.
- **The guard runs even on the mock**, but there it only reads the role. The name and single-club checks apply on production only, because the mock's personas live in BPM Core.
- **The mock target refuses any host that is not this machine.** Its personas are the seeded famous players with known PINs. Sent to production, they would be sign-in attempts against real accounts that share those names (`assertMockIsLocal`).
- **`localhost`, not `127.0.0.1`, for the mock.** `next dev` refuses its own scripts to an origin it doesn't recognise, so on `127.0.0.1` the page never hydrated and the launch screen never lifted.
- **Errors fail the run, warnings only report.** The first mock run showed why: the AI read answers 503 offline (there's no Anthropic key), and a chunk 404 appears in dev only. A 503 from `/api/stats/insight` is a warning on the mock and stays an error on production, where the key exists.
- **The tour is its own workflow (`e2e.yml`), not a job in `deploy-next.yml`.** It starts on `workflow_run` after a successful deploy, so a red tour can't turn a deploy red, and the deploy workflow (which ships to every phone) is left untouched.
- **The mock job boots `npm run dev:next:mock`, not a production build.** That script is the one place the full flag list and the seeds already live together, so the tour can't drift from them. The standalone build is already checked by `pr-ci.yml`.
- **Full-page screenshots hide the tab bar.** A full-page capture stitches `position: fixed` elements into the middle of the image, which reads as a bug that isn't there.
- **Not yet: axe accessibility, the write journeys, the issue-per-red-run.** These are steps 4 and 5. The capture list above describes the destination.

## Shape

| Piece | File |
|---|---|
| Config: one worker, phone viewport, traces on failure | `e2e/playwright.config.ts` |
| Mock or production, and the local-only rule for the mock | `e2e/target.ts` |
| The personas; `E2E_ACCOUNTS` parsing, which never echoes the secret | `e2e/personas.ts` |
| Sign-in, the English cookie, the club guard | `e2e/session.ts` |
| What each screen records | `e2e/capture.ts` |
| The read-only tour | `e2e/tour.spec.ts` |
| The Markdown summary for the job page | `e2e/summary.mjs` |
| The guard's own tests (vitest) | `__tests__/e2e-guard.test.ts` |
| The workflow: mock nightly and on demand; prod after each deploy, nightly and on demand | `.github/workflows/e2e.yml` |

Run it locally: start `PORT=3100 npm run dev:next:mock`, then `E2E_TARGET=mock npm run e2e`. In the cloud container, add `E2E_CHROMIUM_PATH=/opt/pw-browsers/chromium`. Results go to `e2e-results/` (gitignored): the screenshots in `screens/`, the HTML report in `report/`.
