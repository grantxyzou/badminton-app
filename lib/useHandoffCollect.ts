'use client';

import { useCallback, useEffect, useRef, useState } from 'react';
import { claimPendingHandoff, clearHandoff, pendingHandoffId, type ClaimOutcome } from '@/lib/handoffClient';

const BASE = process.env.NEXT_PUBLIC_BASE_PATH ?? '';

/** What the shell's code sheet renders. `null` means no sheet. */
export interface HandoffCodePrompt {
  /** The last code typed did not match. */
  wrong: boolean;
  /** The sign-in is gone (expired, or too many wrong codes). */
  expired: boolean;
  /** The server could not be asked (offline, cold start). */
  retry: boolean;
  /** Too many tries on this sign-in; wait before the next. */
  throttled: boolean;
}

const CLEAR: HandoffCodePrompt = { wrong: false, expired: false, retry: false, throttled: false };

export interface HandoffCollect {
  prompt: HandoffCodePrompt | null;
  submitCode: (code: string) => Promise<void>;
  /** Abandon the sign-in on this device. */
  dismiss: () => void;
}

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
 * TWO ANSWERS NEED THE PERSON (lib/authHandoff.ts, guarantees 3 and 4):
 *   `code_required` — the sign-in finished somewhere that could not report
 *                     back, so the six digits it showed have to be typed. The
 *                     hook exposes a `prompt` for the shell's code sheet.
 *   `needs_name`    — a new Google/Apple identity. The claim has just set the
 *                     pending-signup cookie in THIS jar, so the app reloads
 *                     into its ordinary `?authFlow=name` landing, which both
 *                     shells already handle (invite resume included).
 *
 * EXTRACTED FROM `HomeShell` so the members-only signed-out screen runs the
 * same collection (docs/plans/members-only.md). That screen is exactly where an
 * installed-PWA Google sign-in lands; without this it would never complete,
 * and a second copy of the listener set is how the two would drift.
 */
export function useHandoffCollect(onReady: (name: string) => void): HandoffCollect {
  // The latest callback, without re-subscribing every render. Written in an
  // effect, not during render — the compiler's `refs` rule refuses the latter.
  const onReadyRef = useRef(onReady);
  useEffect(() => {
    onReadyRef.current = onReady;
  });
  const [prompt, setPrompt] = useState<HandoffCodePrompt | null>(null);

  /** Acts on an answer. `submitted` marks one that followed a typed code. */
  const settle = useCallback((out: ClaimOutcome, submitted: boolean) => {
    switch (out.status) {
      case 'ready':
        setPrompt(null);
        onReadyRef.current(out.name);
        return;
      case 'needs_name':
        setPrompt(null);
        // A full reload is the point: the server renders the name step for the cookie it just set.
        window.location.replace(`${BASE}/?authFlow=name`);
        return;
      case 'already_linked':
        setPrompt(null);
        // The shells already explain this landing, in both languages.
        window.location.replace(`${BASE}/?authError=already_linked`);
        return;
      case 'code_required':
        // A background poll must not wipe a "that didn't match" the person is reading.
        setPrompt((p) => (submitted ? { ...CLEAR, wrong: out.wrong } : (p ?? CLEAR)));
        return;
      case 'none':
        setPrompt((p) => (p ? { ...CLEAR, expired: true } : null));
        return;
      case 'rate_limited':
        if (submitted) setPrompt({ ...CLEAR, throttled: true });
        return;
      case 'pending':
        if (submitted) setPrompt({ ...CLEAR, retry: true });
    }
  }, []);

  useEffect(() => {
    if (typeof window === 'undefined') return;
    let cancelled = false;

    const collect = async () => {
      if (cancelled || !pendingHandoffId()) return;
      const out = await claimPendingHandoff();
      if (!cancelled) settle(out, false);
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
  }, [settle]);

  const submitCode = useCallback(
    async (code: string) => {
      settle(await claimPendingHandoff(code), true);
    },
    [settle],
  );

  const dismiss = useCallback(() => {
    clearHandoff();
    setPrompt(null);
  }, []);

  return { prompt, submitCode, dismiss };
}
