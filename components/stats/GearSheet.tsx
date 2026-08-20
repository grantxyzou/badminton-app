'use client';
import { useEffect, useMemo, useState } from 'react';
import { useTranslations } from 'next-intl';
import ErrorState from '@/components/primitives/ErrorState';
import EmptyState from '@/components/primitives/EmptyState';
import ListRow from '@/components/primitives/ListRow';
import { BottomSheet, BottomSheetHeader, BottomSheetBody } from '../BottomSheet';
import type { GearResult } from './useGear';
import type { CatalogItem, EquipmentCategory } from '@/lib/types';

const BASE = process.env.NEXT_PUBLIC_BASE_PATH ?? '';

interface Props {
  open: boolean;
  onClose: () => void;
  /** Catalog ids already in the player's bag. Those rows are omitted — the
   *  Equipment tab lists them one level up, so repeating them here would drag
   *  bag semantics back into the surface that exists only to add. It also
   *  takes `duplicate_racket` off the happy path entirely. */
  ownedCatalogIds: string[];
  /** Adds the racket and makes it active, then the sheet closes. Owned by
   *  useGear one level up; this sheet holds no gear state. */
  onPick: (item: CatalogItem) => Promise<GearResult>;
  busy: boolean;
  online: boolean;
  /**
   * Which catalog category to pick from. Defaults to 'racket' so every
   * existing call site is unchanged.
   *
   * Parameterised rather than forked: this sheet is "a catalog picker and
   * nothing else" (components/stats/CLAUDE.md), and that description is
   * category-agnostic. A StringSheet would have been a copy of 200 lines whose
   * only difference was a query string, and the two would have drifted.
   */
  category?: EquipmentCategory;
  /** Sheet heading. Defaults to the racket copy. */
  title?: string;
  /** One-line hint under the heading. Defaults to the racket copy. */
  hint?: string;
}

/** "4U · head-heavy · stiff" — the spec line that makes a model recognisable
 *  to someone who knows their racket by feel, not by name. playStyle is left
 *  out (too wordy for a one-line subtitle). */
function specLine(item: CatalogItem): string {
  const a = item.attributes ?? {};
  // Strings carry none of weight/balance/flex, so the racket spec line renders
  // empty for them and every row looks identical. Gauge is the one objective
  // cross-brand spec (see scripts/import-string-db.mjs), so it leads.
  if (item.category === 'string') {
    const gauge = typeof a.gaugeMm === 'number' ? `${a.gaugeMm}mm` : undefined;
    return [gauge, a.stringType, a.feel].filter(Boolean).join(' · ');
  }
  return [a.weight, a.balance, a.flex].filter(Boolean).join(' · ');
}

/**
 * "Add a racket" — a catalog picker and nothing else.
 *
 * This sheet used to also manage the bag (activate, remove) on top of the
 * 50-row catalog, which is what made it read as an action sheet: two unrelated
 * jobs fighting over 75vh. The bag moved to the Equipment tab; what's left is
 * one job, so the sheet can take the full height and commit on a single tap.
 *
 * Lookup, not browse. The player already knows which racket they own — the
 * task is finding it among 50, so search leads and brand is the only filter.
 * Spec filters would be answering a question nobody asked here (you don't know
 * your own racket's balance; that's what the hero card tells you afterwards).
 */
