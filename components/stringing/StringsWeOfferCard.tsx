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
  bestForOf,
  controlOf,
  durabilityOf,
  isPlottable,
  parseShelf,
  powerOf,
  shelfPrice,
  sortShelf,
  stockColour,
  type Shelf,
  type ShelfEntry,
  type StockBand,
} from '@/lib/stringShelf';
import StringDetailSheet from './StringDetailSheet';
import StringMap, { type MapDot } from './StringMap';
import StockBadge from './StockBadge';
import { formatServicePrice } from '@/lib/stringingRateCard';

const BASE = process.env.NEXT_PUBLIC_BASE_PATH ?? '';
const VIEW_KEY = 'bpm:strings-view';
type View = 'map' | 'list';

function readView(): View {
  try {
    return localStorage.getItem(VIEW_KEY) === 'list' ? 'list' : 'map';
  } catch {
    return 'map';
  }
}

/**
 * The strings the club offers, what each one is like, what a restring with it
 * costs and whether it is on the shelf (docs/design/strings-shelf-spec.md,
 * design 4a — built on docs/plans/string-inventory.md, Grant: "I want people
 * to be able to see the strings I provide with its attributes and qualities
 * etc. Educational stuff").
 *
 * Opens on the MAP: power against durability, one dot per string, so the
 * shelf reads as a set of trade-offs rather than a column of grey rows. The
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
}

/** The pricing doc's two player-facing extras. */
interface OtherPrices {
  ownStringCents: number | null;
  note: string;
}

