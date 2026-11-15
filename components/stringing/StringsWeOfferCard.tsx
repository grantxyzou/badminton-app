'use client';

import { useEffect, useMemo, useState } from 'react';
import { useTranslations } from 'next-intl';
import CardHeader from '@/components/primitives/CardHeader';
import ErrorState from '@/components/primitives/ErrorState';
import EmptyState from '@/components/primitives/EmptyState';
import Collapse from '@/components/primitives/Collapse';
import ListRow from '@/components/primitives/ListRow';
import StringPackImage from './StringPackImage';
import { stringPackSrc } from '@/lib/stringPackSrc';
import { useRevealReady } from '@/components/primitives/Reveal';
import { useCatalog } from '@/components/stats/useCatalog';
import { stringSpecLine } from '@/lib/gearSetup';
import { canPlot } from '@/lib/stringMap';
import {
  AXIS_MAX,
  MAP_AXES,
  axisValueOf,
  bestForOf,
  controlOf,
  durabilityOf,
  feelWordOf,
  isPlottable,
  parseShelf,
  powerOf,
  shelfPrice,
  sortShelf,
  stringTypeOf,
  traitTint,
  typeDotFill,
  type MapAxis,
  type Trait,
  type Shelf,
  type ShelfEntry,
  type StockBand,
} from '@/lib/stringShelf';
import StringDetailSheet from './StringDetailSheet';
import { StringingAside, useStringingAside } from './StringingAside';
import CardSkeleton from '@/components/primitives/CardSkeleton';
import { STRINGING_HEIGHTS } from '@/components/TabFallbacks';
import StringMap, { type MapDot } from './StringMap';
import StockBadge from './StockBadge';
import { ColourDots } from './StringColours';
import StringPeek from './StringPeek';
import StringListSheet, { type ListSort } from './StringListSheet';
import { useTabActive } from '@/lib/tabActivity';
import { isRefused } from '@/lib/apiFetch';
import type { FitVerdict } from '@/lib/types';

const BASE = process.env.NEXT_PUBLIC_BASE_PATH ?? '';
/** `--duration-sheet` in globals.css: a sheet's close, waited out before a hand-off. */
const SHEET_CLOSE_MS = 180;
const AXIS_KEY = 'bpm:strings-axis';

/** The side axis the member last picked; power, the map's original, otherwise. */
function readAxis(): MapAxis {
  try {
    const v = localStorage.getItem(AXIS_KEY);
    return (MAP_AXES as readonly string[]).includes(v ?? '') ? (v as MapAxis) : 'power';
  } catch {
    return 'power';
  }
}

/**
 * The strings the club offers, what each one is like, what a restring with it
 * costs and whether it is on the shelf (docs/design/strings-shelf-spec.md,
 * design 4a — built on docs/plans/string-inventory.md, Grant: "I want people
 * to be able to see the strings I provide with its attributes and qualities
 * etc. Educational stuff").
 *
 * Opens on the MAP: durability along the bottom against the member's pick of
 * power, control or feel up the side, one dot per string, so the shelf reads
 * as a set of trade-offs rather than a column of grey rows. Power alone was
 * near-diagonal — power and durability are mirror images in the catalog — so
 * the switch is what lets a control string like Aerobite Boost stand out
 * (docs/plans/string-inventory.md, Decisions, 2026-10-16). The
 * LIST is one tap away and is the full text equivalent — sorted by power,
 * with every string, including the ones the map cannot plot. Browsing only:
 * a request still starts from the Home card's request sheet.
 *
 * Renders nothing when the club lists nothing — the request form already
 * explains that case. As the Stringing tab's whole Strings register
 * (`showEmpty`, docs/plans/stringing-tabs.md) it says so instead, because a
 * tab that opens onto nothing reads as broken.
 *
 * It also carries the rest of the prices there: a restring with the player's
 * own string, and the stringer's note. The service card's "View pricing"
 * expander used to hold them, and listed every string's price a second time.
 */
interface Props {
  /** The whole register rather than one card among others: say "nothing
   *  listed" instead of rendering nothing. */
  showEmpty?: boolean;
  /** A string's page "Restring with this string": the tab opens the request
   *  with it picked. */
  onRestring?: (label: string) => void;
}

