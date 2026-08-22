'use client';
import { useEffect, useMemo, useState } from 'react';
import { useTranslations } from 'next-intl';
import ErrorState from '@/components/primitives/ErrorState';
import EmptyState from '@/components/primitives/EmptyState';
import ListRow from '@/components/primitives/ListRow';
import { BottomSheet, BottomSheetHeader, BottomSheetBody } from '../BottomSheet';
import BagList from './BagList';
import type { GearResult } from './useGear';
import type { CatalogItem, EquipmentCategory, GearItem } from '@/lib/types';
import { recommendTension, MIN_LB, MAX_LB, type PlayFormat } from '@/lib/tension';
import { searchCatalog } from '@/lib/gearSearch';

const BASE = process.env.NEXT_PUBLIC_BASE_PATH ?? '';

interface Props {
  open: boolean;
  onClose: () => void;
  /** Catalog ids already in the player's bag. Those rows are omitted from the
   *  catalog list below — repeating an owned row there would make it
   *  ambiguous which one is "the" entry for that catalog id, and it takes
   *  `duplicate_racket` off the happy path entirely. */
  ownedCatalogIds: string[];
  /** The player's own gear items in THIS category, active one included.
   *  Rendered via `BagList` above the catalog. Defaults to `[]` so every
   *  pre-Task-6 call site keeps compiling. */
  ownedItems?: GearItem[];
  /** Id of the active racket, for `BagList`'s badge. Only meaningful for the
   *  racket category — `BagList` itself gates the activate affordance on
   *  `item.category === 'racket'`, so passing this for other categories is
   *  harmless. */
  activeItemId?: string;
  /** Wired straight through to `BagList`. No-ops if `ownedItems` is empty. */
  onActivate?: (id: string) => void;
  onRemove?: (id: string) => void;
  /** Adds the racket and makes it active, then the sheet closes. Owned by
   *  useGear one level up; this sheet holds no gear state. The second
   *  argument is the string-tension capture (see the tension field below) —
   *  present only when the member actually entered a value, never a silent
   *  echo of the prefilled advice. */
  onPick: (item: CatalogItem, tensionLbs?: number) => Promise<GearResult>;
  busy: boolean;
  online: boolean;
  /**
   * Which catalog category to pick from. Defaults to 'racket' so every
   * existing call site is unchanged.
   *
   * Parameterised rather than forked: this sheet handles every category's
   * owned-items-plus-catalog job identically. A StringSheet would have been a
   * copy of 200 lines whose only difference was a query string, and the two
   * would have drifted.
   */
  category?: EquipmentCategory;
  /** Sheet heading. Defaults to the racket copy. */
  title?: string;
  /** One-line hint under the heading. Defaults to the racket copy. */
  hint?: string;
  /** Member name, used only to look up their level for the string-tension
   *  prefill. Omit and the tension field still works — it just opens empty
   *  instead of pre-filled. */
  activeName?: string | null;
  /** `PlayerGear.playFormat`, for the same tension prefill. Defaults to
   *  'doubles', matching `StringTensionCard`'s fallback. */
  format?: PlayFormat;
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

/** Parses and clamps a raw tension input to `[MIN_LB, MAX_LB]`, rounded to a
 *  whole pound (matching `recommendTension`'s own output). Returns
 *  `undefined` for anything that isn't a real number the member typed —
 *  including an empty string, which `Number('')` reads as `0` (finite!) and
 *  would otherwise silently clamp up to `MIN_LB`. A member who clears the
 *  field is saying "nothing", not "20". */
function clampTension(raw: string): number | undefined {
  if (raw.trim() === '') return undefined;
  const n = Number(raw);
  if (!Number.isFinite(n)) return undefined;
  return Math.min(MAX_LB, Math.max(MIN_LB, Math.round(n)));
}

/**
 * "Add a racket" — the one place a category's items live: what you already
 * own, and the catalog to add or change it.
 *
 * This sheet used to be a catalog picker and nothing else, deliberately split
 * from bag management (activate, remove), because doing both on top of a
 * 50-row catalog made it read as an action sheet: two unrelated jobs fighting
 * over 75vh. That reasoning held while the bag lived on the Equipment tab,
 * one level up from this sheet. It no longer does — the tab's bag list moved
 * back in here (see `BagList`'s docstring) — so the split it was guarding
 * against doesn't exist any more: there is one job, "manage this category,"
 * and owned items plus the catalog to add more of them are both part of it.
 *
 * Lookup, not browse, for the catalog half. The player already knows which
 * racket they own — the task is finding it among 50, so search leads and
 * brand is the only filter. Spec filters would be answering a question nobody
 * asked here (you don't know your own racket's balance; that's what the hero
 * card tells you afterwards).
 */
export default function GearSheet({
  open,
  onClose,
  ownedCatalogIds,
  ownedItems = [],
  activeItemId,
  onActivate,
  onRemove,
  onPick,
  busy,
  online,
  category = 'racket',
  title,
  hint,
  activeName,
  format,
}: Props) {
  const t = useTranslations('valueHub');
  const tGear = useTranslations('stats.gear');
  const tRecovery = useTranslations('recovery');
  const tStats = useTranslations('stats');
  const [catalog, setCatalog] = useState<CatalogItem[]>([]);
  const [brand, setBrand] = useState<string | null>(null);
  const [loaded, setLoaded] = useState(false);
  const [loadError, setLoadError] = useState(false);
  const [pickError, setPickError] = useState<string | null>(null);
  const [query, setQuery] = useState('');
  const [level, setLevel] = useState<number | null>(null);
  const [tensionInput, setTensionInput] = useState('');
  const [tensionTouched, setTensionTouched] = useState(false);
  const heading = title ?? t('racketSheetTitle');

  useEffect(() => {
    if (!open) return;
    let live = true;
    setLoaded(false);
    setQuery('');
    setPickError(null);
    setBrand(null); // brands differ per category — don't carry one across
    setTensionInput('');
    setTensionTouched(false);
    setLevel(null); // stale-level guard: see the level-fetch effect below
    fetch(`${BASE}/api/equipment/catalog?category=${category}`, { cache: 'no-store' })
      .then((r) => (r.ok ? r.json() : Promise.reject(new Error(String(r.status)))))
      .then((d) => {
        if (!live) return;
        const items = (d.items ?? []) as CatalogItem[];
        setCatalog(items);
        setLoaded(true);
        setLoadError(false);
        // Deliberately NOT defaulting to the first brand. It made the picker
        // open on Yonex showing 25 of the 71 rackets, with the other 46 behind
        // a tab the member had no reason to think was hiding anything — half
        // of "the database isn't showing some rackets". `null` is the All tab.
      })
      .catch(() => { if (live) { setLoadError(true); setLoaded(true); } });
    return () => { live = false; };
    // `category` belongs here: without it, opening the sheet for strings after
    // opening it for rackets would show the racket list.
  }, [open, category]);

  // Level lookup for the tension prefill. Independent of the gear-document
  // read above (a different endpoint, the same one StringTensionCard already
  // calls) and gated on category so rackets never pay for it. The reset for
  // the "not applicable" case lives in the on-open effect above, not here —
  // this effect only ever sets state from a response, never synchronously in
  // its own body.
  useEffect(() => {
    if (!open || category !== 'string' || !activeName) return;
    let live = true;
    fetch(`${BASE}/api/stats/level?name=${encodeURIComponent(activeName)}`, { cache: 'no-store' })
      .then((r) => (r.ok ? r.json() : Promise.reject(new Error(String(r.status)))))
      .then((d) => {
        if (!live) return;
        const raw = d?.level?.level;
        setLevel(typeof raw === 'number' ? raw : null);
      })
      .catch(() => { if (live) setLevel(null); });
    return () => { live = false; };
  }, [open, category, activeName]);

  const tensionAdvice = useMemo(
    () => (category === 'string' ? recommendTension(level, format ?? 'doubles') : null),
    [category, level, format],
  );
  // Shown value tracks the live advice UNTIL the member edits it — no effect
  // syncing an initial value into state, which would race the level fetch
  // resolving after mount. Once touched it freezes on whatever they typed;
  // see `pick()` for why an untouched value is never sent.
  const tensionDisplay = tensionTouched ? tensionInput : (tensionAdvice ? String(tensionAdvice.lb) : '');

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
  //
  // `searchCatalog` rather than a substring test: the substring test could not
  // find the Halbertec 5000 for a member who typed "helbatec", and an empty
  // list is indistinguishable from a row that isn't in the catalog. See
  // lib/gearSearch.ts.
  const models = useMemo(() => {
    if (!query.trim()) return brand === null ? addable : addable.filter((c) => c.brand === brand);
    return searchCatalog(addable, query, (c) => {
      const series = typeof c.attributes?.series === 'string' ? c.attributes.series : '';
      return `${c.brand} ${c.model} ${series}`;
    });
  }, [addable, brand, query]);

  // The brand tab can still go stale one way: removing the last addable racket
  // of a brand empties the tab you're standing on. Falling back to All rather
  // than to another brand — All is a superset, so it can never be empty while
  // anything is addable, and it is the state the sheet opens in anyway.
  //
  // `brand === null` is NOT stale any more; it is the All tab.
  useEffect(() => {
    if (brand !== null && !brands.includes(brand)) setBrand(null);
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
    // Only an EDITED tension value is sent. `tensionDisplay` mirrors the
    // advice until the member touches the field, and sending it unconditionally
    // would silently persist a recommendation as if it were the fact the
    // member reported — the exact thing this field exists to keep apart.
    const tensionLbs = category === 'string' && tensionTouched
      ? clampTension(tensionInput)
      : undefined;
    const res = await onPick(item, tensionLbs);
    if (res.ok) { onClose(); return; }
    if (res.reason === 'bag_full') setPickError(t('bagFull'));
    else if (res.reason === 'duplicate_racket') setPickError(t('bagDuplicate'));
    else setPickError(t('recError'));
  }

  return (
    <BottomSheet open={open} onClose={onClose} ariaLabel={heading} maxHeight="92dvh">
      <BottomSheetHeader>
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
      <BottomSheetBody>
        <div style={{ display: 'flex', flexDirection: 'column', gap: 12 }}>
          <p style={{ fontSize: 'var(--fs-base)', color: 'var(--text-secondary)', margin: 0 }}>{hint ?? t('racketSheetHint')}</p>

          {ownedItems.length > 0 && (
            <BagList
              items={ownedItems}
              activeId={activeItemId}
              onActivate={(id) => onActivate?.(id)}
              onRemove={(id) => onRemove?.(id)}
              busy={busy}
            />
          )}

          {category === 'string' && (
            <div style={{ display: 'flex', flexDirection: 'column', gap: 'var(--space-2)' }}>
              <label htmlFor="gear-sheet-tension" className="fs-xs" style={{ color: 'var(--text-muted)' }}>
                {tGear('tensionCaptureLabel')}
              </label>
              <div style={{ display: 'flex', alignItems: 'center', gap: 'var(--space-2)' }}>
                <input
                  id="gear-sheet-tension"
                  type="number"
                  inputMode="numeric"
                  min={MIN_LB}
                  max={MAX_LB}
                  value={tensionDisplay}
                  onChange={(e) => { setTensionTouched(true); setTensionInput(e.target.value); }}
                  aria-label={tGear('tensionCaptureLabel')}
                  className="fs-md"
                  style={{
                    width: 88, minHeight: 44, padding: 'var(--space-3)', borderRadius: 'var(--radius-lg)',
                    background: 'var(--bg-surface)', border: '1px solid var(--border-subtle)',
                    color: 'var(--text-primary)', fontFamily: 'var(--font-mono)',
                  }}
                />
                <span className="fs-sm" style={{ color: 'var(--text-secondary)' }}>{tGear('lb')}</span>
              </div>
            </div>
          )}

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

          {/* Brand tabs: All plus 3 brands today, so a segment control still
              catalog-at-a-glance; revisit as chips if curation grows past ~4.
              Canonical pattern: wrapper needs `flex`, tabs need flex-1.
              Hidden while a query is active — search bypasses the brand filter
              entirely, so showing tabs that aren't in play reads as broken. */}
          {!query.trim() && brands.length > 0 && (
            <div className="segment-control flex" role="tablist" aria-label={heading}>
              {[null, ...brands].map((b) => (
                <button
                  key={b ?? 'all'}
                  type="button"
                  role="tab"
                  aria-selected={brand === b}
                  className={`flex-1 flex items-center justify-center fs-sm ${brand === b ? 'segment-tab-active' : 'segment-tab-inactive'}`}
                  onClick={() => setBrand(b)}
                >
                  {b ?? tGear('brandAll')}
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