export default function StringsWeOfferCard({ showEmpty = false }: Props) {
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
  const [view, setView] = useState<View>(() => (typeof window === 'undefined' ? 'map' : readView()));
  /** Picked on the map; persists while the tab is mounted. */
  const [picked, setPicked] = useState<string | null>(null);
  // null = not read yet; 'failed' leaves the rows out rather than guess "Ask".
  const [other, setOther] = useState<OtherPrices | 'failed' | null>(null);

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
  }, [attempt]);

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
  const otherPrices = other && other !== 'failed' ? (
    <div className="flex flex-col gap-2" style={{ padding: '0 var(--space-4)' }}>
      <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'baseline', gap: 'var(--space-3)' }}>
        <span className="fs-md" style={{ color: 'var(--text-secondary)' }}>{t('ownString')}</span>
        <span className="fs-md" style={{ fontFamily: 'var(--font-mono)', fontWeight: 600, color: 'var(--text-primary)' }}>
          {/* "Ask" rather than $0: no fixed price is not the same as free. */}
          {formatServicePrice(other.ownStringCents) ?? t('priceAsk')}
        </span>
      </div>
      {other.note && <p className="fs-sm" style={{ margin: 0, color: 'var(--text-muted)' }}>{other.note}</p>}
    </div>
  ) : null;

  if (empty) {
    return (
      <div className="glass-card p-5 space-y-3">
        <CardHeader icon="storefront" title={t('title')} />
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

  function openRow(e: ShelfEntry) {
    if (!e.item) return;
    if (isPlottable(e)) setPicked(e.label);
    setOpen(e.label);
  }

  const dots: MapDot[] = plotted.map((e) => ({
    key: e.label,
    model: e.item!.model,
    ariaLabel: t('dotLabel', { name: name(e), power: powerOf(e.item)!, durability: durabilityOf(e.item)! }),
    power: powerOf(e.item)!,
    durability: durabilityOf(e.item)!,
    band: bandOf(e.label),
  }));
  // A legend for bands nobody has is a key to nothing.
  const anyBand = plotted.some((e) => bandOf(e.label) !== null);
  const openEntry = entries.find((e) => e.label === open) ?? null;

  const row = (e: ShelfEntry) => {
    const price = priceText(e.label);
    const band = bandOf(e.label);
    const p = powerOf(e.item);
    const d = durabilityOf(e.item);
    const subtitle = !e.item
      ? t('unknown')
      : p !== null && d !== null
        ? t('listLine', { power: p, durability: d })
        : stringSpecLine(e.item, (k) => tSetup(k));
    return (
      <li key={e.label}>
        {/* A string the catalog does not know has no page to open, so its
            row is the DISABLED row — the same chrome at half opacity, which
            is how every row in the app says "not tappable". */}
        <ListRow
          onClick={() => openRow(e)}
          disabled={!e.item}
          title={<span className="fs-md" style={{ color: 'var(--text-primary)' }}>{name(e)}</span>}
          subtitle={subtitle}
          trailing={
            <span style={{ display: 'inline-flex', alignItems: 'center', gap: 'var(--space-3)', flex: 'none' }}>
              {(price || band) && (
                <span style={{ display: 'flex', flexDirection: 'column', alignItems: 'flex-end', gap: 'var(--space-1)' }}>
                  {price && <span className="fs-md" style={{ fontFamily: 'var(--font-mono)', fontWeight: 600, color: 'var(--text-primary)' }}>{price}</span>}
                  {band && <StockBadge band={band} />}
                </span>
              )}
              {e.item && <span className="material-icons icon-sm" aria-hidden="true" style={{ color: 'var(--text-muted)' }}>chevron_right</span>}
            </span>
          }
        />
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
      <CardHeader icon="storefront" title={t('title')} subtitle={t('subtitle')} />
      {status === 'failed' ? (
        <ErrorState message={t('loadError')} action={<button type="button" className="cc-btn cc-btn-ghost" onClick={() => { setStatus('loading'); setAttempt((n) => n + 1); }}>{t('retry')}</button>} />
      ) : (
        <>
          {mapOn && (
            <div role="tablist" aria-label={t('viewLabel')} style={{ display: 'flex', columnGap: 'var(--space-2)' }}>
              {(['map', 'list'] as const).map((v) => {
                const on = view === v;
                return (
                  <button
                    key={v}
                    type="button"
                    role="tab"
                    aria-selected={on}
                    onClick={() => pickView(v)}
                    style={{ minHeight: 44, padding: 0, background: 'transparent', border: 'none', cursor: 'pointer', display: 'flex', alignItems: 'center', color: 'inherit' }}
                  >
                    <span
                      className="fs-base"
                      style={{
                        display: 'inline-flex',
                        alignItems: 'center',
                        height: 34,
                        boxSizing: 'border-box',
                        padding: '0 var(--space-4)',
                        borderRadius: 'var(--radius-pill)',
                        background: on ? 'color-mix(in srgb, var(--accent) 14%, transparent)' : 'var(--inner-card-bg)',
                        border: `1px solid ${on ? 'color-mix(in srgb, var(--accent) 45%, transparent)' : 'var(--inner-card-border)'}`,
                        color: on ? 'var(--accent)' : 'var(--text-secondary)',
                        fontWeight: on ? 600 : 400,
                      }}
                    >
                      {t(v === 'map' ? 'viewMap' : 'viewList')}
                    </span>
                  </button>
                );
              })}
            </div>
          )}

          {showMap ? (
            <>
              <StringMap dots={dots} selected={selected?.label ?? null} onSelect={setPicked} />
              {anyBand && (
                <div className="fs-xs" style={{ display: 'flex', flexWrap: 'wrap', gap: 'var(--space-4)', color: 'var(--text-muted)' }}>
                  {(['in', 'low', 'out'] as const).map((b) => (
                    <span key={b} style={{ display: 'inline-flex', alignItems: 'center', gap: 'var(--space-1)' }}>
                      <span
                        aria-hidden="true"
                        style={{
                          width: 8,
                          height: 8,
                          boxSizing: 'border-box',
                          borderRadius: '50%',
                          background: b === 'out' ? 'transparent' : stockColour(b),
                          border: b === 'out' ? '1.5px solid var(--text-muted)' : 'none',
                        }}
                      />
                      {t(`stock_${b}`)}
                    </span>
                  ))}
                </div>
              )}
              {selected && (
                <div
                  aria-live="polite"
                  style={{
                    padding: 'var(--space-4)',
                    borderRadius: 'var(--radius-lg)',
                    background: 'color-mix(in srgb, var(--accent) 6%, transparent)',
                    border: '1px solid color-mix(in srgb, var(--accent) 45%, transparent)',
                    display: 'flex',
                    flexDirection: 'column',
                    gap: 'var(--space-2)',
                  }}
                >
                  <div style={{ display: 'flex', alignItems: 'baseline', justifyContent: 'space-between', gap: 'var(--space-3)' }}>
                    <span style={{ fontFamily: 'var(--font-display)', fontSize: 'var(--fs-lg)', fontWeight: 600, lineHeight: 1.25, color: 'var(--text-primary)' }}>{name(selected)}</span>
                    {priceText(selected.label) && (
                      <span style={{ fontFamily: 'var(--font-mono)', fontSize: 'var(--fs-lg)', fontWeight: 700, color: 'var(--text-primary)', flex: 'none' }}>{priceText(selected.label)}</span>
                    )}
                  </div>
                  <span className="fs-sm" style={{ fontFamily: 'var(--font-mono)', color: 'var(--text-secondary)' }}>
                    {controlOf(selected.item) !== null
                      ? t('numbers', { power: powerOf(selected.item)!, durability: durabilityOf(selected.item)!, control: controlOf(selected.item)! })
                      : t('listLine', { power: powerOf(selected.item)!, durability: durabilityOf(selected.item)! })}
                  </span>
                  {bestForOf(selected.item) && (
                    <p className="fs-base" style={{ margin: 0, color: 'var(--text-secondary)', lineHeight: 'var(--lh-normal)' }}>{bestForOf(selected.item)}</p>
                  )}
                  <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', gap: 'var(--space-3)' }}>
                    {bandOf(selected.label) ? <StockBadge band={bandOf(selected.label)!} /> : <span />}
                    <button
                      type="button"
                      onClick={() => setOpen(selected.label)}
                      className="fs-base"
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
                  <span className="section-label-muted">{t('notOnMap')}</span>
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
      <button type="button" className="bpm-row-link" aria-expanded={learnOpen} onClick={() => setLearnOpen((v) => !v)}>
        <span className="material-icons icon-sm" aria-hidden="true">school</span>
        <span className="fs-sm">{t('learnTitle')}</span>
        <span className="material-icons icon-sm motion-chevron" aria-hidden="true">expand_more</span>
      </button>
      <Collapse open={learnOpen} spaceAbove="var(--space-3)">
        <div className="flex flex-col gap-3">
          {(['learnGauge', 'learnType', 'learnFeel', 'learnTension'] as const).map((k) => (
            <p key={k} className="fs-base" style={{ margin: 0, color: 'var(--text-secondary)', lineHeight: 'var(--lh-normal)' }}>{t(k)}</p>
          ))}
        </div>
      </Collapse>

      <StringDetailSheet
        item={openEntry?.item ?? null}
        open={openEntry?.item != null}
        onClose={() => setOpen(null)}
        price={openEntry && shelf ? shelfPrice(shelf, openEntry.label) : undefined}
        band={openEntry ? bandOf(openEntry.label) : null}
        clubCount={openEntry ? shelf?.players[openEntry.label] ?? null : null}
      />
    </div>
  );
}
