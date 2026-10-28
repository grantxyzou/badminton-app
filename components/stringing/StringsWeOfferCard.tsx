'use client';

import { useEffect, useMemo, useState } from 'react';
import { useTranslations } from 'next-intl';
import CardHeader from '@/components/primitives/CardHeader';
import ErrorState from '@/components/primitives/ErrorState';
import EmptyState from '@/components/primitives/EmptyState';
import Collapse from '@/components/primitives/Collapse';
import ListRow from '@/components/primitives/ListRow';
import { useRevealReady } from '@/components/primitives/Reveal';
import { useCatalog } from '@/components/stats/useCatalog';
import { stringSpecLine } from '@/lib/gearSetup';
import { canPlot } from '@/lib/stringMap';
import {
  AXIS_MAX,
  MAP_AXES,
  axisValueOf,
  controlOf,
  durabilityOf,
  feelOf,
  isPlottable,
  parseShelf,
  powerOf,
  shelfPrice,
  sortShelf,
  type MapAxis,
  type Shelf,
  type ShelfEntry,
  type StockBand,
} from '@/lib/stringShelf';
import StringDetailSheet from './StringDetailSheet';
import StringMap, { type MapDot } from './StringMap';
import StockBadge from './StockBadge';
import RatingMeters, { ratingSourceKey } from './RatingMeters';
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
  }));
  const openEntry = entries.find((e) => e.label === open) ?? null;

  const row = (e: ShelfEntry) => {
    const price = priceText(e.label);
    const p = powerOf(e.item);
    const d = durabilityOf(e.item);
    // A failed catalog knows nothing about ANY string, which is not the same as
    // this string being unknown: the card says so once, and the row stays quiet.
    const subtitle = !e.item
      ? (catalog.loadError ? null : t('unknown'))
      : p !== null && d !== null
        ? (controlOf(e.item) !== null
          ? t('listLineControl', { power: p, control: controlOf(e.item)!, durability: d })
          : t('listLine', { power: p, durability: d }))
        : stringSpecLine(e.item, (k) => tSetup(k));
    return (
      <li key={e.label}>
        {/* A string the catalog does not know has no page to open, so its row
            is not a button. It is still on offer, with a price, so it keeps
            the row's surface at full strength: the half-opacity disabled row
            read as "not available". */}
        {(() => {
          const content = {
            title: (
              <span style={{ display: 'inline-flex', alignItems: 'center', flexWrap: 'wrap', gap: 'var(--space-2)' }}>
                <span className="fs-md" style={{ color: 'var(--text-primary)' }}>{e.label}</span>
                {/* The colours on the reel, when the stringer has said. */}
                <ColourDots ids={shelf?.colours[e.label] ?? []} />
              </span>
            ),
            subtitle,
            trailing: (
            <span style={{ display: 'inline-flex', alignItems: 'center', gap: 'var(--space-3)', flex: 'none' }}>
              {/* The price only: stock is on the string's page, and on the
                  map's card when it is low or out. */}
              {price && <span className="fs-md" style={{ fontFamily: 'var(--font-mono)', fontWeight: 600, color: 'var(--text-primary)' }}>{price}</span>}
              {e.item && <span className="material-icons icon-sm" aria-hidden="true" style={{ color: 'var(--text-muted)' }}>chevron_right</span>}
            </span>
            ),
          };
          return e.item ? (
            <ListRow onClick={() => openRow(e)} {...content} />
          ) : (
            <div className="cc-mini-card" style={{ padding: 'var(--space-4)', borderRadius: 'var(--radius-lg)' }}>
              <ListRow {...content} />
            </div>
          );
        })()}
      </li>
    );
  };

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
                onSelect={setPicked}
                yLabel={t(`axisUp_${shownAxis}`)}
                mapLabel={t(`mapLabel_${shownAxis}`)}
                axisName={t(`axisName_${shownAxis}`)}
              />
              {selected && (
                <div
                  aria-live="polite"
                  style={{
                    padding: 'var(--space-4)',
                    borderRadius: 'var(--radius-lg)',
                    background: 'color-mix(in srgb, var(--accent) 10%, transparent)',
                    display: 'flex',
                    flexDirection: 'column',
                    gap: 'var(--space-2)',
                  }}
                >
                  <div style={{ display: 'flex', alignItems: 'baseline', justifyContent: 'space-between', gap: 'var(--space-3)' }}>
                    <span className="fs-lg" style={{ fontWeight: 600, lineHeight: 'var(--lh-snug)', color: 'var(--text-primary)' }}>{selected.label}</span>
                    {priceText(selected.label) && (
                      <span style={{ fontFamily: 'var(--font-mono)', fontSize: 'var(--fs-lg)', fontWeight: 700, color: 'var(--text-primary)', flex: 'none' }}>{priceText(selected.label)}</span>
                    )}
                  </div>
                  {ratingSourceKey(selected.item?.attributes?.ratingSource) && (
                    <span className="fs-sm" style={{ color: 'var(--text-secondary)' }}>
                      {ratingSourceKey(selected.item?.attributes?.ratingSource) === 'brand'
                        ? t('ratedByShort', { brand: selected.item!.brand })
                        : t('ratedCommunityShort')}
                    </span>
                  )}
                  <RatingMeters
                    rows={(['power', 'control', 'durability'] as const).flatMap((key) => {
                      const value = key === 'power' ? powerOf(selected.item) : key === 'control' ? controlOf(selected.item) : durabilityOf(selected.item);
                      return value === null ? [] : [{ key, label: t(key), value }];
                    })}
                  />
                  {feelOf(selected.item) !== null && <FeelScale value={feelOf(selected.item)!} />}
                  <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', gap: 'var(--space-3)' }}>
                    {/* Stock only when it changes the choice (Grant: "In
                        stock, Low on stock, Out of stock" — and "Does user
                        care about stock here?"). */}
                    {bandOf(selected.label) && bandOf(selected.label) !== 'in' ? <StockBadge band={bandOf(selected.label)!} /> : <span />}
                    <button
                      type="button"
                      onClick={() => setOpen(selected.label)}
                      className="fs-sm"
                      style={{ display: 'inline-flex', alignItems: 'center', gap: 'var(--space-1)', minHeight: 44, margin: 'calc(-1 * var(--space-4)) 0', padding: 0, background: 'transparent', border: 'none', color: 'var(--accent)', fontWeight: 600, cursor: 'pointer' }}
                    >
                      {t('seeHow')}
                      <span className="material-icons icon-sm" aria-hidden="true">chevron_right</span>
                    </button>
                  </div>
                </div>
              )}
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
        open={openEntry?.item != null}
        onClose={() => setOpen(null)}
        price={openEntry && shelf ? shelfPrice(shelf, openEntry.label) : undefined}
        band={openEntry ? bandOf(openEntry.label) : null}
        clubCount={openEntry ? shelf?.players[openEntry.label] ?? null : null}
        clubColours={openEntry ? shelf?.colours[openEntry.label] ?? [] : []}
      />
    </div>
  );
}

