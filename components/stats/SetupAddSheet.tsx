'use client';

import { useMemo, useRef, useState } from 'react';
import { useTranslations } from 'next-intl';
import ErrorState from '@/components/primitives/ErrorState';
import EmptyState from '@/components/primitives/EmptyState';
import Switch from '@/components/primitives/Switch';
import { BottomSheet, BottomSheetHeader, BottomSheetBody, BottomSheetFooter } from '../BottomSheet';
import RacketThumb from './RacketThumb';
import TensionField, { ratedRange } from './TensionField';
import { useClubTension } from './useClubTension';
import RacketFeelChips from './RacketFeelChips';
import { useCatalog } from './useCatalog';
import type { UseGear } from './useGear';
import type { UseGearPicks } from './useGearPicks';
import { searchCatalog } from '@/lib/gearSearch';
import { FACETS, applyFilters, facetValues, hasFilters, type Applied, type Facet } from '@/lib/catalogFilters';
import { isOffered } from '@/lib/catalogOffer';
import { gearFailureMessage } from '@/lib/gearFailureMessage';
import { blankStringPairing, racketRowSpec, racketSpecLine, setupLines, stringSpecLine, type SetupCategory } from '@/lib/gearSetup';
import { hasFeel } from '@/lib/racketFeel';
import { recordEngagement } from '@/lib/engagement';
import type { CatalogItem, GearItem, RacketFeel } from '@/lib/types';
import { priceCadPoint } from '@/lib/catalogPrice';
import { crossesFor } from '@/lib/stringing';

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
  /**
   * Strings only: "Change the string" REPLACES the string on the card. The card
   * shows one string, so an old one kept behind the new one would be invisible
   * yet still vote in the club tally and count toward the bag cap. The new
   * string is added first and the old one removed after, so a failed add never
   * costs the member the string they have.
   */
  replacesId?: string;
  /**
   * Strings only: the MAINS string item's id, when this visit picks a hybrid's
   * crosses string. A pick is stored nested on that item (`setCrosses`), never
   * as a bag item of its own — see `lib/stringCrosses.ts` for why.
   */
  crossesForId?: string;
}

const FACET_LABEL: Record<Facet, string> = {
  brand: 'filterBrand',
  weight: 'filterWeight',
  balance: 'filterBalance',
  flex: 'filterShaft',
  type: 'filterType',
};

