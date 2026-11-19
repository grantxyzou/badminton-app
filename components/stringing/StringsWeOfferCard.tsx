'use client';

import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { useTranslations } from 'next-intl';
import CardHeader from '@/components/primitives/CardHeader';
import AIBadge from '@/components/primitives/AIBadge';
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
import MapRacketSheet from './MapRacketSheet';
import MapRacketAskSheet from './MapRacketAskSheet';
import { useMapPlotHeight } from './useMapPlotHeight';
import { useTabActive, useTabReturn } from '@/lib/tabActivity';
import { useActiveName } from '@/lib/useActiveName';
import { routeInApp } from '@/lib/inAppNavigate';
import { isRefused } from '@/lib/apiFetch';
import type { FitRacketChoice, FitVerdict } from '@/lib/types';
import { sharedFetch } from '@/lib/sharedRead';

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

/** The map's racket match as the card holds it. */
interface MapFits {
  /** "Yonex Astrox 88D Pro": the racket the verdicts are for. */
  racket: string;
  /** Its id in the member's bag; null from a server older than the choice. */
  racketId: string | null;
  /** The member's rackets the map can be matched to. */
  rackets: FitRacketChoice[];
  verdicts: Record<string, FitVerdict>;
}

/** What the strip asks the member for when the map has no match to show:
 *  their racket (none in their equipment yet), or a skill check-in (the
 *  racket is known, the skills are not). */
type MapAsk = { kind: 'racket' } | { kind: 'check_in'; racket: string };