/**
 * Feel as a position, not a score: soft to hard is a preference, so it is a
 * marker on a scale with its word, never a bar that fills (more is not better).
 */
function FeelScale({ value }: { value: number }) {
  const t = useTranslations('home.stringing.offer');
  const v = Math.max(1, Math.min(5, Math.round(value)));
  const pct = ((v - 1) / 4) * 100;
  return (
    <div style={{ display: 'grid', gridTemplateColumns: 'auto 1fr auto', alignItems: 'center', gap: 'var(--space-3)' }}>
      <span className="section-label" style={{ color: 'var(--text-secondary)' }}>{t('feelLabel')}</span>
      <div aria-hidden="true" style={{ position: 'relative', height: 'var(--space-3)', borderRadius: 'var(--radius-pill)', background: 'var(--inner-card-bg)', boxShadow: 'inset 0 0 0 1px var(--inner-card-border)' }}>
        <span style={{ position: 'absolute', top: 'calc(-1 * var(--space-05))', bottom: 'calc(-1 * var(--space-05))', left: `calc(${pct}% - var(--space-1))`, width: 'var(--space-3)', borderRadius: 'var(--radius-pill)', background: 'var(--text-primary)', transition: 'left var(--duration-normal) var(--ease-out-quart)' }} />
      </div>
      <span className="fs-md" style={{ fontWeight: 600, color: 'var(--text-primary)' }}>{t(`feelWord_${v}`)}</span>
    </div>
  );
}
