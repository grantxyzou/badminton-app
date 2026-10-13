'use client';

import { useLayoutEffect, useMemo, useRef, useState } from 'react';
import { useTranslations } from 'next-intl';
import { dotPositions, placeLabels, DOT_PX } from '@/lib/stringMap';
import { stockColour, type StockBand } from '@/lib/stringShelf';

export interface MapDot {
  key: string;
  /** The model name drawn beside the dot (not the brand — there is no room). */
  model: string;
  ariaLabel: string;
  power: number;
  durability: number;
  band: StockBand | null;
}

const PLOT_H = 220;
const HIT = 44;
// --fs-sm in pixels: the labels are drawn at the token and measured on a
// canvas, which needs the number. Keep the two in step.
const LABEL_PX = 12;
const LABEL_H = Math.ceil(LABEL_PX * 1.2);
/** Until the plot has been measured. The dots are the map's buttons, so they
 *  render from the first frame rather than waiting on layout. */
const NOMINAL_W = 300;
/** Ink at 10%, so the guides hold on cream as on dark. */
const GUIDE = 'color-mix(in srgb, var(--text-primary) 10%, transparent)';

/**
 * The trade-off map on "Strings we offer" (docs/design/strings-shelf-spec.md,
 * design 4a): every plotted string a dot, power up the side and durability
 * along the bottom, coloured by stock. Tapping a dot SELECTS it — the panel
 * under the map follows — and never opens the sheet.
 *
 * The geometry is `lib/stringMap.ts`. This file measures: the plot's width
 * (a ResizeObserver) and each label's width in the card's own font, then
 * re-places labels whenever either, or the selection, changes. A label with
 * nowhere to go is hidden; its dot keeps its accessible name.
 *
 * The List view beside it is the full text equivalent — nothing is said only
 * here.
 */
export default function StringMap({
  dots,
  selected,
  onSelect,
}: {
  dots: MapDot[];
  selected: string | null;
  onSelect: (key: string) => void;
}) {
  const t = useTranslations('home.stringing.offer');
  const plotRef = useRef<HTMLDivElement>(null);
  const buttons = useRef<(HTMLButtonElement | null)[]>([]);
  const [measured, setMeasured] = useState(0);
  const width = measured || NOMINAL_W;
  const [font, setFont] = useState<string | null>(null);

  useLayoutEffect(() => {
    const el = plotRef.current;
    if (!el) return;
    setMeasured(el.clientWidth);
    setFont(getComputedStyle(el).fontFamily);
    if (typeof ResizeObserver === 'undefined') return;
    const ro = new ResizeObserver(() => setMeasured(el.clientWidth));
    ro.observe(el);
    return () => ro.disconnect();
  }, []);

  const selectedIndex = dots.findIndex((d) => d.key === selected);
  const points = useMemo(() => dotPositions(dots, width, PLOT_H), [dots, width]);

  const labels = useMemo(() => {
    if (font === null) return dots.map(() => null);
    const ctx = typeof document !== 'undefined' ? document.createElement('canvas').getContext('2d') : null;
    const widths = dots.map((d, i) => {
      if (!ctx) return d.model.length * LABEL_PX * 0.6;
      ctx.font = `${i === selectedIndex ? 600 : 400} ${LABEL_PX}px ${font}`;
      return Math.ceil(ctx.measureText(d.model).width);
    });
    return placeLabels({ dots: points, widths, labelHeight: LABEL_H, width, height: PLOT_H, selected: selectedIndex >= 0 ? selectedIndex : null });
  }, [dots, points, font, width, selectedIndex]);

  function onKey(e: React.KeyboardEvent, i: number) {
    const step = e.key === 'ArrowRight' ? 1 : e.key === 'ArrowLeft' ? -1 : 0;
    if (!step) return;
    e.preventDefault();
    const next = (i + step + dots.length) % dots.length;
    onSelect(dots[next].key);
    buttons.current[next]?.focus();
  }

  return (
    <div style={{ display: 'grid', gridTemplateColumns: '16px minmax(0, 1fr)', gridTemplateRows: `${PLOT_H}px auto`, columnGap: 'var(--space-2)', rowGap: 'var(--space-2)' }}>
      <span
        aria-hidden="true"
        className="fs-xs"
        style={{ gridRow: 1, gridColumn: 1, writingMode: 'vertical-rl', transform: 'rotate(180deg)', textAlign: 'center', lineHeight: '16px', color: 'var(--text-muted)' }}
      >
        {t('axisPower')}
      </span>
      <div
        ref={plotRef}
        role="group"
        aria-label={t('mapLabel')}
        style={{
          gridRow: 1,
          gridColumn: 2,
          position: 'relative',
          borderRadius: 'var(--radius-lg)',
          background: 'var(--inner-card-bg)',
          border: '1px solid var(--inner-card-border)',
        }}
      >
        {/* Midpoint guides: decoration, not data. */}
        <span aria-hidden="true" style={{ position: 'absolute', left: '50%', top: 8, bottom: 8, borderLeft: `1px dashed ${GUIDE}` }} />
        <span aria-hidden="true" style={{ position: 'absolute', top: '50%', left: 8, right: 8, borderTop: `1px dashed ${GUIDE}` }} />

        {dots.map((d, i) => {
          const p = points[i];
          const isSel = i === selectedIndex;
          const out = d.band === 'out';
          return (
            <button
              key={d.key}
              ref={(el) => { buttons.current[i] = el; }}
              type="button"
              aria-pressed={isSel}
              aria-label={d.ariaLabel}
              onClick={() => onSelect(d.key)}
              onKeyDown={(e) => onKey(e, i)}
              style={{
                position: 'absolute',
                left: p.x - HIT / 2,
                top: p.y - HIT / 2,
                width: HIT,
                height: HIT,
                padding: 0,
                background: 'transparent',
                border: 'none',
                cursor: 'pointer',
                zIndex: isSel ? 2 : 1,
              }}
            >
              <span
                aria-hidden="true"
                style={{
                  position: 'absolute',
                  left: (HIT - DOT_PX) / 2,
                  top: (HIT - DOT_PX) / 2,
                  width: DOT_PX,
                  height: DOT_PX,
                  boxSizing: 'border-box',
                  borderRadius: '50%',
                  background: out ? 'transparent' : d.band ? stockColour(d.band) : 'var(--accent)',
                  border: out ? '2px solid var(--text-muted)' : 'none',
                  // No transition: the ring jumps, which is also what
                  // reduced motion asks for.
                  boxShadow: isSel ? '0 0 0 3px var(--page-bg), 0 0 0 5px var(--text-primary)' : 'none',
                }}
              />
            </button>
          );
        })}

        {labels.map((l, i) => l && (
          <span
            key={dots[i].key}
            aria-hidden="true"
            style={{
              position: 'absolute',
              left: l.x,
              top: l.y,
              width: l.w,
              height: l.h,
              whiteSpace: 'nowrap',
              pointerEvents: 'none',
              fontSize: 'var(--fs-sm)',
              lineHeight: `${LABEL_H}px`,
              fontWeight: i === selectedIndex ? 600 : 400,
              color: i === selectedIndex ? 'var(--text-primary)' : 'var(--text-secondary)',
              zIndex: 3,
            }}
          >
            {dots[i].model}
          </span>
        ))}
      </div>
      <span aria-hidden="true" className="fs-xs" style={{ gridRow: 2, gridColumn: 2, textAlign: 'right', color: 'var(--text-muted)' }}>
        {t('axisDurability')}
      </span>
    </div>
  );
}
