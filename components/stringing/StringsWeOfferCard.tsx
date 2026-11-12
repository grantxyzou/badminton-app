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

const BASE = process.env.NEXT_PUBLIC_BASE_PATH ?? '';
const VIEW_KEY = 'bpm:strings-view';
/** `--duration-sheet` in globals.css: a sheet's close, waited out before a hand-off. */
const SHEET_CLOSE_MS = 180;
const AXIS_KEY = 'bpm:strings-axis';
type View = 'map' | 'list';

/** The view the member last picked, or null when they never have. */
function readView(): View | null {
  try {
    const v = localStorage.getItem(VIEW_KEY);
    return v === 'list' || v === 'map' ? v : null;
  } catch {
    return null;
  }
}

/** Past this many strings the List opens first: a map of nine or more is a
 *  crowd to pick through, where a list is a read (the canvas, 2026-10-28). */
const MAP_DEFAULT_MAX = 8;

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
  // Read once on mount. The card renders nothing until its data arrives, so
  // there is no server markup for a stored choice to disagree with.
  const [storedView, setView] = useState<View | null>(() => (typeof window === 'undefined' ? null : readView()));
  const [axis, setAxis] = useState<MapAxis>(() => (typeof window === 'undefined' ? 'power' : readAxis()));
  /** Picked on the map; persists while the tab is mounted. */
  const [picked, setPicked] = useState<string | null>(null);
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
  // A remembered choice wins; with none, a long shelf opens on the list.
  const view: View = storedView ?? (entries.length > MAP_DEFAULT_MAX ? 'list' : 'map');
  const plotted = entries.filter(isPlottable);
  const notOnMap = entries.filter((e) => !isPlottable(e));
  // Too few to plot is list-only: a map of two dots says nothing.
  const mapOn = canPlot(plotted.length);
  const showMap = mapOn && view === 'map';
  // The first plotted string still on the shelf, unless one was picked.
  const selected = plotted.find((e) => e.label === picked)
    ?? plotted.find((e) => bandOf(e.label) !== 'out')
    ?? plotted[0]
    ?? null;

  const name = (e: ShelfEntry) => (e.item ? `${e.item.brand} ${e.item.model}` : e.label);
  /** The figure, "Ask", or null when the stringer has set no price. */
  const priceText = (label: string): string | null => {
    if (!shelf) return null;
    const p = shelfPrice(shelf, label);
    return p === undefined ? null : p ?? t('priceAsk');
  };

  function pickView(next: View) {
    setView(next);
    try { localStorage.setItem(VIEW_KEY, next); } catch { /* private mode: the choice lasts the visit */ }
  }

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

  return (
    <div className="glass-card p-5 space-y-3">
      {/* The subtitle names the view; the icon beside it switches (Grant:
          "Map view", "List view"). Nothing to switch with too few to plot. */}
      <CardHeader
        compact
        icon="storefront"
        title={t('title')}
        subtitle={mapOn ? t(view === 'map' ? 'viewNameMap' : 'viewNameList') : t('subtitle')}
        action={mapOn ? (
          <button
            type="button"
            onClick={() => pickView(view === 'map' ? 'list' : 'map')}
            aria-label={t(view === 'map' ? 'switchToList' : 'switchToMap')}
            className="cc-btn cc-btn-ghost"
            style={{ width: 44, height: 44, padding: 0, justifyContent: 'center' }}
          >
            <span className="material-icons icon-md" aria-hidden="true">{view === 'map' ? 'format_list_bulleted' : 'map'}</span>
          </button>
        ) : undefined}
      />
      {catalog.loadError && status !== 'failed' && (
        <p className="fs-sm" role="status" style={{ color: 'var(--text-muted)' }}>{t('catalogError')}</p>
      )}
      {status === 'failed' ? (
        // The retry asks again WITHOUT going back to 'loading': loading returns
        // null, and the reveal slot has already let go of its skeleton, so the
        // register would go blank. The failure stays up until the answer.
        <ErrorState message={t('loadError')} action={<button type="button" className="cc-btn cc-btn-ghost" onClick={() => setAttempt((n) => n + 1)}>{t('retry')}</button>} />
      ) : (
        <>
          {showMap ? (
            <>
              {/* What runs up the side. Pressed buttons, not tabs, for the same
                  reason as the Map/List pair above: nothing behind them is a
                  tabpanel. */}
              {axes.length > 1 && (
                <div style={{ display: 'flex', alignItems: 'center', gap: 'var(--space-4)' }}>
                <span className="fs-sm" style={{ flex: 'none', color: 'var(--text-muted)' }}>{t('compareBy')}</span>
                <div className="segment-control flex" role="group" aria-label={t('axisSwitchLabel')} style={{ flex: 1 }}>
                  {axes.map((a) => (
                    <button
                      key={a}
                      type="button"
                      aria-pressed={shownAxis === a}
                      onClick={() => pickAxis(a)}
                      className={`flex-1 fs-sm rounded-full ${shownAxis === a ? 'segment-tab-active' : 'segment-tab-inactive'}`}
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
              />
              {selected && (() => {
                const content = rowContent(selected, true);
                return (
                  // The list's own row, tinted as picked (a solid accent tint,
                  // never a ring), and the whole card opens the string's page.
                  // The meters and the feel scale live under "Ratings and
                  // specs" there now.
                  <div aria-live="polite">
                    <button
                      type="button"
                      className="cc-mini-card"
                      data-selected="true"
                      onClick={() => setOpen(selected.label)}
                      style={{
                        display: 'flex',
                        alignItems: 'center',
                        gap: 'var(--space-3)',
                        width: '100%',
                        textAlign: 'left',
                        padding: 'var(--space-4)',
                        borderRadius: 'var(--radius-lg)',
                        background: 'color-mix(in srgb, var(--accent) 14%, transparent)',
                        cursor: 'pointer',
                      }}
                    >
                      {content.leading}
                      {content.title}
                      <span className="material-icons icon-sm" aria-hidden="true" style={{ flex: 'none', color: 'var(--text-muted)' }}>chevron_right</span>
                    </button>
                  </div>
                );
              })()}
              {notOnMap.length > 0 && (
                <>
                  {/* A block, so the card's space-y gap applies above it. */}
                  <p className="section-label-muted">{t('notOnMap')}</p>
                  {list(notOnMap)}
                </>
              )}
            </>
          ) : (
            list(entries)
          )}
          {otherPrices}
        </>
      )}

      {/* The lesson: four short paragraphs a member reads once. Behind a row
          link so the shelf stays the card's first job. */}
      {/* Secondary ink: on this card the accent belongs to "See how it plays".
          The label grows so it sits beside its icon rather than floating
          between the icon and the chevron. */}
      <button type="button" className="bpm-row-link" aria-expanded={learnOpen} onClick={() => setLearnOpen((v) => !v)} style={{ color: 'var(--text-secondary)' }}>
        <span className="material-icons icon-sm" aria-hidden="true">school</span>
        <span className="fs-sm" style={{ flex: 1 }}>{t('learnTitle')}</span>
        <span className="material-icons icon-sm motion-chevron" aria-hidden="true">expand_more</span>
      </button>
      <Collapse open={learnOpen} spaceAbove="var(--space-3)">
        <div className="flex flex-col gap-3">
          {(['learnGauge', 'learnType', 'learnFeel', 'learnTension'] as const).map((k) => (
            <p key={k} className="fs-md" style={{ margin: 0, color: 'var(--text-secondary)', lineHeight: 'var(--lh-normal)' }}>{t(k)}</p>
          ))}
        </div>
      </Collapse>

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
          />
        </StringingAside>
      )}
    </div>
  );
}
