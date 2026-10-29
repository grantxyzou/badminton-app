'use client';

import { useCallback, useEffect, useState } from 'react';
import CardSkeleton from '@/components/primitives/CardSkeleton';
import EmptyState from '@/components/primitives/EmptyState';
import StateCard, { StateLink } from '@/components/primitives/StateCard';
import Switch from '@/components/primitives/Switch';
import { isRefused } from '@/lib/apiFetch';
import { useOnline } from '@/lib/useOnline';

const BASE = process.env.NEXT_PUBLIC_BASE_PATH ?? '';

/** The card's height while it loads: the same layout as `LateCancelEditor` off (124px at 430px). */
export const GUESTS_EDITOR_HEIGHT = 124;

/**
 * Plus-ones (docs/plans/plus-one.md): whether members may bring one guest a
 * session. Off by default. On, a member who is signed up sees "Bring a guest"
 * on Home; the guest takes a spot or waits, and their share goes on the
 * member's balance.
 *
 * English only, like every admin screen (CLAUDE.md, Q10). The same load, save
 * and roll-back shape as `LateCancelEditor`.
 */
export default function GuestsEditor() {
  const online = useOnline();
  const [on, setOn] = useState(false);
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState('');
  /* 'failed' and 'refused' are not "off": a switch drawn off a dead fetch
     would let the next tap turn guests off for a club that has them on. */
  const [loadState, setLoadState] = useState<'ok' | 'failed' | 'refused'>('ok');

  const load = useCallback(async () => {
    setLoading(true);
    try {
      const res = await fetch(`${BASE}/api/admin/settings`, { cache: 'no-store' });
      if (isRefused(res)) { setLoadState('refused'); return; }
      if (!res.ok) { setLoadState('failed'); return; }
      const data = (await res.json()) as { guestsAllowed?: unknown };
      setOn(data.guestsAllowed === true);
      setLoadState('ok');
    } catch {
      setLoadState('failed');
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => { void load(); }, [load]);

  async function persist(next: boolean) {
    setSaving(true);
    setError('');
    try {
      const res = await fetch(`${BASE}/api/admin/settings`, {
        method: 'PATCH',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ guestsAllowed: next }),
      });
      if (!res.ok) {
        const data = (await res.json().catch(() => ({}))) as { error?: string };
        setError(data.error === 'no_group'
          ? 'This club has no settings record yet, so this can’t be saved.'
          : 'Couldn’t save. Try again.');
        await load();
        return;
      }
      setOn(next);
    } catch {
      setError('Couldn’t save. Try again.');
      await load();
    } finally {
      setSaving(false);
    }
  }

  if (loading) return <CardSkeleton height={GUESTS_EDITOR_HEIGHT} />;

  if (loadState === 'failed') {
    return (
      <StateCard
        tone="danger"
        icon="person_add"
        title="Guests"
        subtitle="Let members bring a plus-one."
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

  return (
    <section className="glass-card p-4 space-y-3 motion-fade" aria-label="Guests">
      <p className="fs-sm" style={{ margin: 0, color: 'var(--text-muted)' }}>
        A member who is signed up can bring one guest. The guest takes a spot, or waits when the session
        is full, and their share goes on the member&apos;s balance.
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
                Members can bring a guest
              </p>
              <p id="guests-state" className="fs-sm" style={{ margin: 0, color: 'var(--text-muted)' }}>
                {on ? 'On · one guest per member' : 'Off'}
              </p>
            </div>
            <Switch
              checked={on}
              onChange={(next) => void persist(next)}
              ariaLabel="Members can bring a guest"
              ariaDescribedBy="guests-state"
              disabled={saving || !online}
            />
          </div>
          {error && <p className="field-error" role="alert">{error}</p>}
        </>
      )}
    </section>
  );
}
