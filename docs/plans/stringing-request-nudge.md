# A stringing request nobody answers nudges the stringers

**Track:** North Star pillar 4 (equipment service). This follows from the review in `docs/plans/stringing-audit-fixes.md`, which found a player's request still waiting.
**Status:** in-flight
**Review on:** 2026-12-16 — `stringingRequests` on `GET /api/reports/metrics`: is `unanswered` 0, and did `answeredWithin24h` or the share answered within 48 hours rise against the 2026-11-12 reading (1 of 6 within a day, 1 unanswered)? Also: did the hourly tick run every hour (the `tick` workflow's run list)?

## Problem

On 2026-11-12, the review of the stringing audit read 6 player-made requests in 28 days. One had nobody on it. The report gives counts only, so nobody could say whose racket it was, and nothing had told anyone it was waiting.

Grant, 2026-11-12: *"when a request has been unanswered for too long, system should push or nudge stringers or assigned stringer in notification and highlight the job"*

The new-request push (#598) goes once, to admins, when the request is made. After that, a request nobody picks up is silent. The bench's "N waiting" count is there only if someone opens the bench.

## Kill criterion

- **After four weeks of nudges, requests still sit unanswered.** If `unanswered` is not 0 on 2026-12-16, or the time to answer has not improved, the nudge is noise. Stringers ignore it like the first push, and the fix is a person, not another notification. Remove the nudge job rather than add a third reminder.
- **The tick misses hours.** If the `tick` workflow's runs show gaps of more than three hours on most days, GitHub's schedule is not reliable enough to hang timed work on. Move the job to the next app open instead (the members-first window's pattern).

## Non-goals

- **Nudging the player.** If a request is assigned but the racket was never handed over, the player is the one holding it up. That is a separate notice and a separate decision.
- **A third reminder, or a daily one.** Grant chose two: 48 hours, then 3 days.
- **Moving other timed jobs onto the tick in this change.** The payment reminders, the ledger reconcile and the members-first release stay where they are. Each move is its own PR, made once the tick has run for a while.
- **Stringers assigning jobs to someone else, pricing them, or seeing money.** A stringer may take an unclaimed request for themselves. Nothing more.

## Decisions

Grant, 2026-11-12, answering four questions:

- **48 hours** with nobody on the request before the first nudge (`REQUEST_NUDGE_HOURS` in `lib/stringingWaiting.ts`).
- **Who:** every member with the stringer switch on in that club, plus its organisers (with groups off: the admins), minus the player who asked. Grant: "Whoever the main stringer and organizer is", then, offered the choice, "Every member with stringer on".
- **Twice:** at 48 hours, and again at 3 days. Then silence. The bench's highlight stays until someone takes the job.
- **What sets it off: an hourly GitHub tick**, chosen because it can carry other timed work later. Grant asked "which one has more reusable usecase?". Today the members-first release waits for the next app open, and the payment reminders and the money check wait for BPM Core's Gmail script, so a club without that script gets neither. A tick can run all of them for every club.

Following from those:

- **A stringer who is not an admin now sees unclaimed requests and can take one.** Before, their card showed only jobs assigned to them, so a nudge to them would have opened an empty screen. That was the reason #598 sent the first push to admins only. The stringer view returns `unclaimed` beside `jobs`, through the same money-free projection (`toStringerJob`). `PATCH` from a stringer accepts `{ memberId, claim: true }` on a job that is still `requested` with nobody on it, and sets the stringer to themselves. Two stringers tapping at once: the second write fails its etag and gets `409 changed_elsewhere`. Assigning to someone else stays an admin's.
- **An assigned job still at `requested` after 48 hours nudges only its stringer.** Their name is on it, so the job is theirs to chase.
- **Each nudge is stamped on the job before it is sent** (`StringingJob.requestNudgedAt`, additive, one entry per nudge), under the job's etag, so the job is never nudged twice. Same posture as the payment reminders: a crashed run can miss a nudge but never double one. If the tick was down past both marks, one nudge goes out and both are stamped. No catch-up burst.
- **No money and no spec in the push**: "Lin's Astrox 88D Pro has waited 2 days." Same lock-screen rule as every stringing push. An admin or organiser opens the bench (`?tab=admin`), and any other stringer opens their card (`?tab=stringing`).
- **No entry on the Notifications page.** The two stringer pushes already shipped (a new request, an assignment) record none. They are staff alerts about the bench, and the bench and the stringer's card are where the work is listed. This one follows them. If stringers ask "what was that notification?", add a notice type for all three together.
- **The highlight:** any request still `requested` past 48 hours gets an amber fill on its card and a "Waiting 2 days" line, on the bench and on a stringer's card. The fill is a tint, never a border, per the containers rule.
- **The tick is one key-protected route,** `POST /api/cron/tick`, with header `x-cron-key` checked against the `CRON_KEY` App Setting. Both sides are hashed and compared with `timingSafeEqual`. Unset answers 503, never an open door. The rate limit runs before the key check. It walks every open club and runs each registered job (`TICK_JOBS` in `lib/tick.ts`), counting results and never naming anyone. One job failing does not stop the others. `.github/workflows/tick.yml` calls it hourly at :23 with the `CRON_KEY` repository secret, and skips quietly while the secret is unset.

## Shape

| Piece | File |
|---|---|
| The waiting rule (hours, marks, due nudges) | `lib/stringingWaiting.ts` |
| The nudge job | `lib/stringingNudge.ts` |
| The push | `lib/pushMessages.ts` (`buildRequestWaitingPayload`), `messages/*.json` (`push.requestWaiting`) |
| The tick: key, registry, club list | `lib/tick.ts` |
| The route | `app/api/cron/tick/route.ts` |
| The schedule | `.github/workflows/tick.yml` |
| Unclaimed requests for a stringer, and their claim | `app/api/stringing/jobs/route.ts`, `app/api/stringing/jobs/[id]/route.ts` |
| The stringer's card | `components/stringing/StringerJobsCard.tsx` |
| The highlight | `components/stringing/JobCard.tsx`, `app/globals.css` (`.bpm-job-card--waiting`) |

## Setting it up

1. Make a long random key (`openssl rand -hex 32`).
2. Add it as the `CRON_KEY` App Setting on `vnext-badminton-app`.
3. Add the same value as the `CRON_KEY` secret on the GitHub repository (Settings → Secrets and variables → Actions).
4. Run the `tick` workflow once by hand from the Actions tab. Its log prints what each job did (counts only).
