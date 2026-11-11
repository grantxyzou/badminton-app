---
paths:
  - "lib/push*.ts"
  - "lib/usePush.ts"
  - "lib/fcm.ts"
  - "lib/notices.ts"
  - "lib/useNotices.ts"
  - "public/sw.js"
  - "app/api/push/**"
  - "app/api/notifications/**"
  - "app/api/session/route.ts"
  - "components/PushSettings.tsx"
  - "components/Notifications*.tsx"
  - "__tests__/push*.test.ts"
---

# Push Notifications

<!-- Moved word for word from the root CLAUDE.md "Push Notifications" section on 2026-11-08 (it was over the 150k-character limit). The root keeps the always-follow rules; this file loads when Claude touches a matching path. -->

Web Push, plus FCM for the native shell (unconditional; `NEXT_PUBLIC_FLAG_PUSH_NOTIFY` retired 2026-09-10, #353). **Seven triggers, every one best-effort after its primary write** — listed in `docs/plans/push-notifications.md`. Sign-ups open is below; announcements (`app/api/announcements/route.ts`) went to the roster the same way in #596, so no trigger calls `sendPushToAll` any more.

- **The service worker is push-only and must stay that way.** `public/sw.js` handles `push` + `notificationclick` and has **no `fetch` handler** — that's what keeps the "legible-fail" offline posture intact (a worker that can't intercept requests can't serve stale bytes or mask a broken backend). `__tests__/service-worker.test.ts` asserts this, plus the absence of the Cache Storage API. Consequence: Chrome's automatic install prompt still requires a fetch handler, so Android remains manual "Add to Home screen" — an accepted trade.
- **Serving**: `public/sw.js` → `/bpm/sw.js` (Next serves `public/` under `basePath`; `deploy-next.yml` copies `public/` into the standalone bundle manually). Default scope is therefore `/bpm/`, matching the manifest — **no `Service-Worker-Allowed` header needed**. CSP has no `worker-src`, so it falls back to `default-src 'self'` — **no CSP change needed**. Paths *inside* `sw.js` are not rewritten by Next; they're hand-prefixed via a `BASE` const, same gotcha as `app/manifest.ts`.
- **Registration is lazy and gesture-driven** — `usePush().enable()` registers, so a user who never opts in has no worker on their device at all. `disable()` unregisters once no subscriptions remain.
- **Container `pushSubscriptions` (PK `/memberId`)** — one doc per device, deduped on `endpointHash` (sha256 of the endpoint; safe to log, unlike the endpoint itself, which is a send credential and is never returned to a client). Cap 10 devices/member, oldest-`lastSeenAt` evicted. Deliberately NOT a field on `Member`: that doc is read on hot paths by both deployments and a device array would make it a write-contention hot doc.
- **`lib/push.ts` is the only sender.** Env-gated no-op first (`isPushConfigured()`), lazy `await import('web-push')`, batches of 20 via `Promise.allSettled`, and **never throws** — it always resolves a `PushResult`. Title/body truncation lives here, not at call sites, so no caller can blow the ~4KB post-encryption cap.
- **Every push is also a NOTICE on the Notifications page** (`lib/notices.ts`, `docs/plans/notification-center.md`, #769): the bell beside the language and theme toggles opens a full page, with a red dot for anything new. `recordNotices` is called BESIDE `sendPushToMembers` with the same recipient list, never inside it, because that sender no-ops without VAPID and reaches only people with a device row, and most members have none. A notice stores the facts (`NOTICE_TYPES`), never the push's English sentence, so the page renders it through `t()`; it never throws. Rows are `kind: 'notice'` plus one `kind: 'noticesSeen'` doc per member per club in `insights` — no new container. **The page's CODE is not in the first download** (2026-11-06, Grant: "Notification should load after, then render the red dot"): the bell (`NotificationsButton`) reads the list itself for its dot, and `HomeShell` fetches `NotificationsPage` in the background with the other tabs and renders the loaded module directly (as it does Admin's), with `NotificationsFallback` for a tap that beats it; `bundle-split-canary` fails on a static import.
- **410/404 deletes the subscription; every other status keeps it.** Getting this backwards would silently unsubscribe live users on a transient 500. Asserted both ways in `__tests__/push-lib.test.ts`.
- **Trigger**: `PUT /api/session` compares the doc it already read for the merge. The edge is strict `existing.signupOpen === false && next === true` — **absent `signupOpen` means open** (see the gotcha below), so `!== true` would misfire on legacy docs. Two additive optional `Session` fields: `signupOpenedAt` (plain history, written regardless of the flag; it's the value `calculateSignupOpensOffset` in the advance route still hardcodes to 0) and `signupOpenNotifiedAt` (the de-dupe stamp — toggling closed→open again does not re-send). Both are stamped in the **same** upsert as the flip, so there's no second write to race the optimistic client toggle in `NextSessionCard`.
- **Send is best-effort after persist** — a push failure logs and never fails the admin's toggle (same posture as `app/api/report/route.ts`). The `PUT` response shape is unchanged; `NextSessionCard` spreads it into state.
- **`POST /api/push/test`** (admin-only) sends to the calling admin's own devices. This is how you prove SW + VAPID + iOS on a real phone *before* trusting any trigger.
- **Env vars**: `NEXT_PUBLIC_VAPID_PUBLIC_KEY` (client, **build-time** — must be in `deploy-next.yml`'s build `env:`, NOT only Azure App Settings, or the client reads `undefined` and `subscribe()` throws), `VAPID_PRIVATE_KEY` + `VAPID_SUBJECT` (server, runtime, App Settings). Note `scripts/check-flag-sync.mjs` only checks `NEXT_PUBLIC_FLAG_*` and will **not** catch a missing VAPID key.
- **Rotating the VAPID pair is destructive** — every subscription is bound to the key it was created with, and regenerating breaks them all with no 410 to clean up. Use one pair across next + stable; treat rotation as "purge the container, everyone re-opts-in."
- **A member push is in the DEVICE's language** (2026-11-05, `docs/plans/audit-followups.md`). The SW has no next-intl access, so the words are chosen server-side: `PushSubscriptionDoc.locale` is stamped from `NEXT_LOCALE` at subscribe and updated by `PATCH /api/push/subscribe` when the language toggle is tapped, and `sendPushToMembers` takes either a payload or a `(locale) => payload` builder and sends one payload per language. Member pushes are worded from `messages/*.json` → `push` (`lib/pushMessages.ts`), times in `America/Vancouver` — the server's own zone is UTC, and 8 PM Thursday once read as 4 AM Friday. Admin-only pushes stay English, like the admin screens. A device subscribed before the field existed reads as English.

## Gotchas

<!-- Moved word for word from the root CLAUDE.md "Gotchas" on 2026-11-09, to keep the always-loaded file short. -->

- **iOS push requires the INSTALLED PWA**: Safari exposes `PushManager` only to a home-screen app (iOS 16.4+), never to a browser tab. `usePush` detects this with three agreeing signals (`isIOS() && !isStandalone() && !('PushManager' in window)`) because `isStandalone() === false` is documented as "unknown", not a confirmed negative. That branch MUST be checked before the generic "no push support" branch — otherwise iPhone users in a tab get a dead end instead of the actionable "add it to your Home Screen" path.
- **`Notification.permission === 'denied'` is a permanent dead end**: `requestPermission()` resolves `'denied'` immediately without prompting, so there is no way to re-ask from JS. The UI must say so honestly and render no button — offering one that silently does nothing is worse than saying "you'll have to change this in browser settings."
