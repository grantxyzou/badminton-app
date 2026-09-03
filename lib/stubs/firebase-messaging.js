/**
 * Stands in for `firebase/messaging` in the WEB build.
 *
 * `@capacitor-firebase/messaging` ships a web implementation that imports the
 * Firebase JS SDK, and Turbopack must resolve every dynamic import at build
 * time — so without this, the app 500s on the web the moment
 * `NativeBridge` or `usePush` mentions the plugin, even though that code only
 * runs inside `isNative()`.
 *
 * On native the plugin never touches its web implementation (the bridge
 * answers), and on the web we never call it (web push is VAPID via
 * `lib/usePush.ts`). So the honest replacement is a module that exports the
 * same names and throws if anything ever does reach it. Wired in
 * next.config.js `turbopack.resolveAlias`; `__tests__/firebase-stub.test.ts`
 * keeps the export list in step with the plugin's import list.
 */
function unavailable() {
  throw new Error('firebase/messaging is not bundled for the web — push on the web is VAPID (lib/usePush.ts)');
}

export const deleteToken = unavailable;
export const getMessaging = unavailable;
export const getToken = unavailable;
export const onMessage = unavailable;
/** The one call the plugin may make eagerly; "not supported" is the truthful answer here. */
export const isSupported = async () => false;
