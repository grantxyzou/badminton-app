# Client error beacon

Track: usage metrics (docs/plans/usage-metrics.md) — knowing what is broken without a player having to say so.
Status: in-flight

## Problem
Grant (2026-10-24): "When a button or feature fails how would we know without you in it?" Today the daily health check proves the site and API answer; a screen that crashes in a player's browser reaches no server, so nobody hears of it unless a player reports it.

## Kill criterion
If a month of beacons shows zero crashes and no player-reported breakage went unseen, the beacon has earned nothing and can go. If it floods, the per-page cap is wrong.

## Non-goals
No messages, stacks or URLs (the `events` payload stays a bounded vocabulary). No failed-request (5xx) beacon yet — there is no central fetch wrapper to hook, so that is a separate piece. No anonymous visitors (the route needs a member cookie).

## Shape
- New client kind `client_error`, payload `where` (`ERROR_WHERES`, `render` only) and optional `tab`, in `lib/events.ts`.
- `reportClientError()` in `lib/engagement.ts` (3 per page load), called from `app/error.tsx` (not for stale-chunk errors, which reload themselves) and `app/global-error.tsx`.
- Readers: `GET /api/admin/slice0` (`clientErrors`) and `clubMetrics().clientErrors` (last 7 days, roster-narrowed), so the key-protected `GET /api/reports/metrics` carries it into the daily health report.