/** The pricing doc's two player-facing extras. */
interface OtherPrices {
  ownStringCents: number | null;
  note: string;
}

export default function StringsWeOfferCard({ showEmpty = false, onRestring }: Props) {
  const t = useTranslations('home.stringing.offer');
  const tSetup = useTranslations('stats.gear.setup');
  const catalog = useCatalog('string');
  const [shelf, setShelf] = useState<Shelf | null>(null);
  const [status, setStatus] = useState<'loading' | 'ready' | 'failed'>('loading');
  const [attempt, setAttempt] = useState(0);
  const [open, setOpen] = useState<string | null>(null);
  /* On a foldable a string opens on the right page, beside the shelf, in
     place of its sheet — and one is open before any tap (docs/plans/
     foldable-layout.md). `null` on one screen. */
  const aside = useStringingAside();
  const [learnOpen, setLearnOpen] = useState(false);
  const [axis, setAxis] = useState<MapAxis>(() => (typeof window === 'undefined' ? 'power' : readAxis()));
  /** Picked on the map; persists while the tab is mounted. Nothing is picked
   *  until the member taps a dot: the peek then points back at the map. */
  const [picked, setPicked] = useState<string | null>(null);
  /** The whole shelf as a list, the peek's swipe-up with nothing picked. */
  const [listOpen, setListOpen] = useState(false);
  const [listSort, setListSort] = useState<ListSort>('power');
  /** Which strings suit the member's own racket (`/api/stringing/fit?ids=`),
   *  for the map's glow, the peek and the list. null until it answers or
   *  when it cannot say (no racket, no check-in): then nothing glows. */
  const [fits, setFits] = useState<{ racket: string; verdicts: Record<string, FitVerdict> } | null>(null);
  const [peekH, setPeekH] = useState(0);
  const onScreen = useTabActive();
  // null = not read yet; 'failed' leaves the rows out rather than guess "Ask".
  const [other, setOther] = useState<OtherPrices | 'failed' | null>(null);
  // Asks for the other prices again on its own, so a retry does not empty the
  // whole card back to a skeleton.
  const [otherAttempt, setOtherAttempt] = useState(0);

  useEffect(() => {
    let cancelled = false;
    fetch(`${BASE}/api/stringing/strings`, { cache: 'no-store' })
      .then((r) => (r.ok ? r.json() : null))
      .then((d) => {
        if (cancelled) return;
        const parsed = parseShelf(d);
        if (parsed) {
          setShelf(parsed);
          setStatus('ready');
        } else setStatus('failed');
      })
      .catch(() => { if (!cancelled) setStatus('failed'); });
    return () => { cancelled = true; };
  }, [attempt]);

  useEffect(() => {
    let cancelled = false;
    fetch(`${BASE}/api/stringing/pricing`, { cache: 'no-store' })
      .then((r) => (r.ok ? r.json() : null))
      .then((d) => {
        if (cancelled) return;
        // `services` is the doc's own marker that it was read; without it the
        // answer is unknown, and an unknown price is never shown as "Ask".
        if (!d || !Array.isArray(d.services)) { setOther('failed'); return; }
        setOther({
          ownStringCents: typeof d.ownStringCents === 'number' ? d.ownStringCents : null,
          note: typeof d.note === 'string' ? d.note : '',
        });
      })
      .catch(() => { if (!cancelled) setOther('failed'); });
    return () => { cancelled = true; };
  }, [otherAttempt]);

  const entries = useMemo<ShelfEntry[]>(() => {
    if (!shelf) return [];
    // A catalog that failed to load knows nothing: every row is unlinked.
    const byId = new Map(catalog.loadError ? [] : catalog.items.map((i) => [i.id, i]));
    return sortShelf(shelf.strings.map((label) => ({ label, item: (shelf.links[label] && byId.get(shelf.links[label])) || null })));
  }, [shelf, catalog.items, catalog.loadError]);

  // The racket match for every string the catalog knows, once. A refusal or
  // a failure leaves the map unmarked: the glow is a bonus, never a claim.
  const fitIds = useMemo(() => entries.map((e) => e.item?.id).filter((x): x is string => !!x).slice(0, 40).join(','), [entries]);
  useEffect(() => {
    if (!fitIds) return;
    let cancelled = false;
    fetch(`${BASE}/api/stringing/fit?ids=${encodeURIComponent(fitIds)}`, { cache: 'no-store' })
      .then((r) => (isRefused(r) || !r.ok ? null : r.json()))
      .then((d) => {
        if (cancelled) return;
        setFits(d && typeof d.racket === 'string' && d.fits && typeof d.fits === 'object' ? { racket: d.racket, verdicts: d.fits } : null);
      })
      .catch(() => { if (!cancelled) setFits(null); });
    return () => { cancelled = true; };
  }, [fitIds]);
  const matches = useMemo(
    () => new Set(Object.entries(fits?.verdicts ?? {}).filter(([, v]) => v === 'good_match').map(([k]) => k)),
    [fits],
  );

  // Holds its place until the list, the catalog and the prices have answered,
  // so the price rows never arrive after the card. An empty list closes the
  // slot, unless this is the whole register (`showEmpty`).
  const ready = status !== 'loading' && (catalog.loaded || catalog.loadError) && other !== null;
  const empty = status === 'ready' && (shelf?.strings.length ?? 0) === 0;
  useRevealReady(ready, empty && !showEmpty);
  // On a foldable the right page holds the string's place while the shelf
  // loads, so the tab opens on two pages rather than moving to them.
  if (!ready && aside) {
    return (
      <StringingAside id="loading">
        <CardSkeleton height={STRINGING_HEIGHTS.detail} />
      </StringingAside>
    );
  }
  if (!ready || (empty && !showEmpty)) return null;

  // The own-string price and the note, below the strings they sit beside.
  // Inset by a row's own padding, so the label and the figure line up with
  // the strings' names and prices above them.
  const otherPrices = other === 'failed' ? (
    // The Pricing details register is the only place these live, so a failed
    // read says so rather than going quiet, with a way to ask again.
    <ErrorState
      message={t('pricesError')}
      action={<button type="button" className="cc-btn cc-btn-ghost" onClick={() => setOtherAttempt((n) => n + 1)}>{t('retry')}</button>}
    />
  ) : other?.note ? (
    // The stringer's note. "Bring your own string" and its price left this
    // card for the request sheet's own row, where the choice is made.
    <p className="fs-sm" style={{ color: 'var(--text-muted)', padding: '0 var(--space-4)' }}>{other.note}</p>
  ) : null;

  if (empty) {
    return (
      <div className="glass-card p-5 space-y-3">
        <CardHeader compact icon="storefront" title={t('title')} subtitle={t('subtitle')} />
        <EmptyState icon="storefront">{t('empty')}</EmptyState>
        {otherPrices}
      </div>
    );
  }

  const bandOf = (label: string): StockBand | null => shelf?.stock?.[label] ?? null;
  const plotted = entries.filter(isPlottable);
  const notOnMap = entries.filter((e) => !isPlottable(e));
  // Too few to plot is list-only: a map of two dots says nothing.
  const mapOn = canPlot(plotted.length);
  const showMap = mapOn;
  // Only a string the member tapped: with nothing picked the peek points
  // back at the map instead of choosing for them.
  const selected = plotted.find((e) => e.label === picked) ?? null;

  const name = (e: ShelfEntry) => (e.item ? `${e.item.brand} ${e.item.model}` : e.label);
  /** The figure, "Ask", or null when the stringer has set no price. */
  const priceText = (label: string): string | null => {
    if (!shelf) return null;
    const p = shelfPrice(shelf, label);
    return p === undefined ? null : p ?? t('priceAsk');
  };

  function pickAxis(next: MapAxis) {
    setAxis(next);
    try { localStorage.setItem(AXIS_KEY, next); } catch { /* private mode: the choice lasts the visit */ }
  }

  function openRow(e: ShelfEntry) {
    if (!e.item) return;
    if (isPlottable(e)) setPicked(e.label);
    setOpen(e.label);
  }

  // An axis is offered only when enough strings are rated on it to plot — the
  // same floor as the map itself. Power is every plotted string, so it is
  // always there; a stored pick that no longer qualifies falls back to it.
  const axes = MAP_AXES.filter((a) => canPlot(plotted.filter((e) => axisValueOf(a, e.item) !== null).length));
  const shownAxis: MapAxis = axes.includes(axis) ? axis : 'power';
  // A string the catalog rates for power but not for the picked axis has no
  // place on this view; it is back the moment the member switches.
  const onAxis = plotted.filter((e) => axisValueOf(shownAxis, e.item) !== null);
  const dots: MapDot[] = onAxis.map((e) => ({
    key: e.label,
    model: e.item!.model,
    ariaLabel: t(`dotLabel_${shownAxis}`, { name: name(e), value: axisValueOf(shownAxis, e.item)!, max: AXIS_MAX[shownAxis], durability: durabilityOf(e.item)! }),
    value: axisValueOf(shownAxis, e.item)!,
    durability: durabilityOf(e.item)!,
    band: bandOf(e.label),
    type: stringTypeOf(e.item),
    match: matches.has(e.item!.id),
  }));
  const openEntry = entries.find((e) => e.label === open) ?? null;
  /* The right page's string: the one opened; else the map's pick (the
     string its card under the map already shows); else the first linked
     string still on the shelf. Only a string the catalog knows has a page. */
  const asideEntry = aside
    ? [openEntry, selected, ...entries.filter((e) => bandOf(e.label) !== 'out'), ...entries].find((e) => e?.item) ?? null
    : null;

  const anyPack = entries.some((e) => stringPackSrc(e.item?.id));
  const traitPart = (trait: Trait) => function TraitPart(chunks: React.ReactNode) {
    return <span data-trait={trait} style={{ whiteSpace: 'nowrap', color: traitTint(trait) }}>{chunks}</span>;
  };
  // Tags named apart from the numbers they wrap: next-intl takes both from one object.
  const traitParts = { powerPart: traitPart('power'), controlPart: traitPart('control'), durabilityPart: traitPart('durability') };
  /** The coloured trait line, or what stands in for it. */
  const traitLine = (e: ShelfEntry): React.ReactNode => {
    const p = powerOf(e.item);
    const d = durabilityOf(e.item);
    // A failed catalog knows nothing about ANY string, which is not the same as
    // this string being unknown: the card says so once, and the row stays quiet.
    return !e.item
      ? (catalog.loadError ? null : t('unknown'))
      : p !== null && d !== null
        // Each "Trait N" in its trait's colour (Grant, 2026-11-12, option A),
        // never broken across lines; the separators stay muted. The words and
        // numbers stay, so colour is never the only signal.
        ? (controlOf(e.item) !== null
          ? t.rich('listLineControl', { power: p, control: controlOf(e.item)!, durability: d, ...traitParts })
          : t.rich('listLine', { power: p, durability: d, ...traitParts }))
        : stringSpecLine(e.item, (k) => tSetup(k));
  };

  /**
   * ONE row's content, for the list AND the map's selected card, so the two
   * cannot drift: what the string's page used to lead with (Grant, 2026-11-12:
   * "This info should be on the first page in Strings we offer") — the packet;
   * the name and price; type · feel beside the stock; what it is for; then the
   * coloured trait line. On the map the type also wears its dot's colour, so
   * the map's colour is never the only signal (option D).
   */
  const rowContent = (e: ShelfEntry, onMap = false) => {
    const price = priceText(e.label);
    const type = stringTypeOf(e.item);
    const feel = feelWordOf(e.item);
    const headline = [type ? t(`hero_${type}`) : null, feel ? t(`heroFeel_${feel}`) : null].filter(Boolean).join(' · ');
    const band = bandOf(e.label);
    const bestFor = bestForOf(e.item);
    const trait = traitLine(e);
    const body = (
      <span style={{ flex: 1, minWidth: 0, display: 'flex', flexDirection: 'column', gap: 'var(--space-1)' }}>
        <span style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', gap: 'var(--space-3)' }}>
          <span style={{ display: 'inline-flex', alignItems: 'center', flexWrap: 'wrap', gap: 'var(--space-2)', minWidth: 0 }}>
            <span className="fs-lg" style={{ fontFamily: 'var(--font-display)', fontWeight: 700, color: 'var(--text-primary)' }}>{e.label}</span>
            {/* The colours on the reel, when the stringer has said. */}
            <ColourDots ids={shelf?.colours[e.label] ?? []} customs={shelf?.customColours} />
          </span>
          {price && <span className="fs-lg" style={{ flex: 'none', fontFamily: 'var(--font-mono)', fontWeight: 700, color: 'var(--text-primary)' }}>{price}</span>}
        </span>
        {(headline || band) && (
          <span style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', gap: 'var(--space-3)' }}>
            <span
              data-testid={onMap && type ? 'selected-type' : undefined}
              className="fs-base"
              style={{ display: 'inline-flex', alignItems: 'center', gap: 'var(--space-2)', fontWeight: 600, color: 'var(--text-secondary)' }}
            >
              {onMap && type && (
                <span aria-hidden="true" style={{ flex: 'none', width: 'var(--space-4)', height: 'var(--space-4)', borderRadius: '50%', background: typeDotFill(type) }} />
              )}
              {headline}
            </span>
            {band && <StockBadge band={band} />}
          </span>
        )}
        {bestFor && (
          <span className="fs-sm" style={{ color: 'var(--text-muted)', lineHeight: 'var(--lh-snug)' }}>{bestFor}</span>
        )}
        {trait && <span className="fs-sm" style={{ color: 'var(--text-muted)' }}>{trait}</span>}
      </span>
    );
    return {
      // The packet, when the string has one; a row without keeps its old shape.
      // A row with no packet keeps the packet's room while any row has
      // one, so every name in the list starts at the same edge.
      leading: stringPackSrc(e.item?.id)
        ? <StringPackImage catalogId={e.item!.id} size="row" />
        : anyPack ? <span aria-hidden="true" className="string-pack-row" style={{ flex: 'none' }} /> : undefined,
      title: body,
    };
  };

  const row = (e: ShelfEntry) => (
    <li key={e.label}>
      {/* A string the catalog does not know has no page to open, so its row
          is not a button. It is still on offer, with a price, so it keeps
          the row's surface at full strength: the half-opacity disabled row
          read as "not available". */}
      {e.item ? (
        <ListRow onClick={() => openRow(e)} {...rowContent(e)} />
      ) : (
        <div className="cc-mini-card" style={{ padding: 'var(--space-4)', borderRadius: 'var(--radius-lg)' }}>
          <ListRow {...rowContent(e)} />
        </div>
      )}
    </li>
  );

  const list = (rows: ShelfEntry[]) => (
    <ul style={{ listStyle: 'none', margin: 0, padding: 0 }} className="flex flex-col gap-2">
      {rows.map(row)}
    </ul>
  );

  const priceCentsOf = (label: string): number | null => {
    const v = shelf?.prices?.[label];
    return typeof v === 'number' ? v : null;
  };
  /** The picked string's two map numbers: what puts it where it is. */
  const pickedLine = selected
    ? `${t(`axisName_${shownAxis}`)} ${axisValueOf(shownAxis, selected.item) ?? '–'} · ${t('axisName_durability')} ${durabilityOf(selected.item) ?? '–'}`
    : '';
  const pickedMatch = !!(selected?.item && matches.has(selected.item.id));
  // The peek belongs to the map on a phone: on a foldable the right page
  // already shows the string, and a hidden tab shows nothing.
  const showPeek = showMap && onScreen && !aside && status !== 'failed';

  return (
    // Room under the card for the peek, so the map's foot is never under it.
    <div className="glass-card p-5 space-y-3" style={showPeek ? { marginBottom: peekH } : undefined}>
      {/* The card holds only the map and its controls (the Stringing canvas,
          idea B, 2026-11-12; Grant: "What if the map card only contains the
          map and the control?"). The list is the peek's swipe-up now, so the
          header's one button is "How to choose a string". */}
      <CardHeader
        compact
        icon="storefront"
        title={t('title')}
        subtitle={mapOn ? t('viewNameMap') : t('subtitle')}
        action={(
          <button
            type="button"
            onClick={() => setLearnOpen((v) => !v)}
            aria-expanded={learnOpen}
            aria-label={t('learnTitle')}
            className="cc-btn cc-btn-ghost"
            style={{ width: 44, height: 44, padding: 0, justifyContent: 'center' }}
          >
            <span className="material-icons icon-md" aria-hidden="true">school</span>
          </button>
        )}
      />
      {/* The lesson: four short paragraphs a member reads once. */}
      <Collapse open={learnOpen} spaceAbove="var(--space-3)">
        <div className="flex flex-col gap-3">
          {(['learnGauge', 'learnType', 'learnFeel', 'learnTension'] as const).map((k) => (
            <p key={k} className="fs-md" style={{ margin: 0, color: 'var(--text-secondary)', lineHeight: 'var(--lh-normal)' }}>{t(k)}</p>
          ))}
        </div>
      </Collapse>
      {catalog.loadError && status !== 'failed' && (
        <p className="fs-sm" role="status" style={{ color: 'var(--text-muted)' }}>{t('catalogError')}</p>
      )}
      {status === 'failed' ? (
        // The retry asks again WITHOUT going back to 'loading': loading returns
        // null, and the reveal slot has already let go of its skeleton, so the
        // register would go blank. The failure stays up until the answer.
        <ErrorState message={t('loadError')} action={<button type="button" className="cc-btn cc-btn-ghost" onClick={() => setAttempt((n) => n + 1)}>{t('retry')}</button>} />
      ) : showMap ? (
        <>
          {/* What runs up the side; durability always runs along the bottom.
              Pressed buttons, not tabs: nothing behind them is a tabpanel. */}
          {axes.length > 1 && (
            <div className="flex flex-col gap-2">
              <span className="fs-xs" style={{ color: 'var(--text-muted)' }}>{t('compareByAcross')}</span>
              <div className="segment-control flex" role="group" aria-label={t('axisSwitchLabel')}>
                {axes.map((a) => (
                  <button
                    key={a}
                    type="button"
                    aria-pressed={shownAxis === a}
                    onClick={() => pickAxis(a)}
                    className={`flex-1 flex items-center justify-center fs-sm rounded-full ${shownAxis === a ? 'segment-tab-active' : 'segment-tab-inactive'}`}
                  >
                    {t(`axisName_${a}`)}
                  </button>
                ))}
              </div>
            </div>
          )}
          {/* The member's racket, on the map itself (Grant: "we should not
              loose this AI personalized analysis. In fact it should be top
              level visible"): the strings that suit it glow. */}
          {fits && (
            <div data-testid="map-fit-strip" className="bpm-fit-strip">
              <span className="material-icons icon-md" aria-hidden="true" style={{ color: 'var(--accent)' }}>sports_tennis</span>
              <span className="fs-sm" style={{ flex: 1, minWidth: 0, color: 'var(--text-secondary)' }}>
                <span style={{ fontWeight: 600, color: 'var(--text-primary)' }}>{t('forYourRacket', { racket: fits.racket })}</span>
                {' · '}
                {matches.size > 0 ? t('forYourRacketGlow') : t('forYourRacketNone')}
              </span>
            </div>
          )}
          <StringMap
            dots={dots}
            selected={selected?.label ?? null}
            onSelect={(label) => {
              setPicked(label);
              // The right page follows the map's pick.
              if (aside) setOpen(null);
            }}
            yLabel={t(`axisUp_${shownAxis}`)}
            mapLabel={t(`mapLabel_${shownAxis}`)}
            axisName={t(`axisName_${shownAxis}`)}
          />
          {notOnMap.length > 0 && (
            <button type="button" className="link-quiet link-quiet--flush fs-sm" onClick={() => setListOpen(true)}>
              {t('notOnMapLink', { count: notOnMap.length })}
            </button>
          )}
          {aside && otherPrices}
        </>
      ) : (
        <>
          {list(entries)}
          {otherPrices}
        </>
      )}

      {showPeek && (
        <StringPeek
          onOpen={() => (selected ? setOpen(selected.label) : setListOpen(true))}
          openLabel={selected ? t('peekOpenString', { name: name(selected) }) : t('peekOpenList')}
          onHeight={setPeekH}
        >
          {selected ? (
            <span aria-live="polite" style={{ display: 'flex', flexDirection: 'column', gap: 'var(--space-1)' }}>
              <span style={{ display: 'flex', alignItems: 'center', gap: 'var(--space-3)' }}>
                {selected.item && stringPackSrc(selected.item.id) && <StringPackImage catalogId={selected.item.id} size="line" />}
                <span style={{ flex: 1, minWidth: 0, display: 'flex', alignItems: 'baseline', gap: 'var(--space-3)', whiteSpace: 'nowrap', overflow: 'hidden' }}>
                  <span className="fs-lg" style={{ display: 'inline-flex', alignItems: 'center', gap: 'var(--space-2)', fontWeight: 600, color: 'var(--text-primary)' }}>
                    <span aria-hidden="true" style={{ flex: 'none', width: 'var(--space-3)', height: 'var(--space-3)', borderRadius: '50%', background: typeDotFill(stringTypeOf(selected.item)) }} />
                    {selected.label}
                  </span>
                  <span className="fs-sm" style={{ color: 'var(--text-muted)', overflow: 'hidden', textOverflow: 'ellipsis' }}>{pickedLine}</span>
                </span>
                <span className="fs-sm" style={{ flex: 'none', display: 'inline-flex', alignItems: 'center', color: 'var(--text-muted)' }}>
                  {t('peekMore')}
                  <span className="material-icons icon-md" aria-hidden="true">expand_less</span>
                </span>
              </span>
              {pickedMatch && fits && (
                <span className="fs-sm" data-testid="peek-match" style={{ display: 'inline-flex', alignItems: 'center', gap: 'var(--space-2)', color: 'var(--text-secondary)' }}>
                  <span className="material-icons icon-sm" aria-hidden="true" style={{ color: 'var(--accent)' }}>check_circle</span>
                  {t('goodMatchFor', { racket: fits.racket })}
                </span>
              )}
            </span>
          ) : (
            <span style={{ display: 'flex', alignItems: 'center', gap: 'var(--space-3)', color: 'var(--text-muted)' }}>
              <span className="material-icons icon-md" aria-hidden="true">expand_less</span>
              <span className="fs-base" style={{ flex: 1 }}>{t('peekEmpty')}</span>
              <span className="fs-sm" style={{ flex: 'none', opacity: 0.7 }}>{t('peekSwipeList')}</span>
            </span>
          )}
        </StringPeek>
      )}

      <StringListSheet
        open={listOpen && !aside}
        onClose={() => setListOpen(false)}
        entries={entries}
        sort={listSort}
        onSort={setListSort}
        priceOf={priceText}
        priceCents={priceCentsOf}
        matches={matches}
        racket={fits?.racket ?? null}
        onOpenString={(label) => {
          // The list steps aside for the string's page, never under it.
          setListOpen(false);
          const e = entries.find((x) => x.label === label);
          if (e && isPlottable(e)) setPicked(label);
          window.setTimeout(() => setOpen(label), SHEET_CLOSE_MS);
        }}
        footer={otherPrices}
      />

      <StringDetailSheet
        item={openEntry?.item ?? null}
        label={openEntry?.label ?? null}
        onRestring={onRestring ? (label) => {
          // Let this sheet close on its own (--duration-sheet) before the tab
          // switches register and the request sheet rises: switching first
          // unmounted it mid-sheet, a cut instead of a hand-off.
          setOpen(null);
          window.setTimeout(() => onRestring(label), SHEET_CLOSE_MS);
        } : undefined}
        open={!aside && openEntry?.item != null}
        onClose={() => setOpen(null)}
        price={openEntry && shelf ? shelfPrice(shelf, openEntry.label) : undefined}
        band={openEntry ? bandOf(openEntry.label) : null}
        clubCount={openEntry ? shelf?.players[openEntry.label] ?? null : null}
        note={openEntry ? shelf?.notes[openEntry.label] ?? null : null}
        colours={openEntry ? shelf?.colours[openEntry.label] ?? [] : []}
        customColours={shelf?.customColours}
      />

      {asideEntry && (
        <StringingAside id={asideEntry.label}>
          <StringDetailSheet
            asPage
            item={asideEntry.item}
            label={asideEntry.label}
            onRestring={onRestring}
            open
            onClose={() => setOpen(null)}
            price={shelf ? shelfPrice(shelf, asideEntry.label) : undefined}
            band={bandOf(asideEntry.label)}
            clubCount={shelf?.players[asideEntry.label] ?? null}
            note={shelf?.notes[asideEntry.label] ?? null}
            colours={shelf?.colours[asideEntry.label] ?? []}
            customColours={shelf?.customColours}
          />
        </StringingAside>
      )}
    </div>
  );
}