/** `pendingId` while a typed name is being saved; no catalog id looks like it. */
const TYPED_PENDING = ':typed';

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
export default function SetupAddSheet({ open, onClose, category, gear, picks, makeActive, replacesId, crossesForId }: SetupAddSheetProps) {
  const t = useTranslations('stats.gear.setup');
  /** A chip's words for a facet value. Catalog values stay as the catalog
   *  spells them; "Even" alone reads as a number, so it says what it is. */
  function chipLabel(facet: Facet, value: string): string {
    if (facet === 'balance' && value === 'Even') return t('chipEvenBalance');
    if (facet === 'flex') return t('chipShaft', { value });
    return value;
  }
  const tGear = useTranslations('stats.gear');
  const tHub = useTranslations('valueHub');
  const tRecovery = useTranslations('recovery');
  const catalog = useCatalog(category);
  // The frame a string goes on is the racket in play: its rated window bounds
  // the tension steppers and names the club's band.
  const racketCatalog = useCatalog('racket');
  const frameId = category === 'string' ? gear.active?.catalogId ?? null : null;
  const frameRow = frameId ? racketCatalog.items.find((c) => c.id === frameId) : undefined;
  const clubTension = useClubTension(frameId);
  // The browse list and its count: a withdrawn row stays resolvable (a saved
  // racket still finds its specs) but is never offered to someone new.
  const offered = useMemo(() => catalog.items.filter(isOffered), [catalog.items]);

  const [query, setQuery] = useState('');
  const [applied, setApplied] = useState<Applied>({});
  /** The facet whose options are open under the chip row, if any. */
  const [openFacet, setOpenFacet] = useState<Facet | null>(null);
  const [pendingId, setPendingId] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [confirming, setConfirming] = useState(false);
  const [dismissed, setDismissed] = useState(false);
  /** What this visit saved — a catalog row, or a racket typed by name
   *  (`catalogId: null`) — and the racket in play before it. */
  const [saved, setSaved] = useState<{ catalogId: string | null; label: string; prevActiveId: string | null } | null>(null);
  /** A tension the member CHOSE for the saved string; null = not chosen. */
  const [tension, setTension] = useState<number | null>(null);
  /** How a typed-in racket feels, as answered so far. Written once, on the
   *  way out of the panel, like the tension. */
  const [feel, setFeel] = useState<RacketFeel>({});

  const items = useMemo(
    () => (gear.gear?.items ?? []).filter((i): i is GearItem => !!i && !i.retiredAt && (i.category ?? 'racket') === category),
    [gear.gear, category],
  );
  // Crosses mode: the mains string the crosses go with. A crosses string is a
  // DIFFERENT string by definition, so the mains (and the crosses already
  // there) read as taken; everything else in the bag is irrelevant.
  const mains = crossesForId ? items.find((i) => i.id === crossesForId) ?? null : null;
  const crossesMode = category === 'string' && !!crossesForId;
  const ownedIds = useMemo(() => new Set((crossesMode
    ? [mains?.catalogId, mains?.crosses?.catalogId]
    : items.map((i) => i.catalogId)).filter(Boolean) as string[]), [items, crossesMode, mains]);
  const savedItem = crossesMode ? (saved ? mains : null) : saved
    ? items.find((i) => (saved.catalogId
      ? i.catalogId === saved.catalogId
      : !i.catalogId && i.label.trim().toLowerCase() === saved.label.trim().toLowerCase())) ?? null
    : null;

  // Search and filters compose: the query narrows the catalog, then every
  // applied chip narrows that. Counts, headers and rows all read `models`, so
  // they cannot disagree with the chips.
  const models = useMemo(() => {
    const searched = query.trim()
      ? searchCatalog(offered, query, (c) => {
        const series = typeof c.attributes?.series === 'string' ? c.attributes.series : '';
        return `${c.brand} ${c.model} ${series}`;
      })
      : offered;
    return applyFilters(searched, applied);
  }, [offered, applied, query]);
  const facets = FACETS[category];
  const narrowing = hasFilters(applied) || query.trim().length > 0;

  function applyFacet(facet: Facet, value: string) {
    setApplied((a) => ({ ...a, [facet]: value }));
    setOpenFacet(null);
    recordEngagement('catalog_filter_applied', { category });
  }
  function removeFacet(facet: Facet) {
    setApplied((a) => {
      const next = { ...a };
      delete next[facet];
      return next;
    });
  }
  function clearFilters() {
    setApplied({});
    setOpenFacet(null);
    setQuery('');
  }

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
  const suggestion = !crossesMode && basePick && !dismissed && !query.trim() && !ownedIds.has(basePick.item.id)
    ? (category === 'string' ? picks.view.string.pick : racketPick.pick)
    : null;

  // "Add “…”" offers the typed name as a racket of its own. Rackets only: a
  // string the catalog lacks has nothing the pairing engine could read. Hidden
  // when the bag already holds that name — the route would call it a duplicate —
  // and when the name IS a catalog racket, which the row above already offers
  // with its real specs; a free-text copy of it would be a racket the engine
  // cannot read standing in for one it can.
  const typed = query.trim().slice(0, 80);
  const typedKey = typed.toLowerCase().replace(/\s+/g, ' ');
  const offerTyped = category === 'racket' && catalog.loaded && !catalog.loadError && offered.length > 0 && typed.length > 0
    && !items.some((i) => i.label.trim().toLowerCase() === typedKey)
    && !offered.some((c) => c.model.toLowerCase() === typedKey || `${c.brand} ${c.model}`.toLowerCase() === typedKey);

  function rowSpec(c: CatalogItem): string | null {
    return category === 'string' ? stringSpecLine(c, (k) => t(k)) : racketRowSpec(c);
  }

  const replacedRef = useRef(false);

  async function pick(item: CatalogItem) {
    if (gear.busy || pendingId) return;
    setError(null);
    setPendingId(item.id);
    const prevActiveId = gear.active?.id ?? null;
    try {
      if (crossesMode) {
        if (!mains) return;
        // A new crosses string keeps the crosses tension already on record:
        // the frame and the stringer did not change with the string.
        const res = await gear.setCrosses(mains.id, {
          catalogId: item.id,
          label: `${item.brand} ${item.model}`,
          ...(typeof mains.crosses?.tensionLbs === 'number' ? { tensionLbs: mains.crosses.tensionLbs } : null),
        });
        if (!res.ok) { setError(gearFailureMessage(res.reason, tHub)); return; }
        setSaved({ catalogId: item.id, label: `${item.brand} ${item.model}`, prevActiveId });
        setTension(null);
        return;
      }
      // "Change the string" replaces the MAINS; a hybrid's crosses stay, so
      // they are carried onto the new item before the old one goes.
      const replacedCrosses = replacesId ? items.find((i) => i.id === replacesId)?.crosses : undefined;
      const res = await gear.add(item, category === 'racket' && makeActive ? { makeActive: true } : undefined);
      if (!res.ok) {
        setError(gearFailureMessage(res.reason, tHub));
        return;
      }
      setSaved({ catalogId: item.id, label: `${item.brand} ${item.model}`, prevActiveId });
      // Once: "Add another string" from the same visit adds, it does not replace again.
      if (category === 'string' && replacesId && !replacedRef.current) {
        replacedRef.current = true;
        if (replacedCrosses && res.itemId) {
          const carried = await gear.setCrosses(res.itemId, replacedCrosses);
          // The old string still holds the crosses; removing it now would lose
          // them for good. Keep it and say so — nothing is lost, and the card
          // simply shows the new string until the member tries again.
          if (!carried.ok) { setError(gearFailureMessage(carried.reason, tHub)); return; }
        }
        const removed = await gear.remove(replacesId);
        if (!removed.ok) setError(gearFailureMessage(removed.reason, tHub));
      }
      setTension(null);
      setConfirming(false);
    } finally {
      setPendingId(null);
    }
  }

  /**
   * "Add “Auraspeed 90S”" — a racket the catalog does not have, by the name the
   * member typed. Grant, 2026-09-14: a missing racket should cost the member
   * nothing, and every name typed here is a racket the club really plays.
   */
  async function pickTyped(label: string) {
    const trimmed = label.trim();
    if (!trimmed || gear.busy || pendingId) return;
    setError(null);
    setPendingId(TYPED_PENDING);
    const prevActiveId = gear.active?.id ?? null;
    try {
      const res = await gear.addCustom(trimmed, makeActive ? { makeActive: true } : undefined);
      if (!res.ok) {
        setError(gearFailureMessage(res.reason, tHub));
        return;
      }
      setSaved({ catalogId: null, label: trimmed, prevActiveId });
      setFeel({});
    } finally {
      setPendingId(null);
    }
  }

  /** Writes what the member CHOSE in the panel, once, on the way out of it —
   *  a string's tension or a typed racket's feel. Each tap is local: the bag
   *  and preference limits are per hour, and a control that wrote per tap
   *  would spend them in one adjustment. */
  async function commitFollowUp(): Promise<boolean> {
    if (!savedItem) return true;
    let res;
    if (crossesMode && tension !== null && savedItem.crosses) res = await gear.setCrosses(savedItem.id, { ...savedItem.crosses, tensionLbs: tension });
    else if (category === 'string' && tension !== null) res = await gear.setTension(savedItem, tension);
    else if (category === 'racket' && !savedItem.catalogId && hasFeel(feel)) res = await gear.setFeel(savedItem.id, feel);
    if (res && !res.ok) {
      setError(gearFailureMessage(res.reason, tHub));
      return false;
    }
    return true;
  }

  async function finish() {
    if (await commitFollowUp()) onClose();
  }

  async function addAnother() {
    if (!(await commitFollowUp())) return;
    setSaved(null);
    setTension(null);
    setFeel({});
    setQuery('');
  }

  async function setInPlay(next: boolean) {
    if (!savedItem) return;
    setError(null);
    const target = next ? savedItem.id : saved?.prevActiveId;
    if (!target) return;
    const res = await gear.activate(target);
    if (!res.ok) setError(gearFailureMessage(res.reason, tHub));
  }

  const heading = crossesMode ? t('addCrossesHeading') : category === 'string' ? t('addString') : t('addRacket');
  const searchPlaceholder = category === 'string'
    ? tHub('searchCountString', { count: offered.length })
    : tHub('searchCountRacket', { count: offered.length });
  const showControls = catalog.loaded && !catalog.loadError && offered.length > 0;
  // A string's suggested starting point: the pairing's own figure, never an
  // invented one. A racket panel has no tension (tension is stored on strings).
  // Only for the string the pairing was FOR: BG85's 23 lb is not a starting
  // point for BG65, it is a number about a different string.
  const stringPick = picks.view.string.pick;
  const suggestedLbs = crossesMode
    // Crosses: the figure already on record, else a couple of pounds over the
    // mains (`lib/stringing.ts`). Never the pairing's number, which is a mains.
    ? (mains?.crosses?.tensionLbs ?? (typeof mains?.tensionLbs === 'number' ? crossesFor(mains.tensionLbs) : null))
    : category === 'string' && saved && stringPick?.item.id === saved.catalogId
      && typeof stringPick.tensionLbs === 'number'
      ? stringPick.tensionLbs
      : null;

  function savedPanel(catalogId: string | null, title: string) {
    return (
      <div className="setup-saved" key={catalogId ?? `typed:${title}`}>
        <div className="setup-saved-head">
          <span className="material-icons" aria-hidden="true" style={{ fontSize: 'var(--icon-md)', color: 'var(--accent)' }}>check_circle</span>
          {category === 'racket' && <RacketThumb catalogId={catalogId} saved />}
          <span className="fs-lg" style={{ flex: 1, minWidth: 0, fontWeight: 600 }}>{title}</span>
          <span className="fs-sm" style={{ color: 'var(--text-secondary)' }}>{t('saved')}</span>
        </div>
        {category === 'string' ? (
          <>
            <div className="setup-saved-indent setup-saved-indent--stack">
              <span className="tension-field-label">
                <span className="fs-sm" style={{ color: 'var(--text-primary)', fontWeight: 600 }}>{crossesMode ? t('crossesTension') : t('strungAt')}</span>
                <button type="button" className="setup-link" onClick={() => { setTension(null); recordEngagement('tension_skipped', { catalogId: saved?.catalogId ?? undefined }); onClose(); }} disabled={gear.busy}>
                  {t('dontKnow')}
                </button>
              </span>
              <TensionField
                label={crossesMode ? t('crossesTension') : t('strungAt')}
                value={tension}
                suggested={suggestedLbs}
                onChange={setTension}
                rated={ratedRange(frameRow?.attributes)}
                // The club's band is a MAINS band; it says nothing about crosses.
                club={crossesMode ? null : clubTension.band}
                clubStatus={frameId && !crossesMode ? clubTension.status : undefined}
                autoFocus
                disabled={!savedItem || gear.busy}
              />
            </div>
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
        {category === 'racket' && !catalogId && (
          <div className="setup-saved-indent" style={{ flexDirection: 'column', alignItems: 'stretch' }}>
            <span className="fs-md" style={{ color: 'var(--text-primary)', fontWeight: 600 }}>{t('feelTitle')}</span>
            <span className="fs-sm" style={{ color: 'var(--text-secondary)', lineHeight: 'var(--lh-normal)' }}>{t('feelHelp')}</span>
            <RacketFeelChips value={feel} onChange={setFeel} disabled={!savedItem || gear.busy} />
          </div>
        )}
      </div>
    );
  }

  return (
    <BottomSheet open={open} onClose={() => { void finish(); }} ariaLabel={heading}>
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
              enterKeyHint="search"
              value={query}
              onChange={(e) => setQuery(e.target.value)}
              placeholder={searchPlaceholder}
              aria-label={searchPlaceholder}
            />
            {query && (
              <button type="button" className="sheet-search-clear" onClick={() => setQuery('')} aria-label={t('clearSearch')}>
                <span className="material-icons" aria-hidden="true">close</span>
              </button>
            )}
          </div>
          {/* Applied chips first, then the facets still unset. One row that
              scrolls sideways; it never wraps into a second. */}
          <div className="filter-chips" role="group" aria-label={t('filters')}>
            {facets.filter((f) => applied[f] !== undefined).map((f) => (
              <button key={f} type="button" className="filter-chip filter-chip--applied" aria-pressed="true"
                onClick={() => removeFacet(f)} aria-label={t('removeFilter', { value: chipLabel(f, applied[f]!) })}>
                {chipLabel(f, applied[f]!)}
                <span className="material-icons" aria-hidden="true">close</span>
              </button>
            ))}
            {facets.filter((f) => applied[f] === undefined).map((f) => (
              <button key={f} type="button" className="filter-chip" aria-expanded={openFacet === f}
                onClick={() => setOpenFacet(openFacet === f ? null : f)}>
                {t(FACET_LABEL[f])}
                <span className="material-icons" aria-hidden="true">{openFacet === f ? 'expand_less' : 'expand_more'}</span>
              </button>
            ))}
          </div>
          {openFacet && (
            <div className="filter-options" role="group" aria-label={t(FACET_LABEL[openFacet])}>
              {facetValues(offered, openFacet).map((v) => (
                <button key={v} type="button" className="filter-chip" onClick={() => applyFacet(openFacet, v)}>
                  {chipLabel(openFacet, v)}
                </button>
              ))}
            </div>
          )}
          {narrowing && (
            <div className="filter-result">
              <span>{t(category === 'string' ? 'resultCountString' : 'resultCountRacket', { shown: models.length, total: offered.length })}</span>
              <button type="button" className="setup-link" onClick={clearFilters}>{t('clearFilters')}</button>
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
          {(catalog.loadError || (catalog.loaded && offered.length === 0) || (showControls && !saved && models.length === 0)) && (
            <div style={{ padding: '0 var(--space-6)' }}>
              {catalog.loadError
                ? <ErrorState message={tHub('catalogError')} />
                : offered.length === 0
                  ? <EmptyState>{tHub('racketCatalogEmpty')}</EmptyState>
                  : <EmptyState>{hasFilters(applied) ? t('noFilterMatches') : tHub('searchNoMatches')}</EmptyState>}
            </div>
          )}

          {/* The saved row, where it sat. While it is open the rest of the
              list steps back: the panel is the question on screen now. */}
          {saved && (() => {
            if (!saved.catalogId) return savedPanel(null, saved.label);
            const c = catalog.items.find((x) => x.id === saved.catalogId);
            return c ? savedPanel(c.id, c.model) : null;
          })()}

          {!saved && suggestion && (
            <div style={{ padding: '0 var(--space-6)', display: 'flex', flexDirection: 'column', gap: 'var(--space-2)' }}>
              <p className="setup-eyebrow setup-eyebrow--accent">{t('fromCheckIn')}</p>
              {confirming ? (
                <div className="setup-suggest" role="group" aria-label={t('confirmSuggestion')}>
                  {category === 'racket' && <RacketThumb catalogId={suggestion.item.id} />}
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
                  {category === 'racket' && <RacketThumb catalogId={suggestion.item.id} />}
                  <span className="setup-suggest-body">
                    <span className="fs-lg" style={{ color: 'var(--text-primary)' }}>{suggestion.item.model}</span>
                    <span className="fs-sm" style={{ color: 'var(--text-secondary)' }}>
                      {[
                        suggestion.item.brand,
                        category === 'string' ? stringSpecLine(suggestion.item, (k) => t(k)) : racketSpecLine(suggestion.item),
                        priceCadPoint(suggestion.item) !== null ? `~$${priceCadPoint(suggestion.item)}` : null,
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
                  {/* While anything narrows the list, the header counts what is SHOWN. */}
                  <p className="section-label-muted sheet-group-label">
                    {narrowing ? t('groupMatch', { brand: g.brand, count: g.items.length }) : `${g.brand} · ${g.items.length}`}
                  </p>
                  <ul className="sheet-list">
                    {g.items.map((c) => {
                      const owned = ownedIds.has(c.id);
                      const spec = rowSpec(c);
                      return (
                        <li key={c.id}>
                          {owned ? (
                            <div className="sheet-row sheet-row--owned">
                              {category === 'racket' && <RacketThumb catalogId={c.id} />}
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
                              {category === 'racket' && <RacketThumb catalogId={c.id} />}
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
              {offerTyped && (
                <ul className="sheet-list">
                  <li>
                    <button
                      type="button"
                      className="sheet-row"
                      onClick={() => { void pickTyped(typed); }}
                      aria-busy={pendingId === TYPED_PENDING || undefined}
                      disabled={pendingId === TYPED_PENDING || !gear.online}
                      style={pendingId === TYPED_PENDING ? { opacity: 0.5, pointerEvents: 'none' } : undefined}
                    >
                      <RacketThumb catalogId={null} />
                      <span style={{ flex: 1, display: 'flex', flexDirection: 'column', gap: 'var(--space-05)' }}>
                        <span className="fs-lg">{t('addTyped', { label: typed })}</span>
                        <span className="fs-sm" style={{ color: 'var(--text-muted)' }}>{t('addTypedHelp')}</span>
                      </span>
                      <span className="material-icons" aria-hidden="true" style={{ fontSize: 'var(--icon-md)', color: 'var(--accent)' }}>add</span>
                    </button>
                  </li>
                </ul>
              )}
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
            {/* A hybrid has one crosses string; there is no "another". */}
            {!crossesMode && (
              <button type="button" className="setup-link" style={{ alignSelf: 'center', color: 'var(--text-secondary)', padding: 'var(--space-2) 0' }} onClick={() => { void addAnother(); }} disabled={gear.busy}>
                {category === 'string' ? t('addAnotherString') : t('addAnotherRacket')}
              </button>
            )}
          </div>
        </BottomSheetFooter>
      )}
    </BottomSheet>
  );
}
