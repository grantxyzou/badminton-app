'use client';
import { useEffect, useMemo, useRef, useState } from 'react';
import { useTranslations } from 'next-intl';
import ErrorState from '@/components/primitives/ErrorState';
import EmptyState from '@/components/primitives/EmptyState';
import ListRow from '@/components/primitives/ListRow';
import BagList from './BagList';
import { BottomSheet, BottomSheetHeader, BottomSheetBody } from '../BottomSheet';
import { useOnline } from '@/lib/useOnline';
import { rackets, activeRacket } from '@/lib/activeRacket';
import type { CatalogItem, PlayerGear } from '@/lib/types';

const BASE = process.env.NEXT_PUBLIC_BASE_PATH ?? '';

interface Props {
  name: string;
  open: boolean;
  onClose: () => void;
  onSaved: () => void;
  /** The player's current racket label ("Brand Model"). Used only to land
   *  the sheet on the right brand tab for context — NOT to pre-select it
   *  (see FIX 2, 2026-08: it's always something already in the bag, and
   *  pre-selecting it made Save a guaranteed 409 duplicate_racket). */
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
  const [gear, setGear] = useState<PlayerGear | null>(null);
  const [brand, setBrand] = useState<string | null>(null);
  const [selectedId, setSelectedId] = useState<string | null>(null);
  const [saving, setSaving] = useState(false);
  const [loaded, setLoaded] = useState(false);
  const [loadError, setLoadError] = useState(false);
  const [saveError, setSaveError] = useState(false);
  // 409s (duplicate/full bag) are a legible refusal, not a crash — kept
  // separate from saveError so the two never get conflated into one generic
  // "something broke" pill.
  const [saveMessage, setSaveMessage] = useState<string | null>(null);
  const [savedLabel, setSavedLabel] = useState<string | null>(null);
  const [query, setQuery] = useState('');
  // Distinct from loadError (the catalog's): a failed gear read must not
  // render as a truthful empty bag. A player with three rackets who hits a
  // flaky fetch must see an error pill, not "you have no rackets."
  const [gearLoadError, setGearLoadError] = useState(false);

  // Monotonic op counter shared by the initial gear GET and all three
  // mutations. Each async call captures the id it was issued at; when it
  // resolves, it only applies its result if no NEWER gear op has since
  // started. Without this, a slow initial GET that's still in flight when
  // the player taps activate/remove can land after the mutation and silently
  // revert the bag to the pre-mutation state — the server stays correct, only
  // the UI lies. (Sibling hazard to the "stale gear response" note in
  // RacketRow.tsx, one level up: same shape, different pair of racers.)
  const gearOpRef = useRef(0);

