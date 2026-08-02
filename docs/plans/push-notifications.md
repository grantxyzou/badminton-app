# Push Notifications

Flag: `NEXT_PUBLIC_FLAG_PUSH_NOTIFY`

## Why

Players had no way to learn that sign-ups opened, that the deadline was near, or that they owed money — unless they happened to open the app. Everything a notification would *say* was already computed and frozen (`Player.owedAmount` at settle, `classifyOwed` / the ledger's `byPlayer`, `Session.deadline`, the admin `signupOpen` toggle). What was missing was delivery.

Three gaps had to be closed: no service worker (deliberate policy), no contact data of any kind on `Member`, and no scheduler anywhere in the app or CI.

## Decisions

**Web Push, not email.** Email would have reused the existing nodemailer setup and needed no install, but it's easy to ignore for a same-week "sign-ups close tonight" nudge, and it would have required collecting and storing an address for every member. Push reaches the lock screen, costs nothing per message, and the PWA install path already exists (`InstallSheet` / `InstallBanner`). The cost is the iOS constraint below.

**A push-only service worker.** `app/manifest.ts` and `CLAUDE.md` both asserted "no service worker by design", because a `fetch` handler is exactly how the legible-fail offline posture gets silently reversed. A worker with **no `fetch` handler** cannot intercept navigations or asset requests at all, so it resolves the conflict rather than trading it away. `__tests__/service-worker.test.ts` enforces this, and also bans the Cache Storage API so a later `message` handler can't reintroduce caching by another route.

**Its own container, not a field on `Member`.** `Member` is read on hot paths by both deployments; a per-device array would make it a write-contention hot doc. A new container also cannot break bpm-stable, satisfying the additive-only schema rule for the shared DB.

**Sign-ups-open first.** The full pipeline shipped, but only one trigger is wired. The server path (container → send library → routes → admin self-test) landed *before* any UI, so the genuinely hard parts — SW registration, VAPID agreement, iOS standalone — were proven on a real phone via `POST /api/push/test` while the surface area was still small.

## Shape

| Piece | File |
|---|---|
| Service worker (push + notificationclick, no fetch) | `public/sw.js` |
| Send library (env-gated, lazy import, batched, self-healing) | `lib/push.ts` |
| Notification copy (pure) | `lib/pushMessages.ts` |
| Subscribe / unsubscribe | `app/api/push/subscribe/route.ts` |
| Admin transport self-test | `app/api/push/test/route.ts` |
| Trigger (signupOpen false→true edge) | `app/api/session/route.ts` (PUT) |
| Client state machine | `lib/usePush.ts`, `lib/push-client.ts` |
| Opt-in UI | `components/PushSheet.tsx`, row in `components/ProfileTab.tsx` |

Container `pushSubscriptions`, PK `/memberId`. One doc per device, deduped on `endpointHash` (sha256 of the endpoint — the endpoint itself is a send credential and never leaves the server). Cap 10 devices/member, oldest-`lastSeenAt` evicted.

## Things that are easy to get wrong

- **The edge is `existing.signupOpen === false`, not `!== true`.** An absent `signupOpen` means *open* (documented in CLAUDE.md), so absent→true is not a transition and must not notify. Sessions from `/advance` always set `signupOpen: false` explicitly, so the real flow is always an explicit false→true.
- **410/404 deletes the subscription; every other status keeps it.** A transient 500 that evicted subscriptions would silently unsubscribe live users. Asserted in both directions.
- **`NEXT_PUBLIC_VAPID_PUBLIC_KEY` is baked at build time.** Setting it only in Azure App Settings leaves the client reading `undefined` and `subscribe()` throws. It must be in `deploy-next.yml`'s build `env:`. `scripts/check-flag-sync.mjs` only guards `NEXT_PUBLIC_FLAG_*` and will not catch this.
- **VAPID rotation is destructive** — subscriptions are bound to the key that created them, and rotating breaks every one with no 410 to clean up. One pair across next + stable; rotation means purging the container.
- **The stamps go in the same upsert as the flip.** A second write would race the optimistic toggle in `NextSessionCard` and could double-send.
- **Both deployments share one Cosmos DB.** Stable has the flag off, so stable users can't subscribe and stable's PUT won't fire — meaning during the soak, notifications only fire when the admin toggles sign-ups **from the bpm-next URL**. This reads as "push is broken" if you don't know it.

## Deferred (Phase 2)

- `POST /api/push/send` — cron-called, so shared-secret auth (SHA-256 both sides, then `timingSafeEqual`). Must **fail closed**: `PUSH_CRON_SECRET` unset or under 32 chars → `503`, never "allow when unconfigured".
- `.github/workflows/push-cron.yml` — twice-hourly. The endpoint must be **window-based** ("deadline within N hours and no `deadlineNotifiedAt`"), never tick-based: GitHub cron drifts 5–20 minutes and occasionally skips, so a duplicate tick must be a no-op and a missed one must be recoverable by the next. Secret lives in both GitHub Secrets and Azure App Settings; `curl -f` makes a mismatch loud.
- **`deadline_soon`** — target only members *not* already signed up. Reminding someone who's already in is pure noise, and that filter is the whole value.
- **`payment_reminder`** — reuse `stampedPlayers` from settle, or `byPlayer.stillOwes` / `classifyOwed`. Do **not** grow a fourth owed-computation; settle, `members/[id]/history`, and `buildReceiptInput` each already grew their own.
- `topics[]` per-type opt-out; additive `Member.locale` for localized payloads; a `pushsubscriptionchange` SW handler for silent re-subscription.
