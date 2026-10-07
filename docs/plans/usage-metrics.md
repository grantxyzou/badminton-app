# Usage metrics — first-party tracking, an admin Metrics page, weekly reports

**Track:** critical path — "prove engagement (kill-criteria)". The value-hub gate needs a number for "do members come back between sessions?", and today that number can only be read for Stats/Gear beacons.
**Status:** in-flight — tracking switched on 2026-10-07 (flag retires 2026-10-21)
**Review on:** 2026-12-09 — has any weekly metrics or UX report changed a decision? If none has, stop the beacons and the two report helpers.

## Problem

Grant, 2026-10-07: "I want to set up some AI/Agent helpers to help me maintain, research, monitor, track, and monitor the app", and then, adding his own items to the list: "Metric dashboard to track how people are moving through my app, feature engagement, and industry standard data tracking and report" and "UX Research based on the user and report UX improvements that are backed by the reserach and user and persona feedback."

What stands in the way today:

- **The usage record is thin.** `events` holds only the Stats/Gear beacons. Sign-up, cancel, sign-in, kudos, stringing and push opt-in leave no event, so "how people move through the app" cannot be answered from it.
- **Nobody can see what there is.** `GET /api/admin/slice0` is admin-only and no screen renders it.
- **Feedback is write-only.** `POST /api/report` stores into `feedback`, and nothing reads it back — no route, no screen. A UX helper has no user voice to cite.
- **A scheduled helper can read nothing.** Every admin GET needs the admin cookie; a cloud routine has none.
- **The privacy policy says "No analytics trackers"**, and the iOS privacy manifest declares no Product Interaction data. Tracking cannot start before both say otherwise.

## Kill criterion

At the 2026-12-09 review: if no weekly metrics report and no UX report has led to a change Grant made or chose not to make, the beacons stop (flag off, then removed), the two report routines are deleted, and the admin page keeps only the metrics that come from data the app already holds for other reasons (sign-ups, payments, kudos).

## Non-goals

- **No third-party analytics** (no Google Analytics, App Insights page views, Segment, PostHog). Everything lives in the app's own `events` container.
- **No per-person view.** The Metrics page and the reports show totals and rates, never a list of names. Nobody's activity is browsable.
- **No tracking of signed-out visitors** and no device fingerprinting.
- **No admin-surface tracking.** Admin tab views are not usage.
- **No in-app opt-out in v1** (see Decisions).
- **The UX helper does not write code.** It reports; Grant decides.
- **No new background job on App Service.** It runs nothing on a schedule; the reports are pulled by cloud routines.

## Decisions

- **First-party, server-written where possible.** Sign-up, cancel, sign-in, account creation, kudos, stringing requests, push opt-in/out and problem reports are written by the route that already does the work, after it succeeds. A client beacon can be forged or blocked; the server knows the outcome. Only `app_open` and `tab_view` are client beacons, because only the client knows them.
- **Only what no record already holds is recorded** (decided building step 5, 2026-10-07). The first cut listed ten server events. Seven of them would have copied a record that already exists — a sign-up or cancel is a `players` row with its own `timestamp` and `removedAt`, a kudos is a `kudos` doc, a stringing request a `stringingJobs` doc, notifications a `pushSubscriptions` doc, a problem report a `feedback` doc — and a copy is a second answer that can drift from the first. So the usage kinds are three: `sign_in` (server, with how), `app_open` and `tab_view` (client beacons). Everything else is read from where it already lives, which is what `clubMetrics()` does.
- **`completeSignIn` gains a REQUIRED `via` argument** rather than each sign-in route writing its own event, so a new sign-in path cannot forget to count itself — the type checker refuses it.
- **One flag, server-read: `NEXT_PUBLIC_FLAG_USAGE_METRICS`.** Every merge deploys, and tracking must not begin before the privacy text and the store labels say it happens. Off: no new kinds are written and the beacon hook does nothing. The metrics that need no tracking work regardless.
- **One metrics owner.** `lib/metrics.ts` `clubMetrics()` is called by both the admin route and the report route, so the page and the weekly report cannot disagree — the `buildReceiptInput` lesson.
- **A tracking-based metric with no data says so.** "Starts when usage tracking is on", never `0`. A zero that means "not measured" is the lying-empty-state rule.
- **A read-only reports key, separate from the payments key.** Same machinery (`<groupId>.<hex>`, sha256 at rest, `timingSafeEqual`) extracted into `lib/clubKey.ts`, but a leaked reports key must not be able to mark anyone paid, and a leaked payments key must not read feedback.
- **Feedback reaches a helper with the person removed**: no `ip`, no `name`, the URL cut to its path (a `?join=` invite token must not travel), operator club only — `feedback` is a GLOBAL container.
- **No in-app opt-out in v1.** The log is first-party, seen only as totals, deleted with the account, and expires after 13 months; the policy offers withdrawal on request. If anyone asks, a per-member switch is a small addition — recorded here so it is a decision, not an oversight.
- **Retention is a Cosmos container TTL on `events`** (396 days), set once with `az`. No purge code to get wrong.
- **WIP cap noted.** ROADMAP allows one active workstream and multi-group is in flight. Grant asked for this directly; it ships dark behind the flag and does not touch the group code paths beyond calling `writeEvent(evt, groupId)`.

## Shape

| Piece | File |
|---|---|
| Event kinds, payload whitelist | `lib/events.ts` (`USAGE_KINDS`), `lib/types.ts` (additive `tab`, `platform`, `via`) |
| Beacon gate + per-member limit | `app/api/events/route.ts` |
| Admin readout | `app/api/admin/slice0/route.ts` `usage` (the reader-coverage gate) |
| Server write (`sign_in`) | `lib/authSession.ts` → `lib/usage.ts`; `via` at all 15 call sites, `null` for the three club re-mints |
| Client beacons (`app_open`, `tab_view`) | `lib/useUsageBeacons.ts`, mounted once in `HomeShell` |
| Metrics math (pure) | `lib/metricsMath.ts` |
| Metrics reads | `lib/metrics.ts` `clubMetrics()` |
| Admin route | `app/api/admin/metrics/route.ts` |
| Admin page | `components/admin/MetricsPage.tsx`, `components/admin/metrics/*` |
| Club key machinery | `lib/clubKey.ts` (extracted from `lib/paymentsInbox.ts`) |
| Reports key + routes | `lib/reportsAccess.ts`, `app/api/reports/{metrics,feedback}/route.ts` |
| Privacy text | `messages/{en,zh-CN}.json` `legal.privacy`, `ios/App/App/PrivacyInfo.xcprivacy` |

**PR order** — each merges on green CI, because the flag keeps tracking dark:

1. This plan.
2. Privacy text + iOS manifest.
3. Metrics module + admin route (existing-data metrics only).
4. Metrics page.
5. Flag, event taxonomy, server writes.
6. Client beacons.
7. Reports key + both report endpoints.
8. Flip — after Grant's checklist: App Store "Product Interaction" label, Play Data safety "App interactions", a Home announcement that the policy changed, then his approval. Sets the TTL; CLAUDE.md and CHANGELOG.
9. Retire the flag 14 days later.

Then two cloud routines read the report endpoints with `BPM_REPORTS_KEY` from the environment: a weekly metrics report (Mondays) and a monthly UX research report (report only).
