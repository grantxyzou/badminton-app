import type { PushState } from './usePush';

/** The two asks a waitlist join can earn. */
export type WaitlistPingKind = 'enable' | 'app';

/**
 * Which ask a waitlist join earns, if any (`docs/plans/waitlist-push-ask.md`).
 *
 * - Push already on: none. The waitlist card says "You'll get a ping" instead.
 * - Still checking: none. Unknown is not "off" (CLAUDE.md).
 * - On the web: point to the store app, which is where notifications are
 *   turned on (Grant, 2026-11-04), whatever this browser could do itself.
 * - In the store app with push off: turn it on, one tap.
 * - Denied or unsupported in the store app: none. A button that cannot work
 *   is worse than no button.
 */
export function waitlistPingKind(push: PushState, webApp: boolean): WaitlistPingKind | null {
  if (push.status === 'loading' || push.status === 'on') return null;
  if (webApp) return 'app';
  return push.status === 'off' ? 'enable' : null;
}
