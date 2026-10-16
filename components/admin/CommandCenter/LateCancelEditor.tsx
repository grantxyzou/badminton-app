'use client';

import { useCallback, useEffect, useRef, useState } from 'react';
import CardSkeleton from '@/components/primitives/CardSkeleton';
import Collapse from '@/components/primitives/Collapse';
import EmptyState from '@/components/primitives/EmptyState';
import StateCard, { StateLink } from '@/components/primitives/StateCard';
import Switch from '@/components/primitives/Switch';
import { isRefused } from '@/lib/apiFetch';
import { useOnline } from '@/lib/useOnline';

const BASE = process.env.NEXT_PUBLIC_BASE_PATH ?? '';

/** The windows offered. The server accepts any whole hour 1–168; these are the sensible ones. */
export const LATE_CANCEL_PRESETS = [12, 24, 48, 72] as const;
const DEFAULT_HOURS = 48;

/** The card's height while it loads: measured at 430px (2026-10-16) in the OFF state, the
 *  default (124px). On, it is 164px: the window choice opens through Collapse after load. */
export const LATE_CANCEL_EDITOR_HEIGHT = 124;

/**
 * The club's late-cancellation window (docs/plans/late-cancel-fee.md).
 *
 * Off by default. On, a player cancelling their own spot inside the window is
 * told a fee may apply and has to confirm, and the cancel is tagged "Late" in
 * Payments. Nothing is charged: the admin decides, by hand.
 *
 * English only, like every admin screen (CLAUDE.md, Q10). Saves on each change
 * — there is one value — and rolls back to the server's answer on a refusal.
 */
export default function LateCancelEditor() {
  const online = useOnline();
  const [hours, setHours] = useState<number | null>(null); // null = off
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState('');
  /* 'failed' and 'refused' are not "off": rendering the switch off a dead
     fetch would let the next tap overwrite a window the club has set. */
  const [loadState, setLoadState] = useState<'ok' | 'failed' | 'refused'>('ok');
  // Switching off and back on restores the window that was set, not the default.
  const lastHours = useRef<number>(DEFAULT_HOURS);

  const load = useCallback(async () => {
    setLoading(true);
    try {
      const res = await fetch(`${BASE}/api/admin/settings`, { cache: 'no-store' });
      if (isRefused(res)) { setLoadState('refused'); return; }
      if (!res.ok) { setLoadState('failed'); return; }
      const data = (await res.json()) as { lateCancelHours?: unknown };
      const h = typeof data.lateCancelHours === 'number' ? data.lateCancelHours : null;
      if (h !== null) lastHours.current = h;
      setHours(h);
      setLoadState('ok');
    } catch {
      setLoadState('failed');
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => { void load(); }, [load]);

  async function persist(next: number | null) {
    setSaving(true);
    setError('');
    try {
      const res = await fetch(`${BASE}/api/admin/settings`, {
        method: 'PATCH',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ lateCancelHours: next }),
      });
      if (!res.ok) {
        const data = (await res.json().catch(() => ({}))) as { error?: string };
        setError(data.error === 'no_group'
          ? 'This club has no settings record yet, so the window can’t be saved.'
          : 'Couldn’t save the window. Try again.');
        await load();
        return;
      }
      if (next !== null) lastHours.current = next;
      setHours(next);
    } catch {
      setError('Couldn’t save the window. Try again.');
      await load();
    } finally {
      setSaving(false);
    }
  }

  if (loading) return <CardSkeleton height={LATE_CANCEL_EDITOR_HEIGHT} />;

  if (loadState === 'failed') {
    return (
      <StateCard
        tone="danger"
        icon="schedule"
        title="Late cancellations"
        subtitle="Warn players who cancel close to the session."
        message={
          <>
            Couldn&apos;t load the setting. <StateLink onClick={() => void load()}>Try again</StateLink>
          </>
        }
      >
        <span className="state-line" style={{ width: '60%', height: 'var(--space-6)' }} />
      </StateCard>
    );
  }

  const on = hours !== null;
  const busy = saving || !online;

  return (
    <section className="glass-card p-4 space-y-3 motion-fade" aria-label="Late cancellations">
      <p className="fs-sm" style={{ margin: 0, color: 'var(--text-muted)' }}>
        Players who cancel their own spot inside this window are told a fee may apply, and must confirm.
        Late cancels are tagged in Payments. No fee is charged automatically.
      </p>

      {loadState === 'refused' && (
        <EmptyState
          action={
            <button type="button" className="cc-btn cc-btn-ghost" onClick={() => void load()}>
              Try again
            </button>
          }
        >
          Sign in as an admin to see this setting.
        </EmptyState>
      )}

      {loadState === 'ok' && (
        <>
          <div className="flex items-center justify-between gap-4">
            <div>
              <p className="fs-md" style={{ margin: 0, color: 'var(--text-primary)', fontWeight: 600 }}>
                Warn about late cancels
              </p>
              <p id="late-cancel-state" className="fs-sm" style={{ margin: 0, color: 'var(--text-muted)' }}>
                {on ? `On · ${hours} hours before the session` : 'Off'}
              </p>
            </div>
            <Switch
              checked={on}
              onChange={(next) => void persist(next ? lastHours.current : null)}
              ariaLabel="Warn about late cancellations"
              ariaDescribedBy="late-cancel-state"
              disabled={busy}
            />
          </div>

          <Collapse open={on} spaceAbove="var(--space-3)">
            <div className="segment-control flex" role="radiogroup" aria-label="Late-cancellation window">
              {LATE_CANCEL_PRESETS.map((h) => (
                <button
                  key={h}
                  type="button"
                  role="radio"
                  aria-checked={hours === h}
                  onClick={() => { if (hours !== h) void persist(h); }}
                  disabled={busy}
                  className={`flex-1 flex items-center justify-center fs-sm rounded-full ${hours === h ? 'segment-tab-active' : 'segment-tab-inactive'}`}
                >
                  {h} hours
                </button>
              ))}
            </div>
            {on && !(LATE_CANCEL_PRESETS as readonly number[]).includes(hours) && (
              <p className="fs-sm" style={{ margin: 'var(--space-2) 0 0', color: 'var(--text-muted)' }}>
                Currently {hours} hours.
              </p>
            )}
          </Collapse>

          {error && <p className="field-error" role="alert">{error}</p>}
        </>
      )}
    </section>
  );
}
