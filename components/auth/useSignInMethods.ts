'use client';

import { useCallback, useEffect, useState } from 'react';

const BASE = process.env.NEXT_PUBLIC_BASE_PATH ?? '';

export type Provider = 'google' | 'apple';

export interface Methods {
  available: Provider[] | null;
  linked: Provider[] | null;
  hasPassword?: boolean;
  hasPin?: boolean;
  email?: string | null;
  nudge?: boolean;
}

export interface UseSignInMethods {
  /** null = UNKNOWN, not "no methods". Check `loadError` before concluding. */
  methods: Methods | null;
  loadError: boolean;
  reload: () => Promise<void>;
}

/**
 * Read how this member can get back into their account.
 *
 * Lifted out of `SignInMethodsCard` so the Profile row and the sheet it opens
 * read ONE copy of the answer. Two components fetching the same endpoint is
 * two chances to disagree — the row would still say "Google" after you
 * disconnected Google in the sheet, which is the same class of bug the second
 * UnpaidSessionsCard was deleted for.
 *
 * `enabled: false` skips the fetch, for the caller that is being handed a
 * shared instance and must not open a second one.
 *
 * UNKNOWN is preserved deliberately: a failed or throttled probe leaves
 * `methods` null and sets `loadError`, and never resolves to an empty list. A
 * confident "you have no way back in" is the lying-empty-state failure applied
 * to the scariest possible subject.
 */
export function useSignInMethods(enabled = true): UseSignInMethods {
  const [methods, setMethods] = useState<Methods | null>(null);
  const [loadError, setLoadError] = useState(false);

  const reload = useCallback(async () => {
    if (!enabled) return;
    try {
      const res = await fetch(`${BASE}/api/auth/methods`, { cache: 'no-store' });
      if (!res.ok) throw new Error(String(res.status));
      const d = (await res.json()) as Methods;
      if (d.linked === null) throw new Error('unknown');
      setMethods(d);
      setLoadError(false);
    } catch {
      setLoadError(true);
    }
  }, [enabled]);

  useEffect(() => {
    void reload();
  }, [reload]);

  return { methods, loadError, reload };
}

/**
 * The short list shown on the Profile row, so nobody has to open it to see
 * what they have — the same reason Stats & privacy prints "On".
 *
 * Returns undefined while UNKNOWN, which renders no meta at all rather than an
 * empty or guessed one.
 */
export function methodsSummary(
  methods: Methods | null,
  labels: { pin: string; email: string },
): string | undefined {
  if (!methods) return undefined;
  const parts: string[] = [];
  if (methods.hasPin) parts.push(labels.pin);
  if (methods.hasPassword) parts.push(labels.email);
  // Brand names, deliberately not translated.
  for (const p of methods.linked ?? []) parts.push(p === 'google' ? 'Google' : 'Apple');
  return parts.length ? parts.join(' · ') : undefined;
}