export default function GearSheet({
  open,
  onClose,
  ownedCatalogIds,
  onPick,
  busy,
  online,
  category = 'racket',
  title,
  hint,
}: Props) {
  const t = useTranslations('valueHub');
  const tRecovery = useTranslations('recovery');
  const tStats = useTranslations('stats');
  const [catalog, setCatalog] = useState<CatalogItem[]>([]);
  const [brand, setBrand] = useState<string | null>(null);
  const [loaded, setLoaded] = useState(false);
  const [loadError, setLoadError] = useState(false);
  const [pickError, setPickError] = useState<string | null>(null);
  const [query, setQuery] = useState('');
  const heading = title ?? t('racketSheetTitle');

  useEffect(() => {
    if (!open) return;
    let live = true;
    setLoaded(false);
    setQuery('');
    setPickError(null);
    setBrand(null); // brands differ per category — don't carry one across
    fetch(`${BASE}/api/equipment/catalog?category=${category}`, { cache: 'no-store' })
      .then((r) => (r.ok ? r.json() : Promise.reject(new Error(String(r.status)))))
      .then((d) => {
        if (!live) return;
        const items = (d.items ?? []) as CatalogItem[];
        setCatalog(items);
        setLoaded(true);
        setLoadError(false);
        setBrand((b) => b ?? items[0]?.brand ?? null);
      })
      .catch(() => { if (live) { setLoadError(true); setLoaded(true); } });
    return () => { live = false; };
    // `category` belongs here: without it, opening the sheet for strings after
    // opening it for rackets would show the racket list.
  }, [open, category]);

  // Rackets already in the bag never appear. Done before brand/query so the
  // tab counts and the "no matches" state both describe what's really here.
  const addable = useMemo(
    () => catalog.filter((c) => !ownedCatalogIds.includes(c.id)),
    [catalog, ownedCatalogIds],
  );

  // Catalog order is curation order — keep it for both tabs and rows.
  const brands = useMemo(() => {
    const seen: string[] = [];
    for (const c of addable) if (!seen.includes(c.brand)) seen.push(c.brand);
    return seen;
  }, [addable]);

  // A query searches the WHOLE catalog and bypasses the brand tabs —
  // filtering within the selected brand would hide matches and read as broken.
  const models = useMemo(() => {
    const q = query.trim().toLowerCase();
    if (!q) return addable.filter((c) => c.brand === brand);
    return addable.filter((c) => {
      const series = typeof c.attributes?.series === 'string' ? c.attributes.series : '';
      return `${c.brand} ${c.model} ${series}`.toLowerCase().includes(q);
    });
  }, [addable, brand, query]);

  // The brand tab can go stale two ways: the catalog's first brand may not be
  // in `brands` once owned rows are filtered out, and removing the last
  // addable racket of a brand empties the tab you're standing on.
  useEffect(() => {
    if (brands.length > 0 && (brand === null || !brands.includes(brand))) setBrand(brands[0]);
  }, [brands, brand]);

  // Both 409 reasons are unreachable by design — owned rackets are filtered
  // out of the list, and the tab disables its Add button at MAX_RACKETS. They
  // are still mapped rather than flattened into the generic error, so a bag
  // that fills up some other way says so instead of reading as a crash. An
  // unrecognised reason falls through to the generic message; it never asserts
  // a cause the server didn't give.
  async function pick(item: CatalogItem) {
    if (busy) return;
    setPickError(null);
    const res = await onPick(item);
    if (res.ok) { onClose(); return; }
    if (res.reason === 'bag_full') setPickError(t('bagFull'));
    else if (res.reason === 'duplicate_racket') setPickError(t('bagDuplicate'));
    else setPickError(t('recError'));
  }

  return (
    <BottomSheet open={open} onClose={onClose} ariaLabel={heading} maxHeight="92dvh" className="max-w-lg mx-auto">
      <BottomSheetHeader className="flex items-center justify-between p-4">
        <span style={{ fontSize: 'var(--fs-lg)', fontWeight: 600 }}>{heading}</span>
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
        <div style={{ display: 'flex', flexDirection: 'column', gap: 12 }}>
          <p style={{ fontSize: 'var(--fs-base)', color: 'var(--text-secondary)', margin: 0 }}>{hint ?? t('racketSheetHint')}</p>

          {loadError && <ErrorState message={t('recError')} />}

          {/* Loaded-but-empty must not look like a working screen with nothing
              on it. (Not hypothetical: the production container held zero
              rackets from day one — see lib/catalogSeed.ts.) */}
          {loaded && !loadError && catalog.length === 0 && (
            <EmptyState>{t('racketCatalogEmpty')}</EmptyState>
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
              Hidden while a query is active — search bypasses the brand filter
              entirely, so showing tabs that aren't in play reads as broken. */}
          {!query.trim() && brands.length > 0 && (
            <div className="segment-control flex" role="tablist" aria-label={heading}>
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

          {/* Disabled while a write is in flight or offline. Styled rather
              than un-wired: dropping ListRow's onClick would swap the row from
              a <button> to a <div>, losing the semantics with no visual cue
              that anything changed. Same principle as .cc-btn:disabled — see
              CLAUDE.md's design-system-first rule. */}
          <ul
            style={{
              listStyle: 'none', margin: 0, padding: 0, display: 'flex', flexDirection: 'column', gap: 6,
              ...(busy ? { opacity: 0.5, pointerEvents: 'none' as const } : null),
            }}
            aria-busy={busy || undefined}
          >
            {models.map((c) => (
              <li key={c.id}>
                <ListRow
                  onClick={() => pick(c)}
                  ariaLabel={`${c.brand} ${c.model}`}
                  // Brand rides above the model rather than only in the aria
                  // label: a query searches all three brands at once, and the
                  // moment results are cross-brand the brand is the thing you
                  // are actually matching on. Model alone left them ambiguous.
                  title={(
                    <span style={{ display: 'flex', flexDirection: 'column', gap: 1 }}>
                      <span style={{ fontSize: 'var(--fs-2xs)', color: 'var(--text-muted)', textTransform: 'uppercase', letterSpacing: '0.04em' }}>
                        {c.brand}
                      </span>
                      <span style={{ fontSize: 'var(--fs-md)', fontWeight: 600 }}>{c.model}</span>
                    </span>
                  )}
                  subtitle={specLine(c) || undefined}
                />
              </li>
            ))}
          </ul>

          {loaded && !loadError && catalog.length > 0 && models.length === 0 && (
            <EmptyState>{t('searchNoMatches')}</EmptyState>
          )}

          {pickError && <ErrorState message={pickError} />}
          {!online && (
            <p style={{ fontSize: 'var(--fs-sm)', color: 'var(--text-muted)', margin: 0 }}>{tStats('offline')}</p>
          )}
        </div>
      </BottomSheetBody>
    </BottomSheet>
  );
}
