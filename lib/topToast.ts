'use client';

import { useCallback, useEffect, useRef, useState } from 'react';
import type { TopToastContent } from '@/components/primitives/TopToast';
import type { StatusTone } from '@/components/primitives/StatusBanner';

/**
 * The app's one top toast, reachable from anywhere in the tree.
 *
 * `<TopToast>` is mounted ONCE, in `HomeShell`, and until now only HomeShell
 * could speak through it (offline, the sign-in notices). A card deep in the
 * admin tree that wants to say "Session created!" had to draw its own banner
 * inside itself — which is how the advance form came to render a `StatusBanner`
 * for a MOMENT (TopToast's own docblock: moments drop in from the top, states
 * stay in their card).
 *
 * This is a WINDOW EVENT, not a store: `showTopToast()` dispatches, and the one
 * `useTopToastBus()` in HomeShell listens and owns the timer. No module-level
 * state (the single-instance registry would want a row for one), nothing to
 * leak between tests, and a toast raised before the shell mounts is simply not
 * heard — the shell always mounts first, since it renders the caller.
 */
export const TOP_TOAST_EVENT = 'bpm:top-toast';

/** A success clears sooner than bad news (same numbers as the auth notices). */
export const TOP_TOAST_SUCCESS_MS = 6000;
export const TOP_TOAST_ALERT_MS = 12000;

export interface TopToastRequest {
  tone: StatusTone;
  /** Material Symbols glyph name. */
  icon: string;
  title: string;
  body?: string;
  /** Defaults by tone: 6 s for success, 12 s otherwise. */
  durationMs?: number;
}

export function showTopToast(req: TopToastRequest): void {
  if (typeof window === 'undefined') return;
  window.dispatchEvent(new CustomEvent<TopToastRequest>(TOP_TOAST_EVENT, { detail: req }));
}

export interface TopToastBus {
  toast: TopToastContent | null;
  dismiss: () => void;
}

/**
 * Listens for `showTopToast()` and holds the current message until its timer
 * runs out or `dismiss` is called. A new message replaces the one showing and
 * restarts the clock (TopToast re-keys its countdown ring by `id`).
 */
export function useTopToastBus(): TopToastBus {
  const [toast, setToast] = useState<TopToastContent | null>(null);
  const seq = useRef(0);

  useEffect(() => {
    const onToast = (e: Event) => {
      const req = (e as CustomEvent<TopToastRequest>).detail;
      if (!req) return;
      seq.current += 1;
      const durationMs = req.durationMs ?? (req.tone === 'success' ? TOP_TOAST_SUCCESS_MS : TOP_TOAST_ALERT_MS);
      setToast({
        id: `toast:${seq.current}`,
        tone: req.tone,
        icon: req.icon,
        title: req.title,
        body: req.body,
        durationMs,
      });
    };
    window.addEventListener(TOP_TOAST_EVENT, onToast);
    return () => window.removeEventListener(TOP_TOAST_EVENT, onToast);
  }, []);

  useEffect(() => {
    if (!toast?.durationMs) return;
    const id = setTimeout(() => setToast((t) => (t?.id === toast.id ? null : t)), toast.durationMs);
    return () => clearTimeout(id);
  }, [toast]);

  const dismiss = useCallback(() => setToast(null), []);
  return { toast, dismiss };
}
