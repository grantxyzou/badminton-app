'use client';
import { useEffect, useMemo, useState } from 'react';
import { useTranslations } from 'next-intl';
import ErrorState from '@/components/primitives/ErrorState';
import EmptyState from '@/components/primitives/EmptyState';
import { BottomSheet, BottomSheetHeader, BottomSheetBody } from '../BottomSheet';
import type { GearResult } from './useGear';
import type { CatalogItem, EquipmentCategory, GearItem } from '@/lib/types';
import { searchCatalog } from '@/lib/gearSearch';

const BASE = process.env.NEXT_PUBLIC_BASE_PATH ?? '';

interface Props {
  open: boolean;
  onClose: () => void;
  /** Catalog ids already in the player's bag. These rows are NO LONGER hidden:
   *  they render in place, in their brand group, with a check and a line
   *  saying what the member already knows about them. Hiding them meant the
   *  one question a browse list is asked — "do I already have this?" — could
   *  only be answered by a separate section pinned above the list. */
  ownedCatalogIds: string[];
  /** The player's own gear items in THIS category. Read ONLY to caption the
   *  owned rows above (tension for a string, nothing for a racket). Managing
   *  them — remove, use-this-one, set tension — is `YourKitCard`'s job now;
   *  see this file's docstring. */
  ownedItems?: GearItem[];
  /** Id of the active racket, so its row can say "using today" rather than a
   *  bare "in your kit". Meaningless for other categories, harmless to pass. */
  activeItemId?: string;
  /** Adds the item and makes it active, then the sheet closes. Owned by
   *  `useGear` one level up; this sheet holds no gear state. */
  onPick: (item: CatalogItem) => Promise<GearResult>;
  busy: boolean;
  online: boolean;
  /**
   * Which catalog category to pick from. Defaults to 'racket' so every
   * existing call site is unchanged.
   *
   * Parameterised rather than forked: this sheet handles every category's
   * browse job identically. A StringSheet would have been a copy of 200 lines
   * whose only difference was a query string, and the two would have drifted.
   */
  category?: EquipmentCategory;
  /** Sheet heading. Defaults to the racket copy. */
  title?: string;
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
 * "Add a racket" — the catalog for one category, search first.
 *
 * Three things this sheet deliberately does NOT do any more, all for the same
 * reason: it had grown a second job on top of the one it is opened for.
 *
 *  - It does not carry an "Already in your kit" section. That section was
 *    remove + mark-today's-racket + set-tension — bag MANAGEMENT — sitting
 *    above the catalog somebody opened in order to ADD something. Owned rows
 *    now appear in place, in their brand group, checked and captioned, so the
 *    same fact is learned without a separate surface; managing them moved to
 *    `YourKitCard`, which is where the kit lives.
 *  - It does not carry the tension field. Tension is a fact about a string you
 *    already own, not part of choosing one, and the field was parented to
 *    nothing — it duplicated the "Set tension" control one row above it. It
 *    moved to `YourKitCard` alongside the rows it describes.
 *  - It does not explain itself. The instruction line ("Search, or browse by
 *    brand") sat between the heading and the control it was describing; the
 *    search field's own placeholder carries the catalog count instead, which
 *    also answers the question the sheet never did — how many are there.
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
  ownedItems = [],
  activeItemId,
  onPick,
  busy,
  online,
  category = 'racket',
  title,
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
  const heading = title ?? t('racketSheetTitle');

  useEffect(() => {
    if (!open) return;
    let live = true;
    setLoaded(false);
    // The sheet is rendered once with no `key` and a changing `category`, so
    // it is never remounted and every field below survives into the next
    // open. `catalog` and `loadError` have to be cleared for the same reason
    // as the rest: otherwise the previous category's items stay on screen
    // while the new fetch is in flight, and a stale error pill outlives it.
    setCatalog([]);
    setLoadError(false);
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

  /** catalogId → the member's own entry, for the owned rows' caption. */
  const ownedByCatalogId = useMemo(() => {
    const m = new Map<string, GearItem>();
    for (const i of ownedItems) if (i.catalogId) m.set(i.catalogId, i);
    return m;
  }, [ownedItems]);

  const isOwned = useMemo(
    () => (id: string) => ownedCatalogIds.includes(id) || ownedByCatalogId.has(id),
    [ownedCatalogIds, ownedByCatalogId],
  );

  // Catalog order is curation order — keep it for both tabs and rows.
  const brands = useMemo(() => {
    const seen: string[] = [];
    for (const c of catalog) if (!seen.includes(c.brand)) seen.push(c.brand);
    return seen;
  }, [catalog]);

  // A query searches the WHOLE catalog and bypasses the brand tabs —
  // filtering within the selected brand would hide matches and read as broken.
  //
  // `searchCatalog` rather than a substring test: the substring test could not
  // find the Halbertec 5000 for a member who typed "helbatec", and an empty
  // list is indistinguishable from a row that isn't in the catalog. See
  // lib/gearSearch.ts.
  const models = useMemo(() => {
    if (!query.trim()) return brand === null ? catalog : catalog.filter((c) => c.brand === brand);
    return searchCatalog(catalog, query, (c) => {
      const series = typeof c.attributes?.series === 'string' ? c.attributes.series : '';
      return `${c.brand} ${c.model} ${series}`;
    });
  }, [catalog, brand, query]);

  /**
   * Rows grouped under a brand heading that carries its own count.
   *
   * The brand used to be the first line of every row, which meant "YONEX"
   * printed five times in a row directly under a filter chip already saying
   * Yonex. As a heading it says the same thing once and adds the count, and
   * it survives the case that made the per-row brand necessary in the first
   * place: a cross-brand SEARCH result still groups, so a result list spanning
   * three brands still tells you which is which.
   */
  const groups = useMemo(() => {
    const order: string[] = [];
    const byBrand = new Map<string, CatalogItem[]>();
    for (const c of models) {
      if (!byBrand.has(c.brand)) { byBrand.set(c.brand, []); order.push(c.brand); }
      byBrand.get(c.brand)!.push(c);
    }
    return order.map((b) => ({ brand: b, items: byBrand.get(b)! }));
  }, [models]);

  // The brand tab can still go stale one way: a brand disappearing from the
  // catalog empties the tab you're standing on. Falling back to All rather
  // than to another brand — All is a superset, so it can never be empty while
  // anything is in the catalog, and it is the state the sheet opens in anyway.
  //
  // `brand === null` is NOT stale; it is the All tab.
  useEffect(() => {
    if (brand !== null && !brands.includes(brand)) setBrand(null);
  }, [brands, brand]);

  /** One place a `GearResult` failure becomes words. */
  function messageFor(reason: string): string {
    if (reason === 'bag_full') return t('bagFull');
    if (reason === 'duplicate_racket') return t('bagDuplicate');
    if (reason === 'unauthorized') return t('bagSignInAgain');
    if (reason === 'member_not_found') return t('bagMemberMissing');
    if (reason === 'tension_not_saved') return t('bagTensionNotSaved');
    if (reason === 'rate_limited') return t('bagRateLimited');
    return t('recError');
  }

  async function pick(item: CatalogItem) {
    if (busy) return;
    setPickError(null);
    const res = await onPick(item);
    if (res.ok) { onClose(); return; }
    // Actionable, not decorative. "Refresh to try again" is the wrong
    // instruction for a lapsed session — refreshing cannot mint a cookie, so
    // it sends the member round a loop that never terminates.
    setPickError(messageFor(res.reason));
  }

  /** What an owned row says about itself, in place of the spec line. */
  function ownedCaption(item: CatalogItem): string {
    const mine = ownedByCatalogId.get(item.id);
    if (mine && mine.id === activeItemId && (mine.category ?? 'racket') === 'racket') {
      return tGear('inKitActive');
    }
    if (mine && typeof mine.tensionLbs === 'number') {
      return tGear('inKitTension', { lb: mine.tensionLbs });
    }
    return tGear('railInKit');
  }

  const searchPlaceholder = category === 'string'
    ? t('searchCountString', { count: catalog.length })
    : t('searchCountRacket', { count: catalog.length });

  const showControls = loaded && !loadError && catalog.length > 0;

  return (
    <BottomSheet open={open} onClose={onClose} ariaLabel={heading} maxHeight="92dvh">
      <BottomSheetHeader>
        <span className="fs-lg" style={{ fontWeight: 600 }}>{heading}</span>
        <button
          type="button"
          onClick={onClose}
          aria-label={tRecovery('close')}
          style={{ background: 'transparent', border: 'none', cursor: 'pointer', minWidth: 44, minHeight: 44, display: 'flex', alignItems: 'center', justifyContent: 'center' }}
        >
          <span className="material-icons" style={{ fontSize: 'var(--fs-stat)' }}>close</span>
        </button>
      </BottomSheetHeader>

      {/* Search and the brand tabs are the sheet's controls, so they sit
          OUTSIDE the scroller and stay put while the list moves under them.
          Search used to be third in reading order, below the kit card and an
          instruction line; it is the first thing you can act on. */}
      {showControls && (
        <div style={{ flex: '0 0 auto', padding: '0 var(--space-6) var(--space-4)', display: 'flex', flexDirection: 'column', gap: 'var(--space-3)' }}>
          <div className="sheet-search">
            <span className="material-icons" aria-hidden="true">search</span>
            <input
              type="search"
              value={query}
              onChange={(e) => setQuery(e.target.value)}
              placeholder={searchPlaceholder}
              aria-label={searchPlaceholder}
            />
          </div>

          {/* Brand tabs: All plus 3 brands today, so a segment control still
              fits. Canonical pattern: wrapper needs `flex`, tabs need flex-1.
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
        </div>
      )}

      <BottomSheetBody bare>
        <div style={{ paddingBottom: 'var(--space-6)' }}>
          {/* The messages keep the sheet's own 20px column; only the rows go
              edge to edge. */}
          <div style={{ padding: '0 var(--space-6)', display: 'flex', flexDirection: 'column', gap: 'var(--space-3)' }}>
            {loadError && <ErrorState message={t('recError')} />}

            {/* Loaded-but-empty must not look like a working screen with
                nothing on it. (Not hypothetical: the production container held
                zero rackets from day one — see lib/catalogSeed.ts.) */}
            {loaded && !loadError && catalog.length === 0 && (
              <EmptyState>{t('racketCatalogEmpty')}</EmptyState>
            )}

            {loaded && !loadError && catalog.length > 0 && models.length === 0 && (
              <EmptyState>{t('searchNoMatches')}</EmptyState>
            )}
          </div>

          {/* Disabled while a write is in flight or offline. Styled rather
              than un-wired: dropping the onClick would swap the row from a
              <button> to a <div>, losing the semantics with no visual cue
              that anything changed. Same principle as .cc-btn:disabled — see
              CLAUDE.md's design-system-first rule. */}
          <div
            style={busy ? { opacity: 0.5, pointerEvents: 'none' } : undefined}
            aria-busy={busy || undefined}
          >
            {groups.map((g) => (
              <section className="sheet-group" key={g.brand}>
                <p className="section-label-muted sheet-group-label">
                  {g.brand} · {g.items.length}
                </p>
                <ul className="sheet-list">
                  {g.items.map((c) => {
                    const owned = isOwned(c.id);
                    if (owned) {
                      return (
                        <li key={c.id}>
                          {/* Not a button. An owned row has already answered
                              the question you are asking the list, and there
                              is nothing to add. */}
                          <div className="sheet-row sheet-row--owned">
                            <span
                              className="material-icons"
                              aria-hidden="true"
                              style={{ fontSize: 'var(--icon-md)', color: 'var(--accent)', flex: '0 0 auto' }}
                            >
                              check_circle
                            </span>
                            <span style={{ flex: 1, display: 'flex', flexDirection: 'column', gap: 2 }}>
                              <span className="fs-lg">{c.model}</span>
                              <span className="fs-sm" style={{ color: 'var(--text-muted)' }}>{ownedCaption(c)}</span>
                            </span>
                          </div>
                        </li>
                      );
                    }
                    const spec = specLine(c);
                    return (
                      <li key={c.id}>
                        <button
                          type="button"
                          className="sheet-row"
                          onClick={() => pick(c)}
                          aria-label={`${c.brand} ${c.model}`}
                        >
                          <span style={{ flex: 1, display: 'flex', flexDirection: 'column', gap: 2 }}>
                            <span className="fs-lg">{c.model}</span>
                            {spec && <span className="fs-sm" style={{ color: 'var(--text-muted)' }}>{spec}</span>}
                          </span>
                          <span
                            className="material-icons"
                            aria-hidden="true"
                            style={{ fontSize: 'var(--icon-md)', color: 'var(--text-muted)', flex: '0 0 auto' }}
                          >
                            add
                          </span>
                        </button>
                      </li>
                    );
                  })}
                </ul>
              </section>
            ))}
          </div>

          <div style={{ padding: 'var(--space-4) var(--space-6) 0', display: 'flex', flexDirection: 'column', gap: 'var(--space-3)' }}>
            {pickError && <ErrorState message={pickError} />}
            {!online && (
              <p className="fs-sm" style={{ color: 'var(--text-muted)', margin: 0 }}>{tStats('offline')}</p>
            )}
          </div>
        </div>
      </BottomSheetBody>
    </BottomSheet>
  );
}
