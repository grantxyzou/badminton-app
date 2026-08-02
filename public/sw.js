/**
 * BPM Badminton — push-only service worker.
 *
 * POLICY: this worker deliberately has NO `fetch` handler, and must never gain
 * one. See CLAUDE.md ("Push Notifications" + the offline posture bullet).
 *
 * The app's offline posture is "legible-fail": a broken backend must LOOK
 * broken, never be papered over with stale cached bytes. A service worker that
 * intercepts `fetch` is exactly how that guarantee gets silently reversed — it
 * is the mechanism behind the class of bug documented in
 * `feedback_cosmos_silent_failure_diagnosis.md`. A worker with no `fetch`
 * handler cannot intercept navigations or asset requests at all, so registering
 * this file changes nothing about how the app loads, online or off.
 *
 * Consequence worth knowing: Chrome's automatic install prompt requires a
 * `fetch` handler, so we still don't get one on Android (manual "Add to Home
 * screen" only). That is an accepted trade, not an oversight.
 *
 * `__tests__/service-worker.test.ts` asserts the no-fetch-handler rule.
 *
 * basePath gotcha: this file is served at `/bpm/sw.js` (scope `/bpm/`), but
 * paths INSIDE it are not rewritten — every URL below is hand-prefixed, the
 * same convention `app/manifest.ts` documents.
 */

// Bump to force a byte change so browsers install a fresh worker.
const SW_VERSION = '1';

const BASE = '/bpm';
const ICON = `${BASE}/icons/icon-192.png`;
const FALLBACK_TITLE = 'BPM Badminton';
const FALLBACK_BODY = 'Open the app for details.';

self.addEventListener('install', () => {
  // No precaching — there is nothing to cache. Activate immediately so the
  // first push after opt-in is handled by this worker rather than waiting for
  // every tab to close.
  self.skipWaiting();
});

self.addEventListener('activate', (event) => {
  // Logged so "which worker does this device actually have?" is answerable from
  // a phone's remote-inspect console — the only practical way to tell whether a
  // stale worker is behind a missing notification.
  console.log(`[sw] BPM push worker v${SW_VERSION} active`);
  // Needed so `clients.matchAll` below can see windows that loaded before this
  // worker activated. Not a caching concern.
  event.waitUntil(self.clients.claim());
});

self.addEventListener('push', (event) => {
  // A malformed or absent payload must still surface SOMETHING — a push that
  // throws here shows no notification at all on some browsers and burns the
  // user's permission grant for nothing.
  let title = FALLBACK_TITLE;
  let body = FALLBACK_BODY;
  let url = `${BASE}/`;
  let tag;

  try {
    const data = event.data ? event.data.json() : null;
    if (data && typeof data === 'object') {
      if (typeof data.title === 'string' && data.title) title = data.title;
      if (typeof data.body === 'string' && data.body) body = data.body;
      if (typeof data.url === 'string' && data.url.startsWith(BASE)) url = data.url;
      if (typeof data.tag === 'string' && data.tag) tag = data.tag;
    }
  } catch {
    /* keep the fallbacks */
  }

  event.waitUntil(
    self.registration.showNotification(title, {
      body,
      icon: ICON,
      badge: ICON,
      tag,
      // `tag` alone collapses duplicates silently; renotify:false keeps a
      // re-send from re-buzzing the phone for the same logical event.
      renotify: false,
      data: { url },
    }),
  );
});

self.addEventListener('notificationclick', (event) => {
  event.notification.close();

  const target =
    (event.notification.data && event.notification.data.url) || `${BASE}/`;

  event.waitUntil(
    self.clients
      .matchAll({ type: 'window', includeUncontrolled: true })
      .then((clientList) => {
        // Prefer focusing an already-open BPM window over spawning a second one.
        for (const client of clientList) {
          if (client.url.includes(BASE) && 'focus' in client) {
            return client.focus();
          }
        }
        if (self.clients.openWindow) return self.clients.openWindow(target);
        return undefined;
      }),
  );
});
