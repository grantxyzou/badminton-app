'use client';
import { useEffect, useMemo, useState } from 'react';
import { useTranslations } from 'next-intl';
import ErrorState from '@/components/primitives/ErrorState';
import EmptyState from '@/components/primitives/EmptyState';
import ListRow from '@/components/primitives/ListRow';
import { BottomSheet, BottomSheetHeader, BottomSheetBody } from '../BottomSheet';
import { useOnline } from '@/lib/useOnline';
import type { CatalogItem } from '@/lib/types';

const BASE = process.env.NEXT_PUBLIC_BASE_PATH ?? '';

interface Props {
  name: string;
  open: boolean;
  onClose: () => void;
  onSaved: () => void;
  /** The player's current racket label ("Brand Model"), to pre-select it. */
  currentLabel?: string | null;
}

/** "4U · head-heavy · stiff" — the spec line that makes a model recognisable
 *  to someone who knows their racket by feel, not by name. playStyle is left
 *  out (too wordy for a one-line subtitle). */
function specLine(item: CatalogItem): string {
  const a = item.attributes ?? {};
  return [a.weight, a.balance, a.flex].filter(Boolean).join(' · ');
}

/**
 * Slice-0 "What's your racket?" picker — recognition over recall.
 *
 * v1 was a recall UI: an autofocused search box (you had to *remember* your
 * model name to find it), and tapping a match saved instantly with no chance
 * to reconsider. At 15 catalog items across 3 brands, search was solving a
 * problem this catalog doesn't have. Now: brand tabs → tappable model rows
 * (with the spec line as the recognition cue) → tap to select → explicit Save.
 * Selection never writes; only Save does.
 */
export default function GearSheet({ name, open, onClose, onSaved, currentLabel }: Props) {
  const t = useTranslations('valueHub');
  const tRecovery = useTranslations('recovery');
  const tStats = useTranslations('stats');
  const online = useOnline();
  const [catalog, setCatalog] = useState<CatalogItem[]>([]);
  const [brand, setBrand] = useState<string | null>(null);
  const [selectedId, setSelectedId] = useState<string | null>(null);
  const [saving, setSaving] = useState(false);
  const [loaded, setLoaded] = useState(false);
  const [loadError, setLoadError] = useState(false);
  const [saveError, setSaveError] = useState(false);
  const [savedLabel, setSavedLabel] = useState<string | null>(null);

  useEffect(() => {
    if (!open) return;
    let live = true;
    // Reset transient state each time the sheet opens.
    setSavedLabel(null);
    setSaveError(false);
    setLoaded(false);
    fetch(`${BASE}/api/equipment/catalog?category=racket`, { cache: 'no-store' })
      .then((r) => (r.ok ? r.json() : Promise.reject(new Error(String(r.status)))))
      .then((d) => {
        if (!live) return;
        const items = (d.items ?? []) as CatalogItem[];
        setCatalog(items);
        setLoaded(true);
        setLoadError(false);
        // Pre-select the current racket so reopening shows where you stand,
        // and land on its brand tab. Otherwise start on the first brand.
        const current = currentLabel
          ? items.find((c) => `${c.brand} ${c.model}` === currentLabel)
          : undefined;
        setSelectedId(current?.id ?? null);
        setBrand(current?.brand ?? items[0]?.brand ?? null);
      })
      .catch(() => { if (live) { setLoadError(true); setLoaded(true); } });
    return () => { live = false; };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [open]);

  // Catalog order is curation order — keep it for both tabs and rows.
  const brands = useMemo(() => {
    const seen: string[] = [];
    for (const c of catalog) if (!seen.includes(c.brand)) seen.push(c.brand);
    return seen;
  }, [catalog]);

  const models = useMemo(
    () => catalog.filter((c) => c.brand === brand),
    [catalog, brand],
  );

  const selected = useMemo(
    () => catalog.find((c) => c.id === selectedId) ?? null,
    [catalog, selectedId],
  );

  async function save() {
    if (!selected) return;
    setSaving(true);
    setSaveError(false);
    try {
      const label = `${selected.brand} ${selected.model}`;
      const res = await fetch(`${BASE}/api/equipment/gear`, {
        method: 'PUT',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ name, item: { catalogId: selected.id, category: 'racket', label } }),
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

            {loadError && <ErrorState message={t('recError')} />}

            {/* Loaded-but-empty must not look like a working screen with
                nothing on it. Before this, an empty catalog rendered a title,
                a hint and a dead Save button — indistinguishable from broken,
                which is exactly the lying-empty-state the repo forbids. (It
                was not hypothetical: the production container held zero
                rackets, see lib/catalogSeed.ts.) */}
            {loaded && !loadError && catalog.length === 0 && (
              <EmptyState>{t('racketCatalogEmpty')}</EmptyState>
            )}

            {/* Brand tabs. 3 brands today, so a segment control reads whole-
                catalog-at-a-glance; revisit as chips if curation grows past ~4.
                Canonical pattern: wrapper needs `flex`, tabs need flex-1. */}
            {brands.length > 0 && (
              <div className="segment-control flex" role="tablist" aria-label={t('racketSheetTitle')}>
                {brands.map((b) => (
                  <button
                    key={b}
                    type="button"
                    role="tab"
                    aria-selected={brand === b}
                    className={`flex-1 flex items-center justify-center fs-sm ${brand === b ? 'segment-tab-active' : 'segment-tab-inactive'}`}
                    onClick={() => setBrand(b)}
                  >
                    {b}
                  </button>
                ))}
              </div>
            )}

            <ul style={{ listStyle: 'none', margin: 0, padding: 0, display: 'flex', flexDirection: 'column', gap: 6 }}>
              {models.map((c) => {
                const isSelected = c.id === selectedId;
                return (
                  <li key={c.id}>
                    <ListRow
                      onClick={() => setSelectedId(isSelected ? null : c.id)}
                      ariaLabel={`${c.brand} ${c.model}${isSelected ? ` — ${t('racketSelected')}` : ''}`}
                      title={<span style={{ fontSize: 'var(--fs-md)', fontWeight: 600 }}>{c.model}</span>}
                      subtitle={specLine(c) || undefined}
                      trailing={isSelected ? (
                        <span className="material-icons" style={{ fontSize: 'var(--icon-md)', color: 'var(--accent)' }} aria-hidden="true">
                          check_circle
                        </span>
                      ) : undefined}
                    />
                  </li>
                );
              })}
            </ul>

            {saveError && <ErrorState message={t('recError')} />}
            {!online && (
              <p style={{ fontSize: 'var(--fs-sm)', color: 'var(--text-muted)', margin: 0 }}>{tStats('offline')}</p>
            )}

            {/* Selection is a decision, saving is a commitment — the tap never
                writes (v1 saved on tap, which made browsing feel dangerous). */}
            <button
              type="button"
              className="cc-btn cc-btn-primary"
              disabled={!selected || !online || saving}
              onClick={save}
              style={{ width: '100%', justifyContent: 'center' }}
            >
              {saving ? '…' : selected ? `${t('save')} — ${selected.model}` : t('save')}
            </button>
          </div>
        )}
      </BottomSheetBody>
    </BottomSheet>
  );
}
