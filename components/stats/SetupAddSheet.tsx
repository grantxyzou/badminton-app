'use client';

import { useMemo, useState } from 'react';
import { useTranslations } from 'next-intl';
import ErrorState from '@/components/primitives/ErrorState';
import EmptyState from '@/components/primitives/EmptyState';
import Switch from '@/components/primitives/Switch';
import { BottomSheet, BottomSheetHeader, BottomSheetBody, BottomSheetFooter } from '../BottomSheet';
import RacketThumb from './RacketThumb';
import TensionStepper from './TensionStepper';
import { useCatalog } from './useCatalog';
import type { UseGear } from './useGear';
import type { UseGearPicks } from './useGearPicks';
import { searchCatalog } from '@/lib/gearSearch';
import { gearFailureMessage } from '@/lib/gearFailureMessage';
import { blankStringPairing, racketRowSpec, racketSpecLine, setupLines, stringSpecLine, type SetupCategory } from '@/lib/gearSetup';
import type { CatalogItem, GearItem } from '@/lib/types';

export interface SetupAddSheetProps {
  open: boolean;
  onClose: () => void;
  category: SetupCategory;
  gear: UseGear;
  picks: UseGearPicks;
  /**
   * Rackets only: whether a saved racket starts as the one in play. True from
   * a blank line or "Change the model", false from "Add another racket as a
   * spare". The saved panel's switch can flip it either way afterwards.
   */
  makeActive: boolean;
}

/**
 * "Add a racket" / "Add strings" — the Set-up card's picker (claude.ai/design
 * "Equipment redesign", screens 02–03).
 *
 * PICKING AND STORING ARE ONE PASS. A tap saves, and the row it saved expands
 * where it sat with the one follow-up that matters — in play for a racket,
 * strung-at for a string — plus an out for both, so nothing has to be
 * returned to later. The follow-up is optional by construction: the item is
 * already in the bag before the panel appears.
 *
 * The suggestion is a row, not a card, and it ASKS before it saves ("Is this
 * the one you play?"). Grant's call, 2026-09-14: a suggestion accepted in one
 * tap is the easiest way to fill the club tally with rackets nobody owns.
 *
 * Mount it with a fresh `key` per opening (the register does): every piece of
 * state here describes one visit, and a remount is the whole reset.
 */
