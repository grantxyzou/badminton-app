'use client';

import { useEffect, useMemo, useState } from 'react';
import { useTranslations } from 'next-intl';
import CardHeader from '@/components/primitives/CardHeader';
import ListRow from '@/components/primitives/ListRow';
import ErrorState from '@/components/primitives/ErrorState';
import StateCard, { StateLink, PreviewRow } from '@/components/primitives/StateCard';
import { useOnline } from '@/lib/useOnline';
import { useCatalog } from '@/components/stats/useCatalog';
import { searchCatalog } from '@/lib/gearSearch';
import { MAX_HOLES, MIN_HOLES, grommetHoles } from '@/lib/stringPatterns';
import { isOffered } from '@/lib/catalogOffer';
import type { CatalogItem } from '@/lib/types';

const BASE = process.env.NEXT_PUBLIC_BASE_PATH ?? '';
const MATCHES_SHOWN = 6;

/**
 * Grommet hole counts the club's stringer takes off a frame on the machine
 * (docs/plans/grommet-holes.md, Phase 3). Only rackets no maker page or
 * pattern sheet answers for can be counted — the route refuses the rest — so
 * the search lists only those. A count shows on that racket's page, to this
 * club's members only.
 */
export default function HoleCountsCard() {
  const t = useTranslations('admin.stringing.holes');
  const tRoot = useTranslations('admin.stringing');
  const online = useOnline();
  const rackets = useCatalog('racket');
  const [counts, setCounts] = useState<Record<string, number> | null>(null);
  const [loadError, setLoadError] = useState(false);
  const [attempt, setAttempt] = useState(0);
  const [query, setQuery] = useState('');
  const [picked, setPicked] = useState<CatalogItem | null>(null);
  const [draft, setDraft] = useState('');
  const [busy, setBusy] = useState(false);
  const [saveError, setSaveError] = useState(false);

  useEffect(() => {
    let live = true;
    setLoadError(false);
    fetch(`${BASE}/api/stringing/holes`, { cache: 'no-store' })
      .then((r) => (r.ok ? r.json() : Promise.reject(new Error(String(r.status)))))
      .then((d) => {
        if (!live) return;
        if (!d || typeof d.counts !== 'object' || d.counts === null) throw new Error('unknown');
        setCounts(d.counts);
      })
      .catch(() => { if (live) setLoadError(true); });
    return () => { live = false; };
  }, [attempt]);

  // Countable: offered, and nothing a maker or pattern sheet says already.
  const countable = useMemo(
    () => rackets.items.filter((r) => isOffered(r) && grommetHoles(r) === null),
    [rackets.items],
  );
  const byId = useMemo(() => new Map(rackets.items.map((r) => [r.id, r])), [rackets.items]);
  const matches = useMemo(() => {
    if (!query.trim() || !counts) return [];
    return searchCatalog(countable.filter((r) => counts[r.id] === undefined), query, (r) => `${r.brand} ${r.model}`).slice(0, MATCHES_SHOWN);
  }, [countable, counts, query]);

  async function send(method: 'PUT' | 'DELETE', catalogId: string, holes?: number) {
    if (busy || !online) return;
    setBusy(true);
    setSaveError(false);
    try {
      const res = method === 'PUT'
        ? await fetch(`${BASE}/api/stringing/holes`, {
            method: 'PUT',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({ catalogId, holes }),
          })
        : await fetch(`${BASE}/api/stringing/holes?catalogId=${encodeURIComponent(catalogId)}`, { method: 'DELETE' });
      if (!res.ok) throw new Error(String(res.status));
      setCounts((cur) => {
        const next = { ...(cur ?? {}) };
        if (method === 'PUT' && holes !== undefined) next[catalogId] = holes;
        else delete next[catalogId];
        return next;
      });
      if (method === 'PUT') { setPicked(null); setQuery(''); setDraft(''); }
    } catch {
      setSaveError(true);
    } finally {
      setBusy(false);
    }
  }

  if (loadError || rackets.loadError) {
    return (
      <StateCard
        tone="danger"
        icon="grid_4x4"
        title={t('title')}
        message={<>{t('loadError')} <StateLink onClick={() => setAttempt((n) => n + 1)}>{tRoot('retry')}</StateLink></>}
      >
        <PreviewRow width="48%" />
      </StateCard>
    );
  }

  // The card's shape while either read is in flight: an empty list here would
  // read as "nothing counted yet".
  if (counts === null || !rackets.loaded) {
    return (
      <div className="glass-card p-5 space-y-3" role="status" aria-label={t('title')}>
        {/* No subtitle yet: it counts the countable rackets, and the catalog is still loading. */}
        <CardHeader icon="grid_4x4" title={t('title')} />
        <PreviewRow width="60%" />
        <PreviewRow width="80%" />
      </div>
    );
  }

  const holes = Number(draft);
  const draftValid = /^\d{2,3}$/.test(draft.trim()) && holes >= MIN_HOLES && holes <= MAX_HOLES;
  const counted = Object.entries(counts)
    .map(([id, n]) => ({ id, n, row: byId.get(id) }))
    .sort((a, b) => (a.row ? `${a.row.brand} ${a.row.model}` : a.id).localeCompare(b.row ? `${b.row.brand} ${b.row.model}` : b.id));

  return (
    <div className="glass-card p-5 space-y-3">
      <CardHeader icon="grid_4x4" title={t('title')} subtitle={t('subtitle', { count: countable.length })} />

      {saveError && <ErrorState message={t('saveError')} />}

      {counted.length > 0 && (
        <ul className="flex flex-col gap-2" style={{ listStyle: 'none', margin: 0, padding: 0 }}>
          {counted.map(({ id, n, row }) => (
            <li key={id}>
              <ListRow
                title={<span className="fs-md" style={{ color: 'var(--text-primary)' }}>{row ? `${row.brand} ${row.model}` : id}</span>}
                subtitle={t('holesValue', { count: n })}
                trailing={(
                  <button
                    type="button"
                    className="cc-btn cc-btn-ghost"
                    disabled={busy || !online}
                    onClick={() => void send('DELETE', id)}
                    aria-label={t('removeLabel', { name: row ? row.model : id })}
                  >
                    {t('remove')}
                  </button>
                )}
              />
            </li>
          ))}
        </ul>
      )}

      {picked ? (
        <div className="flex flex-col gap-2">
          <label htmlFor="hole-count" className="section-label-muted">{t('countFor', { name: `${picked.brand} ${picked.model}` })}</label>
          <input
            id="hole-count"
            type="text"
            inputMode="numeric"
            value={draft}
            onChange={(e) => setDraft(e.target.value)}
            placeholder={t('placeholder')}
            maxLength={3}
            style={{ fontFamily: 'var(--font-mono)' }}
          />
          {draft.trim() !== '' && !draftValid && <p className="field-error" role="alert">{t('invalid')}</p>}
          <div style={{ display: 'flex', gap: 'var(--space-3)' }}>
            <button
              type="button"
              className="cc-btn cc-btn-secondary"
              style={{ flex: 1 }}
              disabled={busy || !online || !draftValid}
              onClick={() => void send('PUT', picked.id, holes)}
            >
              {t('save')}
            </button>
            <button type="button" className="cc-btn cc-btn-ghost" onClick={() => { setPicked(null); setDraft(''); }}>
              {t('cancel')}
            </button>
          </div>
        </div>
      ) : (
        <div className="flex flex-col gap-2">
          <label htmlFor="hole-search" className="section-label-muted">{t('find')}</label>
          <input
            id="hole-search"
            type="search"
            value={query}
            onChange={(e) => setQuery(e.target.value)}
            placeholder={t('findPlaceholder')}
          />
          {query.trim() !== '' && matches.length === 0 && (
            <p className="fs-sm" style={{ margin: 0, color: 'var(--text-muted)' }}>{t('noMatch')}</p>
          )}
          {matches.length > 0 && (
            <ul className="flex flex-col gap-2" style={{ listStyle: 'none', margin: 0, padding: 0 }}>
              {matches.map((r) => (
                <li key={r.id}>
                  <ListRow
                    onClick={() => { setPicked(r); setDraft(''); }}
                    title={<span className="fs-md" style={{ color: 'var(--text-primary)' }}>{r.brand} {r.model}</span>}
                    trailing={<span className="material-icons icon-md" aria-hidden="true" style={{ color: 'var(--text-muted)' }}>chevron_right</span>}
                  />
                </li>
              ))}
            </ul>
          )}
        </div>
      )}
    </div>
  );
}
