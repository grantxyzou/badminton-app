'use client';

import { useCallback, useEffect, useState } from 'react';
import CardSkeleton from '@/components/primitives/CardSkeleton';
import EmptyState from '@/components/primitives/EmptyState';
import StateCard, { StateLink } from '@/components/primitives/StateCard';
import { isRefused } from '@/lib/apiFetch';
import { useOnline } from '@/lib/useOnline';
import { GROUP_NAME_MAX, GROUP_NAME_MIN } from '@/lib/groupRoutes';

const BASE = process.env.NEXT_PUBLIC_BASE_PATH ?? '';

/** The card's height while it loads: measured at 430px (2026-10-22) in the loaded state — two lines of copy, the name, the Rename button (136px). */
export const CLUB_NAME_EDITOR_HEIGHT = 136;

/**
 * The club's own name — `Group.name`, the CLUB's and never the product's
 * (`lib/brand.ts`). It is what members see at the top of Home once groups are
 * on, on an invite, and in a receipt's `{club}` memo.
 *
 * Exists because renaming the product must never silently rename the club:
 * when the app became "BPM" (2026-10-22) group #1 kept its record, and this is
 * how Grant set it to "BPM Core" rather than a hand edit in the portal.
 *
 * English only, like every admin screen (CLAUDE.md, Q10).
 */
export default function ClubNameEditor() {
  const online = useOnline();
  const [name, setName] = useState<string | null>(null);
  const [loading, setLoading] = useState(true);
  const [editing, setEditing] = useState(false);
  const [draft, setDraft] = useState('');
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState('');
  /* 'failed' and 'refused' are not "no name": a blank form over a dead fetch
     would let Save overwrite the real name. */
  const [loadState, setLoadState] = useState<'ok' | 'failed' | 'refused'>('ok');

  const load = useCallback(async () => {
    setLoading(true);
    try {
      const res = await fetch(`${BASE}/api/admin/settings`, { cache: 'no-store' });
      if (isRefused(res)) { setLoadState('refused'); return; }
      if (!res.ok) { setLoadState('failed'); return; }
      const data = (await res.json()) as { groupName?: unknown };
      setName(typeof data.groupName === 'string' ? data.groupName : null);
      setLoadState('ok');
    } catch {
      setLoadState('failed');
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => { void load(); }, [load]);

  async function save() {
    const next = draft.trim();
    if (next.length < GROUP_NAME_MIN || next.length > GROUP_NAME_MAX) {
      setError(`Use ${GROUP_NAME_MIN}–${GROUP_NAME_MAX} characters.`);
      return;
    }
    setSaving(true);
    setError('');
    try {
      const res = await fetch(`${BASE}/api/admin/settings`, {
        method: 'PATCH',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ groupName: next }),
      });
      if (!res.ok) {
        const data = (await res.json().catch(() => ({}))) as { error?: string };
        setError(data.error === 'no_group'
          ? 'This club has no settings record yet, so the name can’t be saved.'
          : 'Couldn’t save the name. Try again.');
        return;
      }
      setName(next);
      setEditing(false);
    } catch {
      setError('Couldn’t save the name. Try again.');
    } finally {
      setSaving(false);
    }
  }

  if (loading) return <CardSkeleton height={CLUB_NAME_EDITOR_HEIGHT} />;

  if (loadState === 'failed') {
    return (
      <StateCard
        tone="danger"
        icon="groups"
        title="Club name"
        subtitle="What members see at the top of Home."
        message={<>Couldn&apos;t load the club name. <StateLink onClick={() => void load()}>Try again</StateLink></>}
      >
        <span className="state-line" style={{ width: '50%', height: 'var(--space-6)' }} />
      </StateCard>
    );
  }

  return (
    <section className="glass-card p-4 space-y-3 motion-fade" aria-label="Club name">
      <p className="fs-sm" style={{ margin: 0, color: 'var(--text-muted)' }}>
        What members see at the top of Home, on an invite, and in the memo of a receipt. The app itself keeps its own name.
      </p>

      {loadState === 'refused' && (
        <EmptyState
          action={
            <button type="button" className="cc-btn cc-btn-ghost" onClick={() => void load()}>
              Try again
            </button>
          }
        >
          Sign in as an admin to see the club name.
        </EmptyState>
      )}

      {loadState === 'ok' && !editing && (
        <>
          {name ? (
            <p className="fs-md" style={{ margin: 0 }}>{name}</p>
          ) : (
            <p className="fs-md text-gray-400" style={{ margin: 0 }}>
              This club has no settings record yet, so it has no name to show.
            </p>
          )}
          {name && (
            <button
              type="button"
              onClick={() => { setDraft(name); setError(''); setEditing(true); }}
              className="cc-btn cc-btn-secondary self-start"
              disabled={!online}
            >
              Rename
            </button>
          )}
        </>
      )}

      {loadState === 'ok' && editing && (
        <div className="space-y-3">
          <label className="block">
            <span className="section-label-muted">Name</span>
            <input
              type="text"
              value={draft}
              onChange={(e) => setDraft(e.target.value)}
              maxLength={GROUP_NAME_MAX}
              autoFocus
              className="w-full fs-md rounded-lg p-2"
              style={{ background: 'rgba(var(--glass-tint), 0.04)', border: '1px solid rgba(var(--glass-tint), 0.12)' }}
            />
          </label>

          {error && <p className="field-error" role="alert">{error}</p>}

          <div className="flex flex-wrap gap-2 justify-end">
            <button
              type="button"
              onClick={() => { setEditing(false); setError(''); }}
              className="cc-btn cc-btn-ghost"
              disabled={saving}
            >
              Cancel
            </button>
            <button
              type="button"
              onClick={() => void save()}
              disabled={saving || !online}
              className="cc-btn cc-btn-primary"
            >
              {saving ? 'Saving…' : 'Save'}
            </button>
          </div>
        </div>
      )}
    </section>
  );
}
