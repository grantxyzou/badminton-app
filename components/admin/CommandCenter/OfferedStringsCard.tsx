'use client';

import { useEffect, useState } from 'react';
import { useTranslations } from 'next-intl';
import CardHeader from '@/components/primitives/CardHeader';
import ErrorState from '@/components/primitives/ErrorState';
import EmptyState from '@/components/primitives/EmptyState';
import { useOnline } from '@/lib/useOnline';
import { MAX_OFFERED } from '@/lib/stringingStrings';

const BASE = process.env.NEXT_PUBLIC_BASE_PATH ?? '';

/**
 * What the club stocks — the list behind the request form's dropdown.
 *
 * This exists so the PLAYER side can be a dropdown. A free-text string field
 * on a request produces "bg80", "BG-80", "Bg 80 white" and "yonex 80" for one
 * spool, and the person who has to reconcile that is the stringer. Typing the
 * list once here is the cheaper end of that trade.
 *
 * Saves on every change rather than behind a Save button. The list is a set of
 * short labels with no interdependence — there is no half-finished state worth
 * protecting, and a Save button on a bench screen is one more thing to forget
 * before walking away from the phone.
 */
export default function OfferedStringsCard() {
  const t = useTranslations('admin.stringing');
  const online = useOnline();
  // null = unknown (never loaded, or the read failed). Distinct from [], which
  // means "nothing stocked" — the request form treats them differently too.
  const [strings, setStrings] = useState<string[] | null>(null);
  const [loadError, setLoadError] = useState(false);
  const [draft, setDraft] = useState('');
  const [busy, setBusy] = useState(false);
  const [saveError, setSaveError] = useState(false);

  useEffect(() => {
    let cancelled = false;
    fetch(`${BASE}/api/stringing/strings`, { cache: 'no-store' })
      .then((r) => (r.ok ? r.json() : Promise.reject(new Error(String(r.status)))))
      .then((d) => {
        if (cancelled) return;
        if (Array.isArray(d.strings)) setStrings(d.strings);
        else setLoadError(true);
      })
      .catch(() => {
        if (!cancelled) setLoadError(true);
      });
    return () => {
      cancelled = true;
    };
  }, []);

  async function save(next: string[]) {
    if (busy || !online) return;
    // Optimistic, with a rollback: the previous list is captured before the
    // write so a failure restores exactly what was on screen rather than
    // leaving a chip that was never actually saved.
    const previous = strings;
    setStrings(next);
    setBusy(true);
    setSaveError(false);
    try {
      const res = await fetch(`${BASE}/api/stringing/strings`, {
        method: 'PATCH',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ strings: next }),
      });
      if (!res.ok) throw new Error(String(res.status));
      const d = await res.json();
      if (Array.isArray(d.strings)) setStrings(d.strings);
    } catch {
      setStrings(previous);
      setSaveError(true);
    } finally {
      setBusy(false);
    }
  }

  function add() {
    const label = draft.trim();
    if (!label || !strings) return;
    if (strings.some((s) => s.toLowerCase() === label.toLowerCase())) {
      setDraft('');
      return;
    }
    if (strings.length >= MAX_OFFERED) return;
    setDraft('');
    void save([...strings, label]);
  }

  return (
    <div className="glass-card p-5 space-y-3">
      <CardHeader icon="format_list_bulleted" title={t('strings.title')} subtitle={t('strings.hint')} />

      {loadError && <ErrorState message={t('strings.loadError')} />}
      {saveError && <ErrorState message={t('strings.saveError')} />}

      {strings !== null && strings.length === 0 && !loadError && (
        <EmptyState>{t('strings.empty')}</EmptyState>
      )}

      {strings !== null && strings.length > 0 && (
        <div style={{ display: 'flex', flexWrap: 'wrap', gap: 'var(--space-2)' }}>
          {strings.map((s) => (
            <button
              key={s}
              type="button"
              disabled={busy || !online}
              onClick={() => void save(strings.filter((x) => x !== s))}
              aria-label={t('strings.remove', { name: s })}
              // `.bpm-chip` in globals.css — a value someone added and can take
              // away. Not one of the `.pill-*` classes: those are read-only
              // status badges with a fixed semantic colour, and wearing one
              // here would say "waitlisted" about a spool of string.
              className="bpm-chip"
            >
              <span className="fs-sm">{s}</span>
              <span className="material-icons icon-xs" style={{ color: 'var(--text-muted)' }}>
                close
              </span>
            </button>
          ))}
        </div>
      )}

      <div style={{ display: 'flex', gap: 'var(--space-3)' }}>
        <input
          type="text"
          value={draft}
          onChange={(e) => setDraft(e.target.value)}
          onKeyDown={(e) => {
            if (e.key === 'Enter') {
              e.preventDefault();
              add();
            }
          }}
          placeholder={t('strings.placeholder')}
          aria-label={t('strings.placeholder')}
          maxLength={60}
          style={{ flex: 1 }}
          disabled={strings === null}
        />
        <button
          type="button"
          onClick={add}
          disabled={busy || !online || !draft.trim() || strings === null}
          className="cc-btn cc-btn-secondary"
        >
          {t('strings.add')}
        </button>
      </div>
    </div>
  );
}
