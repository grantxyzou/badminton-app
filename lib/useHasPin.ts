'use client';

import { useEffect, useState } from 'react';

const BASE = process.env.NEXT_PUBLIC_BASE_PATH ?? '';

export interface MemberProbe {
  /** Member exists in the directory (createdAt present in response). */
  exists: boolean;
  /** Member exists AND has a PIN set. */
  hasPin: boolean;
  /** This device holds a valid member_session cookie for this name. */
  authed: boolean;
}

/**
 * Debounced probe of /api/members/me?name=X. `SignInForm` reads it to tell a
 * member who never set a PIN so, instead of reporting a wrong one.
 *   - `null` → unknown / probing / network failed
 *   - `{exists: false}` → no such member
 *   - `{exists: true, hasPin}` → a member, with or without a PIN
 *
 * Server failures fall through to `null` so the caller's UI is non-blocking
 * — the server-side check on submit is the authoritative gate.
 *
 * Probe is debounced (500ms default). Trimmed names shorter than 2 chars
 * are skipped to keep the rate limiter (10/min on /api/members/me) happy
 * while the user is mid-typing; an empty name probes nothing.
 */
export function useMemberProbe(name: string, debounceMs = 500): MemberProbe | null {
  const [probe, setProbe] = useState<MemberProbe | null>(null);

  /* Clearing the previous answer is a conclusion about the NAME, not a result
     of the probe, so it is adjusted during render. It also used to be written
     twice — once per branch, with identical arguments — which is how the same
     line came to be reported by `react-hooks/set-state-in-effect` at two
     different places in one effect. */
  const [prevInputs, setPrevInputs] = useState({ name, debounceMs });
  if (prevInputs.name !== name || prevInputs.debounceMs !== debounceMs) {
    setPrevInputs({ name, debounceMs });
    setProbe(null);
  }

  useEffect(() => {
    const trimmed = name.trim();
    if (trimmed.length < 2) return;
    let cancelled = false;
    const timer = setTimeout(async () => {
      try {
        const res = await fetch(
          `${BASE}/api/members/me?name=${encodeURIComponent(trimmed)}`,
          { cache: 'no-store' },
        );
        if (cancelled) return;
        if (!res.ok) return;
        const data = (await res.json()) as { hasPin?: boolean; createdAt?: string | null; authed?: boolean };
        if (cancelled) return;
        // createdAt presence is the canonical exists signal — pinHash is
        // stripped from responses, but createdAt comes from the member doc.
        const exists = typeof data.createdAt === 'string';
        setProbe({ exists, hasPin: data.hasPin === true, authed: data.authed === true });
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

  return probe;
}

