import { hasNativePlugin, isNative } from './native';

/**
 * One light tap under the finger when a sign-up lands. Native shell only.
 *
 * Silent everywhere it cannot be felt, and never an error:
 * - On the web there is nothing to call. iOS Safari has no `navigator.vibrate`,
 *   and a buzz on Android Chrome alone would make the same action feel
 *   different by browser.
 * - In a shell built BEFORE `@capacitor/haptics` was added, the JS here ships
 *   with the next web deploy but the native half does not exist until the next
 *   app build. `hasNativePlugin` answers false there, and the call is skipped
 *   rather than thrown into an unhandled rejection.
 *
 * Fire-and-forget by design: nothing the user sees waits on it, and a tap that
 * fails to buzz is not worth reporting.
 */
export function tapSuccess(): void {
  if (!isNative() || hasNativePlugin('Haptics') !== true) return;
  void (async () => {
    try {
      const { Haptics, ImpactStyle } = await import('@capacitor/haptics');
      await Haptics.impact({ style: ImpactStyle.Light });
    } catch {
      /* no buzz; nothing to tell anyone */
    }
  })();
}
