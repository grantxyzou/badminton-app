'use client';

import { useEffect, useState, useCallback, useRef } from 'react';

const BASE = process.env.NEXT_PUBLIC_BASE_PATH ?? '';

/** How long a dismissable notice stays on screen before it hides itself. */
const AUTO_HIDE_MS = 6000;

interface Anomaly {
  code: string;
  severity: 'info' | 'warning' | 'blocking';
  message: string;
  dismissable: boolean;
}

interface AnomalyFeedProps {
  /** Bumped by parent when something happens that should refetch (e.g. session edit). */
  refreshKey?: number;
}

/**
 * Admin notices, as toasts.
 *
 * These used to be a "Heads up" glass-card sitting in the page. They are now
 * pills floating over it, because a notice is not content — it is something
 * that happened, and a permanent card for it made the admin screen look like
 * it always had a problem.
 *
 * AUTO-HIDE IS NOT ACKNOWLEDGEMENT, and that distinction is the whole design.
 * The timer removes a toast from the SCREEN. It deliberately does NOT call
 * `POST /api/session/dismiss-anomaly`, because that flag means "an admin saw
 * this and accepted it" and six seconds of being rendered cannot claim that —
 * the phone may have been in a pocket. So an un-actioned notice comes back the
 * next time the admin screen loads, and only the × retires it for good.
 *
 * TWO THINGS STOP THE TIMER SWALLOWING A REAL WARNING:
 *   - A NON-DISMISSABLE anomaly never auto-hides. `skip_date` is
 *     `dismissable: false` in the data model precisely because it exists to
 *     stop you advancing onto a date you said to skip; there is nothing to
 *     dismiss, so there is nothing for a timer to do.
 *   - Hovering or focusing PAUSES the countdown, so a toast cannot vanish
 *     mid-sentence while it is being read.
 */
export default function AnomalyFeed({ refreshKey = 0 }: AnomalyFeedProps) {
  const [items, setItems] = useState<Anomaly[]>([]);
  const [loading, setLoading] = useState(true);
  const [loadError, setLoadError] = useState(false);
  const [dismissing, setDismissing] = useState<Set<string>>(new Set());
  const [dismissError, setDismissError] = useState<string | null>(null);
  /** Hidden by the timer but still live on the server — see the docblock. */
  const [hidden, setHidden] = useState<Set<string>>(new Set());
  const [paused, setPaused] = useState(false);

  const load = useCallback(async () => {
    setLoading(true);
    setLoadError(false);
    try {
      const res = await fetch(`${BASE}/api/admin/anomalies`, { cache: 'no-store' });
      if (!res.ok) {
        // 401 = not admin; render nothing (load failure is silent for the
        // signed-out path). For 5xx surface as load error.
        if (res.status >= 500) setLoadError(true);
        setItems([]);
        return;
      }
      const data = (await res.json()) as Anomaly[];
      setItems(Array.isArray(data) ? data : []);
      setHidden(new Set());
    } catch {
      setLoadError(true);
      setItems([]);
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => { void load(); }, [load, refreshKey]);

  /* One timer per visible dismissable toast. Reset whenever the visible set
     changes or the pointer leaves, which is what makes hover actually pause
     rather than merely delay. */
  const itemsRef = useRef(items);
  itemsRef.current = items;
  useEffect(() => {
    if (paused) return;
    const pending = items.filter((a) => a.dismissable && !hidden.has(a.code));
    if (pending.length === 0) return;
    const timer = setTimeout(() => {
      setHidden((prev) => {
        const next = new Set(prev);
        for (const a of itemsRef.current) if (a.dismissable) next.add(a.code);
        return next;
      });
    }, AUTO_HIDE_MS);
    return () => clearTimeout(timer);
  }, [items, hidden, paused]);

  async function dismiss(code: string) {
    if (dismissing.has(code)) return;
    setDismissing((prev) => new Set(prev).add(code));
    setDismissError(null);

    try {
      const res = await fetch(`${BASE}/api/session/dismiss-anomaly`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ code }),
      });
      if (!res.ok) {
        setDismissError(code);
        return;
      }
      setItems((prev) => prev.filter((a) => a.code !== code));
    } catch {
      setDismissError(code);
    } finally {
      setDismissing((prev) => {
        const copy = new Set(prev);
        copy.delete(code);
        return copy;
      });
    }
  }

  if (loading) return null;

  const visible = items.filter((a) => !hidden.has(a.code));
  if (visible.length === 0 && !loadError) return null;

  return (
    <section
      className="toast-stack"
      aria-label="Notices"
      /* Announced but not focus-stealing: an admin mid-task should not be
         yanked to a warning about last week's settings. */
      aria-live="polite"
      onMouseEnter={() => setPaused(true)}
      onMouseLeave={() => setPaused(false)}
      onFocusCapture={() => setPaused(true)}
      onBlurCapture={() => setPaused(false)}
    >
      {loadError && visible.length === 0 && (
        <div className="toast toast-blocking" role="alert">
          <span className="material-icons fs-lg" aria-hidden="true" style={{ color: 'var(--color-red)' }}>
            error
          </span>
          <p className="flex-1 fs-md m-0">Couldn&apos;t load notices — try refreshing.</p>
        </div>
      )}

      {visible.map((anomaly) => (
        <div
          key={anomaly.code}
          className={`toast ${anomaly.severity === 'blocking' ? 'toast-blocking' : 'toast-warning'}`}
          role={anomaly.severity === 'blocking' ? 'alert' : 'status'}
        >
          <span
            className="material-icons fs-lg"
            aria-hidden="true"
            style={{
              color: anomaly.severity === 'blocking' ? 'var(--color-red)' : 'var(--sev-warn)',
            }}
          >
            {anomaly.severity === 'blocking' ? 'error' : 'warning'}
          </span>
          <p className="flex-1 fs-md m-0" style={{ lineHeight: 'var(--lh-snug)' }}>
            {anomaly.message}
            {dismissError === anomaly.code && (
              <span className="field-error" style={{ display: 'block', marginTop: 'var(--space-05)' }}>
                Couldn&apos;t dismiss — try again.
              </span>
            )}
          </p>
          {anomaly.dismissable && (
            <button
              type="button"
              onClick={() => dismiss(anomaly.code)}
              disabled={dismissing.has(anomaly.code)}
              className="toast-dismiss"
              aria-label={`Dismiss ${anomaly.code}`}
            >
              <span className="material-icons icon-sm" aria-hidden="true">close</span>
            </button>
          )}
        </div>
      ))}
    </section>
  );
}
