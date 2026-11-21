'use client';

import { useEffect, useState } from 'react';

/**
 * The PIN field's countdown (docs/plans/sign-in-redesign.md, step 2). After
 * too many wrong PINs the server answers `pin_paused` with the seconds left,
 * for every name alike (`lib/pinPaused.ts`); the field is disabled and says
 * "Let's pause a moment — try again in 3:42" until it runs out. Apple, Google and
 * the email code stay on the screen meanwhile.
 */
export function usePinPause() {
  const [until, setUntil] = useState<number | null>(null);
  const [now, setNow] = useState(() => Date.now());

  useEffect(() => {
    if (until === null) return;
    const tick = () => {
      const t = Date.now();
      setNow(t);
      if (t >= until) setUntil(null);
    };
    tick();
    const timer = window.setInterval(tick, 1000);
    return () => window.clearInterval(timer);
  }, [until]);

  const secondsLeft = until === null ? 0 : Math.max(0, Math.ceil((until - now) / 1000));
  return {
    paused: secondsLeft > 0,
    secondsLeft,
    /** "3:42" */
    label: formatPause(secondsLeft),
    pauseFor(seconds: number) {
      const t = Date.now();
      setNow(t);
      setUntil(t + Math.max(1, seconds) * 1000);
    },
  };
}

/** `m:ss` — "3:42", "58:07". */
export function formatPause(seconds: number): string {
  const s = Math.max(0, Math.ceil(seconds));
  return `${Math.floor(s / 60)}:${String(s % 60).padStart(2, '0')}`;
}

/** The seconds a `pin_paused` answer carries, else null (any other 429 is a
 *  plain rate limit). Reads a clone, so the caller can still read the body. */
export async function pinPausedSeconds(res: Response): Promise<number | null> {
  if (res.status !== 429) return null;
  // A bare stand-in for a Response (some tests) has no clone; a 429 is never
  // read again by the callers, so reading it directly is safe there.
  const src = typeof res.clone === 'function' ? res.clone() : res;
  const body = (await src.json().catch(() => null)) as { error?: unknown; retryAfter?: unknown } | null;
  if (body?.error !== 'pin_paused' || typeof body.retryAfter !== 'number' || body.retryAfter <= 0) return null;
  return body.retryAfter;
}
