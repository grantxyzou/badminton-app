'use client';

import { useEffect, useRef } from 'react';
import { claimPendingHandoff, pendingHandoffId } from '@/lib/handoffClient';

/**
 * Collect a sign-in that finished in ANOTHER cookie jar.
 *
 * An installed iOS PWA (and the native shell) runs Google/Apple sign-in in the
 * system browser, which has its own cookies. The callback parks the result
 * server-side against a secret this device staged before leaving; claiming it
 * mints the `member_session` in OUR jar. See `lib/authHandoff.ts`.
 *
 * Runs on mount and on every return to the foreground, because the person
 * comes back by switching apps — there is no navigation to hang this on, and
 * iOS may have evicted the webview entirely while Safari was in front. The
 * native shell's browser sheet is a modal INSIDE the app, so closing it fires
 * neither `visibilitychange` nor `focus`; `NativeBridge` dispatches
 * `bpm:resume` instead (a no-op on the web).
 *
 * `pending` is the normal in-flight answer and is left alone to retry.
 *
 * EXTRACTED FROM `HomeShell` so the members-only signed-out screen runs the
 * same collection (docs/plans/members-only.md). That screen is exactly where an
 * installed-PWA Google sign-in lands; without this it would never complete,
 * and a second copy of the listener set is how the two would drift.
 */
export function useHandoffCollect(onReady: (name: string) => void): void {
  // The latest callback, without re-subscribing every render. Written in an
  // effect, not during render — the compiler's `refs` rule refuses the latter.
  const onReadyRef = useRef(onReady);
  useEffect(() => {
    onReadyRef.current = onReady;
  });

  useEffect(() => {
    if (typeof window === 'undefined') return;
    let cancelled = false;

    const collect = async () => {
      if (cancelled || !pendingHandoffId()) return;
      const out = await claimPendingHandoff();
      if (cancelled || out.status !== 'ready') return;
      onReadyRef.current(out.name);
    };

    void collect();
    const onVisible = () => {
      if (document.visibilityState === 'visible') void collect();
    };
    const onResume = () => void collect();
    document.addEventListener('visibilitychange', onVisible);
    window.addEventListener('focus', onVisible);
    window.addEventListener('bpm:resume', onResume);
    return () => {
      cancelled = true;
      document.removeEventListener('visibilitychange', onVisible);
      window.removeEventListener('focus', onVisible);
      window.removeEventListener('bpm:resume', onResume);
    };
  }, []);
}
