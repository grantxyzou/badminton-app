/**
 * A full reload, so the server re-decides what this visitor gets.
 *
 * One function rather than `window.location.reload()` at each site because
 * jsdom cannot perform a navigation, so a test can only prove a reload was
 * ASKED FOR by mocking this module. `SignedOutShell`'s guarded `reloadIntoApp`
 * (the sign-in path) leaves a mark in sessionStorage for the same reason; the
 * explicit reloads of its no-club mode — Done, Joined, Switched, Sign out —
 * have no guard to leave a mark, so they go through here.
 */
export function hardReload(): void {
  window.location.reload();
}
