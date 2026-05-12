'use client';

import { useEffect, useState } from 'react';

const BASE = process.env.NEXT_PUBLIC_BASE_PATH ?? '';

/**
 * Debounced probe of /api/members/me?name=X to learn whether `name` is a
 * PIN-protected member. Used by the sign-up form to nudge PIN'd friends
 * toward the sign-in form before they submit and bounce off a 401.
 *
 * Returns:
 *   - `true`  → name is a member AND has a PIN set
 *   - `false` → name is unknown or has no PIN
 *   - `null`  → probing in flight, or input too short, or network failed
 *
 * Network/server failures fall through to `null` so the caller's UI is
 * non-blocking — the server-side 401 check on submit is the authoritative
 * gate. This is purely a UX hint.
 *
 * Probe is debounced (500ms default). Trimmed names shorter than 2 chars
 * are skipped to keep the rate limiter (10/min on /api/members/me) happy
 * while the user is mid-typing.
 */
export function useHasPin(name: string, debounceMs = 500): boolean | null {
  const [hasPin, setHasPin] = useState<boolean | null>(null);

  useEffect(() => {
    const trimmed = name.trim();
    if (trimmed.length < 2) {
      setHasPin(null);
      return;
    }
    setHasPin(null);
    let cancelled = false;
    const timer = setTimeout(async () => {
      try {
        const res = await fetch(
          `${BASE}/api/members/me?name=${encodeURIComponent(trimmed)}`,
          { cache: 'no-store' },
        );
        if (cancelled) return;
        if (!res.ok) return; // 5xx / 429 → leave null
        const data = (await res.json()) as { hasPin?: boolean };
        if (cancelled) return;
        setHasPin(data.hasPin === true);
      } catch {
        // Network failure → leave null. Server-side check on submit is
        // the authoritative gate.
      }
    }, debounceMs);
    return () => {
      cancelled = true;
      clearTimeout(timer);
    };
  }, [name, debounceMs]);

  return hasPin;
}
