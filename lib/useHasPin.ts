'use client';

import { useEffect, useState } from 'react';

const BASE = process.env.NEXT_PUBLIC_BASE_PATH ?? '';

export interface MemberProbe {
  /** Member exists in the directory (createdAt present in response). */
  exists: boolean;
  /** Member exists AND has a PIN set. */
  hasPin: boolean;
}

/**
 * Debounced probe of /api/members/me?name=X. Drives the HomeTab sign-up
 * form's three modes:
 *   - `null` → unknown / probing / network failed → anon mode (default)
 *   - `{exists: false, hasPin: false}` → no member → anon mode (default)
 *   - `{exists: true, hasPin: true}` → member with PIN → sign-in mode
 *   - `{exists: true, hasPin: false}` → member without PIN → create-account mode
 *
 * Server failures fall through to `null` so the caller's UI is non-blocking
 * — the server-side check on submit is the authoritative gate.
 *
 * Probe is debounced (500ms default). Trimmed names shorter than 2 chars
 * are skipped to keep the rate limiter (10/min on /api/members/me) happy
 * while the user is mid-typing.
 */
export function useMemberProbe(name: string, debounceMs = 500): MemberProbe | null {
  const [probe, setProbe] = useState<MemberProbe | null>(null);

  useEffect(() => {
    const trimmed = name.trim();
    if (trimmed.length < 2) {
      setProbe(null);
      return;
    }
    setProbe(null);
    let cancelled = false;
    const timer = setTimeout(async () => {
      try {
        const res = await fetch(
          `${BASE}/api/members/me?name=${encodeURIComponent(trimmed)}`,
          { cache: 'no-store' },
        );
        if (cancelled) return;
        if (!res.ok) return;
        const data = (await res.json()) as { hasPin?: boolean; createdAt?: string | null };
        if (cancelled) return;
        // createdAt presence is the canonical exists signal — pinHash is
        // stripped from responses, but createdAt comes from the member doc.
        const exists = typeof data.createdAt === 'string';
        setProbe({ exists, hasPin: data.hasPin === true });
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

/**
 * @deprecated Use `useMemberProbe` instead, which also exposes whether
 * the member exists. Kept as a thin shim during the auth-flow refactor.
 */
export function useHasPin(name: string, debounceMs = 500): boolean | null {
  const probe = useMemberProbe(name, debounceMs);
  if (probe === null) return null;
  return probe.hasPin;
}
