'use client';
import { useEffect, useState } from 'react';
import { useTranslations } from 'next-intl';
import ErrorState from '@/components/primitives/ErrorState';
import { BottomSheet, BottomSheetHeader, BottomSheetBody } from '../BottomSheet';
import type { CatalogItem } from '@/lib/types';

const BASE = process.env.NEXT_PUBLIC_BASE_PATH ?? '';

interface Props {
  name: string;
  open: boolean;
  onClose: () => void;
  onSaved: () => void;
}

/**
 * Slice-0 "What's your racket?" picker. Loads the racket catalog, filters by a
 * free-text query, and PUTs the chosen racket to the player's gear doc. One
 * racket per category (the route replaces, not appends). Low-sensitivity,
 * name-keyed write (see route's TODO).
 */
export default function GearSheet({ name, open, onClose, onSaved }: Props) {
  const t = useTranslations('valueHub');
  const tRecovery = useTranslations('recovery');
  const [catalog, setCatalog] = useState<CatalogItem[]>([]);
  const [query, setQuery] = useState('');
  const [saving, setSaving] = useState(false);
  const [loadError, setLoadError] = useState(false);
  const [saveError, setSaveError] = useState(false);
  const [savedLabel, setSavedLabel] = useState<string | null>(null);

  useEffect(() => {
    if (!open) return;
    let live = true;
    // Reset transient state each time the sheet opens.
    setSavedLabel(null);
    setSaveError(false);
    fetch(`${BASE}/api/equipment/catalog?category=racket`, { cache: 'no-store' })
      .then((r) => (r.ok ? r.json() : Promise.reject(new Error(String(r.status)))))
      .then((d) => { if (live) { setCatalog(d.items ?? []); setLoadError(false); } })
      .catch(() => { if (live) setLoadError(true); });
    return () => { live = false; };
  }, [open]);

  const matches = catalog
    .filter((c) => `${c.brand} ${c.model}`.toLowerCase().includes(query.trim().toLowerCase()))
    .slice(0, 8);

  async function pick(item: CatalogItem) {
    setSaving(true);
    setSaveError(false);
    try {
      const label = `${item.brand} ${item.model}`;
      const res = await fetch(`${BASE}/api/equipment/gear`, {
        method: 'PUT',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ name, item: { catalogId: item.id, category: 'racket', label } }),
      });
      if (!res.ok) throw new Error(String(res.status));
      setSavedLabel(label);
      onSaved();
      setTimeout(() => { onClose(); }, 900);
    } catch {
      setSaveError(true);
    } finally {
      setSaving(false);
    }
  }

  return (
    <BottomSheet open={open} onClose={onClose} ariaLabel={t('racketSheetTitle')} maxHeight="75vh" className="max-w-lg mx-auto">
      <BottomSheetHeader className="flex items-center justify-between p-4">
        <span style={{ fontSize: 'var(--fs-lg)', fontWeight: 600 }}>{t('racketSheetTitle')}</span>
        <button
          type="button"
          onClick={onClose}
          aria-label={tRecovery('close')}
          style={{ background: 'transparent', border: 'none', cursor: 'pointer', minWidth: 44, minHeight: 44, display: 'flex', alignItems: 'center', justifyContent: 'center' }}
        >
          <span className="material-icons" style={{ fontSize: 'var(--fs-stat)' }}>close</span>
        </button>
      </BottomSheetHeader>
      <BottomSheetBody className="p-5 pb-8">
        {savedLabel ? (
          <p style={{ textAlign: 'center', fontSize: 'var(--fs-lg)', color: 'var(--text-primary)' }}>
            {t('gearSaved')} {savedLabel}
          </p>
        ) : (
          <div style={{ display: 'flex', flexDirection: 'column', gap: 12 }}>
            <p style={{ fontSize: 'var(--fs-base)', color: 'var(--text-secondary)', margin: 0 }}>{t('racketSheetHint')}</p>
            <input
              type="text"
              aria-label={t('racketSheetTitle')}
              placeholder="Yonex Astrox…"
              value={query}
              onChange={(e) => setQuery(e.target.value)}
              maxLength={50}
              autoFocus
            />
            {loadError && <ErrorState message={t('recError')} />}
            {saveError && <ErrorState message={t('recError')} />}
            <ul style={{ listStyle: 'none', margin: 0, padding: 0, display: 'flex', flexDirection: 'column', gap: 6 }}>
              {matches.map((c) => (
                <li key={c.id}>
                  <button
                    type="button"
                    disabled={saving}
                    onClick={() => pick(c)}
                    className="cc-btn cc-btn-ghost"
                    style={{ width: '100%', justifyContent: 'flex-start' }}
                  >
                    {c.brand} {c.model}
                  </button>
                </li>
              ))}
            </ul>
          </div>
        )}
      </BottomSheetBody>
    </BottomSheet>
  );
}