function parseFits(d: unknown): { fits: MapFits | null; ask: MapAsk | null } {
  const o = d as { racket?: unknown; racketId?: unknown; rackets?: unknown; fits?: unknown; ask?: unknown } | null;
  if (!o) return { fits: null, ask: null };
  if (typeof o.racket !== 'string' || !o.fits || typeof o.fits !== 'object') {
    const ask: MapAsk | null = o.ask === 'racket' ? { kind: 'racket' }
      : o.ask === 'check_in' && typeof o.racket === 'string' ? { kind: 'check_in', racket: o.racket }
        : null;
    return { fits: null, ask };
  }
  const rackets = Array.isArray(o.rackets)
    ? o.rackets.filter((r): r is FitRacketChoice => !!r && typeof r.id === 'string' && typeof r.name === 'string').map((r) => ({ id: r.id, name: r.name, inPlay: r.inPlay === true, ...(typeof r.catalogId === 'string' ? { catalogId: r.catalogId } : null) }))
    : [];
  return { fits: { racket: o.racket, racketId: typeof o.racketId === 'string' ? o.racketId : null, rackets, verdicts: o.fits as Record<string, FitVerdict> }, ask: null };
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
  const [fits, setFits] = useState<MapFits | null>(null);
  /** "Change" on the strip: the sheet, the pick being read, and whether the
   *  last pick's read failed (docs/plans/map-racket-choice.md). */
  /** What the strip asks for in place of a match, if anything. */
  const [ask, setAsk] = useState<MapAsk | null>(null);
  /** "What racket do you play with?": mounted on its first opening, so the
   *  register reads no gear doc for a member who never taps the strip. */
  const [askOpen, setAskOpen] = useState(false);
  const [askMounted, setAskMounted] = useState(false);
  const activeName = useActiveName();
  /** The racket picked under "Change", for this visit to the tab only: the
   *  map opens on the racket in play (Grant, 2026-11-19: "My main is default
   *  selected on the stringing page"). */
  const mapRacket = useRef<string | null>(null);
  /** Bumped to read the match again: back on the tab, or a racket added. */
  const [fitTick, setFitTick] = useState(0);
  const [racketOpen, setRacketOpen] = useState(false);
  const [racketPending, setRacketPending] = useState<string | null>(null);
  const [racketFailed, setRacketFailed] = useState(false);
  const [peekH, setPeekH] = useState(0);
  /** The peek's height with nothing picked: what the map's height budgets
   *  for, so a tap on a dot (a taller peek) never resizes the map. */
  const [peekRest, setPeekRest] = useState(0);
  const onScreen = useTabActive();
  // null = not read yet; 'failed' leaves the rows out rather than guess "Ask".
  const [other, setOther] = useState<OtherPrices | 'failed' | null>(null);
  // Asks for the other prices again on its own, so a retry does not empty the
  // whole card back to a skeleton.
  const [otherAttempt, setOtherAttempt] = useState(0);

  useEffect(() => {
    let cancelled = false;
    sharedFetch('/api/stringing/strings')
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
    sharedFetch('/api/stringing/pricing')
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
  // With a racket: the one the member picked under "Change", a row in their
  // own bag. The server answers for the racket in play when the bag no longer
  // holds it, and names the racket it answered for.
  const readFits = useCallback(
    (racket: string | null) =>
      fetch(`${BASE}/api/stringing/fit?ids=${encodeURIComponent(fitIds)}${racket ? `&racket=${encodeURIComponent(racket)}` : ''}`, { cache: 'no-store' })
        .then((r) => (isRefused(r) || !r.ok ? null : r.json()))
        .then(parseFits),
    [fitIds],
  );
  useEffect(() => {
    if (!fitIds) return;
    let cancelled = false;
    const picked = mapRacket.current;
    readFits(picked)
      .then((a) => {
        if (cancelled) return;
        setFits(a.fits);
        setAsk(a.ask);
        // A pick the bag no longer holds was not honoured: let it go.
        if (picked && a.fits?.racketId !== picked) mapRacket.current = null;
      })
      .catch(() => { if (!cancelled) { setFits(null); setAsk(null); } });
    return () => { cancelled = true; };
  }, [fitIds, readFits, fitTick]);
  // Back on the tab after a while away: the racket in play may have changed
  // on Stats, and the map is about the racket in play. A pick made under
  // "Change" was for the last visit. What is on screen stays while it reads.
  useTabReturn(() => {
    mapRacket.current = null;
    setFitTick((n) => n + 1);
  });

  /** Match the map to another of the member's rackets, for this visit.
   *  Applied only once that racket's answer is in; a failure says so in the
   *  sheet and leaves the map as it was. */
  function chooseRacket(id: string) {
    if (racketPending) return;
    setRacketPending(id);
    setRacketFailed(false);
    readFits(id)
      .then(({ fits: f }) => {
        if (!f || f.racketId !== id) { setRacketFailed(true); return; }
        setFits(f);
        // Back on the racket in play is no pick at all.
        mapRacket.current = f.rackets.find((r) => r.id === id)?.inPlay ? null : id;
        setRacketOpen(false);
      })
      .catch(() => setRacketFailed(true))
      .finally(() => setRacketPending(null));
  }
  const matches = useMemo(
    () => new Set(Object.entries(fits?.verdicts ?? {}).filter(([, v]) => v === 'good_match').map(([k]) => k)),
    [fits],
  );

  // The map's height is what this screen has room for, so the card, the
  // strip and the peek fit without scrolling on a shorter phone.
  const cardRef = useRef<HTMLDivElement>(null);
  const stripRef = useRef<HTMLDivElement>(null);
  const plotH = useMapPlotHeight(
    cardRef,
    stripRef,
    peekRest,
    `${status}|${catalog.loaded}|${other !== null}|${entries.length}|${onScreen}|${axis}|${learnOpen}|${fits ? fits.racket : ask ? ask.kind : ''}`,
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

  // The member's racket, under the map card (Grant: "we should not loose this
  // AI personalized analysis. In fact it should be top level visible"; moved
  // out of the card on the canvas, 2026-11-16, so the map has the card): the
  // strings that suit it glow on the map.
  // "Change" (Grant, on the canvas, 2026-11-18: "this should allow user
  // change rackets") only for a member with another racket to change to.
  const canChangeRacket = (fits?.rackets.length ?? 0) > 1;
  const fitBanner = showMap && fits && status !== 'failed' ? (
    <div ref={stripRef} data-testid="map-fit-strip" className="bpm-fit-strip">
      {/* The match is the app's own analysis of this racket and these skills,
          so it wears the AI badge, and the dots it picked wear its rim
          (Grant, on a screenshot, 2026-11-19). */}
      <AIBadge label={t('aiBadgeLabel')}>{t('aiBadge')}</AIBadge>
      {/* The racket on one line, what the glow means on the next. */}
      <span className="fs-sm" style={{ flex: 1, minWidth: 0, display: 'flex', flexDirection: 'column', color: 'var(--text-secondary)' }}>
        <span style={{ fontWeight: 600, color: 'var(--text-primary)' }}>{t('forYourRacket', { racket: fits.racket })}</span>
        <span>{matches.size > 0 ? t('forYourRacketGlow') : t('forYourRacketNone')}</span>
      </span>
      {canChangeRacket && (
        <button
          type="button"
          className="bpm-fit-strip-change fs-sm tap-44"
          aria-label={t('changeRacketLabel', { racket: fits.racket })}
          aria-haspopup="dialog"
          onClick={() => { setRacketFailed(false); setRacketOpen(true); }}
        >
          {t('changeRacket')}
        </button>
      )}
    </div>
  ) : showMap && ask && status !== 'failed' ? (
    // Nothing to glow for yet, and the strip says what would change that
    // (Grant, 2026-11-19: "the strip should ask for me what am I using then
    // it can make a recommendation"). The same strip, the same place.
    <div ref={stripRef} data-testid="map-fit-strip" className="bpm-fit-strip">
      <span className="material-icons icon-md" aria-hidden="true" style={{ color: 'var(--accent)' }}>sports_tennis</span>
      <span className="fs-sm" style={{ flex: 1, minWidth: 0, display: 'flex', flexDirection: 'column', color: 'var(--text-secondary)' }}>
        <span style={{ fontWeight: 600, color: 'var(--text-primary)' }}>
          {ask.kind === 'racket' ? t('askRacket') : t('forYourRacket', { racket: ask.racket })}
        </span>
        <span>{ask.kind === 'racket' ? t('askRacketWhy') : t('askCheckIn')}</span>
      </span>
      {ask.kind === 'racket' ? (
        // Without a name to key the write by, there is nothing to add to.
        activeName.name && (
          <button
            type="button"
            className="bpm-fit-strip-change fs-sm tap-44"
            aria-haspopup="dialog"
            onClick={() => { setAskMounted(true); setAskOpen(true); }}
          >
            {t('askRacketAction')}
          </button>
        )
      ) : (
        // The check-in lives on Stats; the tab switch reloads nothing.
        <button type="button" className="bpm-fit-strip-change fs-sm tap-44" onClick={() => { routeInApp(`${BASE}/?tab=skills`); }}>
          {t('askCheckInAction')}
        </button>
      )}
    </div>
  ) : null;

  return (
    // Room under the card and its banner for the peek, so neither is under it.
    <div className="flex flex-col gap-3" style={showPeek ? { marginBottom: peekH } : undefined}>
    <div ref={cardRef} className="glass-card p-5 space-y-3">
      {/* The card holds only the map and its controls (the Stringing canvas,
          idea B, 2026-11-12; Grant: "What if the map card only contains the
          map and the control?"). The list is the peek's swipe-up now, so the
          header's one button is "How to choose a string". */}
      <CardHeader
        compact
        icon="storefront"
        title={t('title')}
        subtitle={mapOn ? t('mapSubtitle') : t('subtitle')}
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
        <div data-map-lesson="" className="flex flex-col gap-3">
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
            // The designed height on one screen with room; a foldable's left
            // page has no peek to clear and keeps it.
            height={aside ? undefined : plotH}
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
          onHeight={(px) => {
            setPeekH(px);
            if (!selected) setPeekRest(px);
          }}
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

      <MapRacketSheet
        open={racketOpen && canChangeRacket}
        onClose={() => setRacketOpen(false)}
        rackets={fits?.rackets ?? []}
        current={fits?.racketId ?? null}
        pending={racketPending}
        failed={racketFailed}
        onPick={chooseRacket}
      />

      {askMounted && activeName.name && (
        <MapRacketAskSheet
          open={askOpen}
          onClose={() => setAskOpen(false)}
          name={activeName.name}
          onAdded={() => {
            // In the bag and in play: read the match for it.
            setAskOpen(false);
            setFitTick((n) => n + 1);
          }}
        />
      )}

      <StringDetailSheet
        fitRacket={fits?.racketId ?? null}
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
            fitRacket={fits?.racketId ?? null}
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
    {fitBanner}
    </div>
  );
}
