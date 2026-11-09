---
paths:
  - "lib/metrics*.ts"
  - "lib/operator.ts"
  - "lib/useUsageBeacons.ts"
  - "lib/engagement.ts"
  - "lib/events.ts"
  - "lib/reportsAccess.ts"
  - "lib/clubKey.ts"
  - "lib/authSession.ts"
  - "app/api/events/**"
  - "app/api/admin/metrics/**"
  - "app/api/admin/slice0/**"
  - "app/api/reports/**"
  - "components/admin/MetricsPage.tsx"
  - "app/error.tsx"
  - "app/global-error.tsx"
  - "__tests__/*metrics*.test.ts"
  - "__tests__/usage-*.test.ts"
  - "__tests__/admin-slice0-route.test.ts"
  - "__tests__/useUsageBeacons.test.tsx"
  - "__tests__/components/MetricsPage.test.tsx"
---

# Usage metrics (first-party tracking, the Metrics page, the report keys)

<!-- Moved word for word from the root CLAUDE.md on 2026-11-09 (step 2 of the trim), to keep the always-loaded file short. -->

`docs/plans/usage-metrics.md`, its flag `NEXT_PUBLIC_FLAG_USAGE_METRICS` was ON from 2026-10-07 and retired 2026-10-21, ON branch kept, so stopping the beacons is now a code change, not a setting. **Three usage kinds only**, in the existing append-only `events` container: `sign_in` (written by `completeSignIn`, whose `via` argument is REQUIRED so no sign-in path can forget it; group create/join/switch pass `null`), and the `app_open` / `tab_view` beacons from `lib/useUsageBeacons.ts` (mounted once in `HomeShell`, signed-in only, admin tab excluded, `tab` and `platform` from bounded lists). Sign-ups, cancels, kudos, stringing, push and reports are counted from their OWN containers, never re-logged as events. **The operator is STAFF** (roles v2 PR 4, 2026-11-03): the ids in `OPERATOR_MEMBER_IDS` skip those three kinds (`skipsUsageRecord` in `lib/operator.ts`, read by `POST /api/events` and `recordSignIn`) so one person checking a payment ten times a day cannot carry a club of thirty's daily-active; a `client_error` from that phone is still written, and the list IS the staff list — no field, no setter (`__tests__/usage-staff.test.ts`). **A fourth kind is an ERROR, not usage** (`client_error`, 2026-10-25, `docs/plans/client-error-beacon.md`): `reportClientError()` in `lib/engagement.ts`, fired from `app/error.tsx` and `app/global-error.tsx`, at most 3 per page load and never for a stale-chunk error (which reloads itself), carrying only `where` (`ERROR_WHERES`) and the tab — no message, stack or URL. It is read as `clientErrors` by `GET /api/admin/slice0` and `clubMetrics()` (last 7 days, roster-narrowed), so the key-protected report carries it into the daily health check; it is how a screen that breaks in a player's browser gets noticed without the player saying so.
- **`lib/metrics.ts` `clubMetrics()` is the one reader**; the admin `GET /api/admin/metrics` and the key-protected `GET /api/reports/metrics` both call it, so the page and the weekly report cannot disagree. `lib/metricsMath.ts` is pure. Every aggregate is narrowed to the roster, and a metric without enough data is `null` ("—"), never 0 — the lying-empty-state rule on a screen an admin decides from.
- **Totals only, never a list of names.** `GET /api/reports/feedback` is operator-club only and strips `ip` and `name` and cuts `url` to its path (an invite token rides in the query).
- **`x-reports-key`** is a read-only per-club secret minted on the Metrics page (`lib/reportsAccess.ts`, hashed in `clubSettings`, compared through `lib/clubKey.ts` — the same helper the payments key uses). The scheduled report helpers read it from the `BPM_REPORTS_KEY` environment variable; it is never pasted into a chat.
- **Retention is a Cosmos container TTL on `events`** (396 days, set in the portal), not purge code. The privacy policy promises 13 months; account deletion already deletes a member's events.
- **Never point a browser at production to test this** — it writes real `app_open` / `tab_view` rows. Use the mock store (`SEED_DEV_SCENARIO=metrics-history`).