export default function SetupAddSheet({ open, onClose, category, gear, picks, makeActive }: SetupAddSheetProps) {
  const t = useTranslations('stats.gear.setup');
  const tGear = useTranslations('stats.gear');
  const tHub = useTranslations('valueHub');
  const tRecovery = useTranslations('recovery');
  const catalog = useCatalog(category);

  const [query, setQuery] = useState('');
  const [brand, setBrand] = useState<string | null>(null);
  const [pendingId, setPendingId] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [confirming, setConfirming] = useState(false);
  const [dismissed, setDismissed] = useState(false);
  /** The catalog row this visit saved, and the racket in play before it. */
  const [saved, setSaved] = useState<{ catalogId: string; prevActiveId: string | null } | null>(null);
  /** A tension the member CHOSE for the saved string; null = not chosen. */
  const [tension, setTension] = useState<number | null>(null);

  const items = useMemo(
    () => (gear.gear?.items ?? []).filter((i): i is GearItem => !!i && !i.retiredAt && (i.category ?? 'racket') === category),
    [gear.gear, category],
  );
  const ownedIds = useMemo(() => new Set(items.map((i) => i.catalogId).filter(Boolean) as string[]), [items]);
  const savedItem = saved ? items.find((i) => i.catalogId === saved.catalogId) ?? null : null;

  const brands = useMemo(() => {
    const seen: string[] = [];
    for (const c of catalog.items) if (!seen.includes(c.brand)) seen.push(c.brand);
    return seen;
  }, [catalog.items]);

  const models = useMemo(() => {
    if (!query.trim()) return brand === null ? catalog.items : catalog.items.filter((c) => c.brand === brand);
    return searchCatalog(catalog.items, query, (c) => {
      const series = typeof c.attributes?.series === 'string' ? c.attributes.series : '';
      return `${c.brand} ${c.model} ${series}`;
    });
  }, [catalog.items, brand, query]);

  const groups = useMemo(() => {
    const order: string[] = [];
    const byBrand = new Map<string, CatalogItem[]>();
    for (const c of models) {
      if (!byBrand.has(c.brand)) { byBrand.set(c.brand, []); order.push(c.brand); }
      byBrand.get(c.brand)!.push(c);
    }
    return order.map((b) => ({ brand: b, items: byBrand.get(b)! }));
  }, [models]);

  // The suggestion belongs to a BLANK line only. Once the line is filled the
  // racket engine answers "where you'd go next", a different question from
  // "which one is yours", and asking "is this the one you play?" about a step
  // up would be asking the wrong thing.
  // A string is suggested on the SAME rule the card's blank line quotes it
  // (`blankStringPairing`): only against a racket the member has. Without one
  // the engine pairs against a recommended frame the card never names.
  const lines = setupLines(gear.gear);
  const racketPick = picks.view.racket;
  const basePick = category === 'string'
    ? blankStringPairing(lines, picks.view.string)
    : (!lines.racket && racketPick.status === 'ready' ? racketPick.pick : null);
  const suggestion = basePick && !dismissed && !query.trim() && !ownedIds.has(basePick.item.id)
    ? (category === 'string' ? picks.view.string.pick : racketPick.pick)
    : null;

  function rowSpec(c: CatalogItem): string | null {
    return category === 'string' ? stringSpecLine(c, (k) => t(k)) : racketRowSpec(c);
  }

  async function pick(item: CatalogItem) {
    if (gear.busy || pendingId) return;
    setError(null);
    setPendingId(item.id);
    const prevActiveId = gear.active?.id ?? null;
    try {
      const res = await gear.add(item, category === 'racket' && makeActive ? { makeActive: true } : undefined);
      if (!res.ok) {
        setError(gearFailureMessage(res.reason, tHub));
        return;
      }
      setSaved({ catalogId: item.id, prevActiveId });
      setTension(null);
      setConfirming(false);
    } finally {
      setPendingId(null);
    }
  }

  /** Writes a tension the member CHOSE, once, on the way out of the panel.
   *  Each stepper tap is local: twenty bag writes an hour is the limit, and a
   *  stepper that wrote per tap would spend it in one adjustment. */
  async function commitTension(): Promise<boolean> {
    if (category !== 'string' || !savedItem || tension === null) return true;
    const res = await gear.setTension(savedItem, tension);
    if (!res.ok) {
      setError(gearFailureMessage(res.reason, tHub));
      return false;
    }
    return true;
  }

  async function finish() {
    if (await commitTension()) onClose();
  }

  async function addAnother() {
    if (!(await commitTension())) return;
    setSaved(null);
    setTension(null);
  }

  async function setInPlay(next: boolean) {
    if (!savedItem) return;
    setError(null);
    const target = next ? savedItem.id : saved?.prevActiveId;
    if (!target) return;
    const res = await gear.activate(target);
    if (!res.ok) setError(gearFailureMessage(res.reason, tHub));
  }

  const heading = category === 'string' ? t('addString') : t('addRacket');
  const searchPlaceholder = category === 'string'
    ? tHub('searchCountString', { count: catalog.items.length })
    : tHub('searchCountRacket', { count: catalog.items.length });
  const showControls = catalog.loaded && !catalog.loadError && catalog.items.length > 0;
  // A string's suggested starting point: the pairing's own figure, never an
  // invented one. A racket panel has no tension (tension is stored on strings).
  // Only for the string the pairing was FOR: BG85's 23 lb is not a starting
  // point for BG65, it is a number about a different string.
  const stringPick = picks.view.string.pick;
  const suggestedLbs = category === 'string' && saved && stringPick?.item.id === saved.catalogId
    && typeof stringPick.tensionLbs === 'number'
    ? stringPick.tensionLbs
    : null;

  function savedPanel(c: CatalogItem) {
    return (
      <div className="setup-saved" key={c.id}>
        <div className="setup-saved-head">
          <span className="material-icons" aria-hidden="true" style={{ fontSize: 'var(--icon-md)', color: 'var(--accent)' }}>check_circle</span>
          {category === 'racket' && <RacketThumb saved />}
          <span className="fs-lg" style={{ flex: 1, minWidth: 0, fontWeight: 600 }}>{c.model}</span>
          <span className="fs-sm" style={{ color: 'var(--text-secondary)' }}>{t('saved')}</span>
        </div>
        {category === 'string' ? (
          <>
            <div className="setup-saved-indent">
              <span className="fs-sm" style={{ color: 'var(--text-secondary)' }}>{t('strungAt')}</span>
              <TensionStepper value={tension} suggested={suggestedLbs} onChange={setTension} disabled={!savedItem || gear.busy} />
              <span className="fs-sm" style={{ color: 'var(--text-secondary)' }}>{tGear('lb')}</span>
              <button type="button" className="setup-link" style={{ marginLeft: 'auto' }} onClick={() => { setTension(null); onClose(); }} disabled={gear.busy}>
                {t('dontKnow')}
              </button>
            </div>
            <p className="fs-xs" style={{ margin: 0, paddingLeft: 'var(--space-7)', color: 'var(--text-muted)', lineHeight: 'var(--lh-normal)' }}>
              {t('tensionHelp')}
            </p>
          </>
        ) : (
          <div className="setup-saved-indent">
            <Switch
              checked={!!savedItem && gear.active?.id === savedItem.id}
              onChange={(next) => { void setInPlay(next); }}
              ariaLabel={t('inPlaySwitch')}
              // Nothing to hand the pointer back to when this is the only
              // racket — "off" would leave the card with no racket in play.
              disabled={!savedItem || gear.busy || !gear.online || (!saved?.prevActiveId && gear.active?.id === savedItem?.id)}
            />
            <span className="fs-base" style={{ color: 'var(--text-primary)' }}>{t('inPlaySwitch')}</span>
          </div>
        )}
      </div>
    );
  }

  return (
    <BottomSheet open={open} onClose={() => { void finish(); }} ariaLabel={heading} maxHeight="92dvh">
      <BottomSheetHeader>
        <span className="fs-stat" style={{ fontFamily: 'var(--font-display)', fontWeight: 700, letterSpacing: '-0.015em' }}>
          {heading}
        </span>
        <button
          type="button"
          onClick={() => { void finish(); }}
          aria-label={tRecovery('close')}
          style={{ background: 'transparent', border: 'none', cursor: 'pointer', minWidth: 44, minHeight: 44, display: 'flex', alignItems: 'center', justifyContent: 'center' }}
        >
          <span className="material-icons" style={{ fontSize: 'var(--fs-stat)' }}>close</span>
        </button>
      </BottomSheetHeader>

      {showControls && !saved && (
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

      {error && (
        <div style={{ flex: '0 0 auto', padding: '0 var(--space-6) var(--space-4)' }}>
          <ErrorState message={error} />
        </div>
      )}

      <BottomSheetBody bare>
        <div style={{ paddingBottom: 'var(--space-6)', display: 'flex', flexDirection: 'column', gap: 'var(--space-4)' }}>
          {(catalog.loadError || (catalog.loaded && catalog.items.length === 0) || (showControls && models.length === 0)) && (
            <div style={{ padding: '0 var(--space-6)' }}>
              {catalog.loadError
                ? <ErrorState message={tHub('catalogError')} />
                : catalog.items.length === 0
                  ? <EmptyState>{tHub('racketCatalogEmpty')}</EmptyState>
                  : <EmptyState>{tHub('searchNoMatches')}</EmptyState>}
            </div>
          )}

          {/* The saved row, where it sat. While it is open the rest of the
              list steps back: the panel is the question on screen now. */}
          {saved && (() => {
            const c = catalog.items.find((x) => x.id === saved.catalogId);
            return c ? savedPanel(c) : null;
          })()}

          {!saved && suggestion && (
            <div style={{ padding: '0 var(--space-6)', display: 'flex', flexDirection: 'column', gap: 'var(--space-2)' }}>
              <p className="setup-eyebrow setup-eyebrow--accent">{t('fromCheckIn')}</p>
              {confirming ? (
                <div className="setup-suggest" role="group" aria-label={t('confirmSuggestion')}>
                  {category === 'racket' && <RacketThumb />}
                  <span className="setup-suggest-body">
                    <span className="fs-lg" style={{ color: 'var(--text-primary)' }}>{suggestion.item.model}</span>
                    <span className="fs-sm" style={{ color: 'var(--text-secondary)' }}>{t('confirmSuggestion')}</span>
                    <span style={{ display: 'flex', gap: 'var(--space-4)', alignItems: 'center' }}>
                      <button type="button" className="setup-link" onClick={() => { void pick(suggestion.item); }} disabled={!!pendingId || !gear.online}>
                        {t('confirmYes')}
                      </button>
                      <button type="button" className="setup-link" style={{ color: 'var(--text-secondary)' }} onClick={() => { setConfirming(false); setDismissed(true); }}>
                        {t('confirmNo')}
                      </button>
                    </span>
                  </span>
                </div>
              ) : (
                <button type="button" className="setup-suggest" onClick={() => setConfirming(true)} disabled={!gear.online}>
                  {category === 'racket' && <RacketThumb />}
                  <span className="setup-suggest-body">
                    <span className="fs-lg" style={{ color: 'var(--text-primary)' }}>{suggestion.item.model}</span>
                    <span className="fs-sm" style={{ color: 'var(--text-secondary)' }}>
                      {[
                        suggestion.item.brand,
                        category === 'string' ? stringSpecLine(suggestion.item, (k) => t(k)) : racketSpecLine(suggestion.item),
                        typeof suggestion.item.msrp === 'number' ? `~$${suggestion.item.msrp}` : null,
                      ].filter(Boolean).join(' · ')}
                    </span>
                  </span>
                  <span className="material-icons" aria-hidden="true" style={{ fontSize: 'var(--icon-md)', color: 'var(--accent)' }}>add</span>
                </button>
              )}
            </div>
          )}

          {!saved && (
            <div aria-busy={pendingId !== null || undefined}>
              {groups.map((g) => (
                <section className="sheet-group" key={g.brand}>
                  <p className="section-label-muted sheet-group-label">{g.brand} · {g.items.length}</p>
                  <ul className="sheet-list">
                    {g.items.map((c) => {
                      const owned = ownedIds.has(c.id);
                      const spec = rowSpec(c);
                      return (
                        <li key={c.id}>
                          {owned ? (
                            <div className="sheet-row sheet-row--owned">
                              {category === 'racket' && <RacketThumb />}
                              <span style={{ flex: 1, display: 'flex', flexDirection: 'column', gap: 'var(--space-05)' }}>
                                <span className="fs-lg">{c.model}</span>
                                <span className="fs-sm" style={{ color: 'var(--text-muted)' }}>{tGear('railInKit')}</span>
                              </span>
                              <span className="material-icons" aria-hidden="true" style={{ fontSize: 'var(--icon-md)', color: 'var(--accent)' }}>check_circle</span>
                            </div>
                          ) : (
                            <button
                              type="button"
                              className="sheet-row"
                              onClick={() => { void pick(c); }}
                              aria-label={`${c.brand} ${c.model}`}
                              aria-busy={pendingId === c.id || undefined}
                              disabled={pendingId === c.id || !gear.online}
                              style={pendingId === c.id ? { opacity: 0.5, pointerEvents: 'none' } : undefined}
                            >
                              {category === 'racket' && <RacketThumb />}
                              <span style={{ flex: 1, display: 'flex', flexDirection: 'column', gap: 'var(--space-05)' }}>
                                <span className="fs-lg">{c.model}</span>
                                {spec && <span className="fs-sm" style={{ color: 'var(--text-muted)' }}>{spec}</span>}
                              </span>
                              <span className="material-icons" aria-hidden="true" style={{ fontSize: 'var(--icon-md)', color: 'var(--text-muted)' }}>add</span>
                            </button>
                          )}
                        </li>
                      );
                    })}
                  </ul>
                </section>
              ))}
            </div>
          )}
        </div>
      </BottomSheetBody>

      {saved && (
        <BottomSheetFooter>
          <div style={{ display: 'flex', flexDirection: 'column', gap: 'var(--space-2)' }}>
            <button type="button" className="btn-primary" style={{ width: '100%' }} onClick={() => { void finish(); }} disabled={gear.busy}>
              {t('done')}
            </button>
            <button type="button" className="setup-link" style={{ alignSelf: 'center', color: 'var(--text-secondary)', padding: 'var(--space-2) 0' }} onClick={() => { void addAnother(); }} disabled={gear.busy}>
              {category === 'string' ? t('addAnotherString') : t('addAnotherRacket')}
            </button>
          </div>
        </BottomSheetFooter>
      )}
    </BottomSheet>
  );
}