  useEffect(() => {
    if (!open) return;
    let live = true;
    // Reset transient state each time the sheet opens.
    setSavedLabel(null);
    setSaveError(false);
    setSaveMessage(null);
    setGearLoadError(false);
    setLoaded(false);
    setQuery('');
    fetch(`${BASE}/api/equipment/catalog?category=racket`, { cache: 'no-store' })
      .then((r) => (r.ok ? r.json() : Promise.reject(new Error(String(r.status)))))
      .then((d) => {
        if (!live) return;
        const items = (d.items ?? []) as CatalogItem[];
        setCatalog(items);
        setLoaded(true);
        setLoadError(false);
        // Land on the current racket's brand tab so reopening shows where
        // you stand, without pre-selecting it — currentLabel is always
        // something already in the bag (it's the player's active racket),
        // and Save now POSTs an ADD. Pre-selecting it made the sheet's most
        // obvious action (open, tap Save) a guaranteed 409 duplicate_racket.
        // Only relevant now for browsing context; a genuine re-add of an
        // in-bag racket via manual tap+Save still 409s as it should.
        const current = currentLabel
          ? items.find((c) => `${c.brand} ${c.model}` === currentLabel)
          : undefined;
        setSelectedId(null);
        setBrand(current?.brand ?? items[0]?.brand ?? null);
      })
      .catch(() => { if (live) { setLoadError(true); setLoaded(true); } });
    // Loaded alongside the catalog, independently — but still error-surfaced:
    // the bag not writing anything doesn't mean a load failure gets to render
    // as a truthful "no rackets" (see gearLoadError above).
    const gearOpId = ++gearOpRef.current;
    fetch(`${BASE}/api/equipment/gear?name=${encodeURIComponent(name)}`, { cache: 'no-store' })
      .then((r) => (r.ok ? r.json() : Promise.reject(new Error(String(r.status)))))
      .then((d) => {
        if (!live || gearOpId !== gearOpRef.current) return;
        setGear((d.gear as PlayerGear | null) ?? null);
        setGearLoadError(false);
      })
      .catch(() => { if (live && gearOpId === gearOpRef.current) setGearLoadError(true); });
    return () => { live = false; };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [open, name]);

  // Catalog order is curation order — keep it for both tabs and rows.
  const brands = useMemo(() => {
    const seen: string[] = [];
    for (const c of catalog) if (!seen.includes(c.brand)) seen.push(c.brand);
    return seen;
  }, [catalog]);

  // A query searches the WHOLE catalog and bypasses the brand tabs —
  // filtering within the selected brand would hide matches and read as broken.
  const models = useMemo(() => {
    const q = query.trim().toLowerCase();
    if (!q) return catalog.filter((c) => c.brand === brand);
    return catalog.filter((c) => {
      const series = typeof c.attributes?.series === 'string' ? c.attributes.series : '';
      return `${c.brand} ${c.model} ${series}`.toLowerCase().includes(q);
    });
  }, [catalog, brand, query]);

  const selected = useMemo(
    () => catalog.find((c) => c.id === selectedId) ?? null,
    [catalog, selectedId],
  );

  async function save() {
    if (!selected) return;
    setSaving(true);
    setSaveError(false);
    setSaveMessage(null);
    const opId = ++gearOpRef.current;
    try {
      const label = `${selected.brand} ${selected.model}`;
      const res = await fetch(`${BASE}/api/equipment/gear`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ name, item: { catalogId: selected.id, category: 'racket', label } }),
      });
      if (res.status === 409) {
        const { error } = await res.json();
        // A 409 code the client doesn't recognise must fall through to the
        // generic save error, not assert a specific reason the server never
        // gave (see bag_full / duplicate_racket below).
        if (error === 'bag_full') setSaveMessage(t('bagFull'));
        else if (error === 'duplicate_racket') setSaveMessage(t('bagDuplicate'));
        else setSaveError(true);
        return;
      }
      if (!res.ok) throw new Error(String(res.status));
      const d = await res.json();
      if (opId === gearOpRef.current) setGear((d.gear as PlayerGear | null) ?? null);
      setSavedLabel(label);
      onSaved();
      setTimeout(() => { onClose(); }, 900);
    } catch {
      setSaveError(true);
    } finally {
      setSaving(false);
    }
  }

  // Setting the pointer. Tapping the already-active racket is a no-op in the
  // UI (BagList renders a badge, not a button, for that row) — this guard is
  // defense in depth so the same rule holds even if a caller changes.
  async function activate(itemId: string) {
    if (activeRacket(gear)?.id === itemId) return;
    setSaving(true);
    setSaveError(false);
    setSaveMessage(null);
    const opId = ++gearOpRef.current;
    try {
      const res = await fetch(`${BASE}/api/equipment/gear`, {
        method: 'PATCH',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ name, activeRacketId: itemId }),
      });
      if (!res.ok) throw new Error(String(res.status));
      const d = await res.json();
      if (opId === gearOpRef.current) setGear((d.gear as PlayerGear | null) ?? null);
      onSaved();
    } catch {
      setSaveError(true);
    } finally {
      setSaving(false);
    }
  }

  async function remove(itemId: string) {
    setSaving(true);
    setSaveError(false);
    setSaveMessage(null);
    const opId = ++gearOpRef.current;
    try {
      const res = await fetch(
        `${BASE}/api/equipment/gear?name=${encodeURIComponent(name)}&itemId=${encodeURIComponent(itemId)}`,
        { method: 'DELETE' },
      );
      if (!res.ok) throw new Error(String(res.status));
      const d = await res.json();
      if (opId === gearOpRef.current) setGear((d.gear as PlayerGear | null) ?? null);
      onSaved();
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

            {/* A failed gear read must render as a failure, not a truthful
                "you have no rackets" — a player with three rackets must never
                see an empty bag because a fetch hiccuped. Suppress BagList
                entirely while this is up so the two can't show at once. */}
            {gearLoadError && <ErrorState message={t('recError')} />}
            {!gearLoadError && (
              <BagList
                items={rackets(gear)}
                activeId={activeRacket(gear)?.id}
                onActivate={activate}
                onRemove={remove}
                busy={saving || !online}
              />
            )}

            {catalog.length > 0 && (
              <input
                type="search"
                value={query}
                onChange={(e) => setQuery(e.target.value)}
                placeholder={t('searchPlaceholder')}
                aria-label={t('searchPlaceholder')}
                className="fs-md"
                style={{
                  width: '100%', padding: 'var(--space-3)', borderRadius: 'var(--radius-lg)',
                  background: 'var(--bg-surface)', border: '1px solid var(--border-subtle)',
                  color: 'var(--text-primary)',
                }}
              />
            )}

            {/* Brand tabs. 3 brands today, so a segment control reads whole-
                catalog-at-a-glance; revisit as chips if curation grows past ~4.
                Canonical pattern: wrapper needs `flex`, tabs need flex-1.
                Hidden while a query is active — search bypasses the brand
                filter entirely, so showing tabs that aren't in play reads
                as broken. */}
            {!query.trim() && brands.length > 0 && (
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

            {loaded && !loadError && catalog.length > 0 && models.length === 0 && (
              <EmptyState>{t('searchNoMatches')}</EmptyState>
            )}

            {saveMessage && <ErrorState message={saveMessage} />}
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
