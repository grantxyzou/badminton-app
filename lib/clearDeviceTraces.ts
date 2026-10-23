import { clearAppBadge } from './appBadge';
import { clearAppShortcuts } from './appShortcuts';
import { clearWidgets } from './widgetBridge';

/** How long sign-out waits for the phone to clear what it shows. */
export const CLEAR_TRACES_MS = 1500;

/**
 * Signing out: the icon's badge, its long-press menu and the home-screen
 * widget carry this person's balance and week, and a shared phone must not
 * keep them for whoever picks it up next.
 *
 * Each is a call into the native shell, and sign-out WAITS for none of them
 * past `CLEAR_TRACES_MS`. It used to `await Promise.all(...)` before clearing
 * the identity, so one native call that never answered left the Sign out
 * button doing nothing at all (Grant's iPhone, 2026-10-23, the first build
 * carrying all three plugins). A call still running when the wait ends carries
 * on in the shell; a failed one is the badge that stays, never a person who
 * cannot sign out. Resolves, never rejects.
 */
export async function clearDeviceTraces(timeoutMs = CLEAR_TRACES_MS): Promise<void> {
  let timer: ReturnType<typeof setTimeout> | undefined;
  const deadline = new Promise<void>((resolve) => {
    timer = setTimeout(resolve, timeoutMs);
  });
  await Promise.race([
    Promise.allSettled([clearAppBadge(), clearAppShortcuts(), clearWidgets()]),
    deadline,
  ]);
  clearTimeout(timer);
}
