'use client';

import { useEffect, useLayoutEffect, useMemo, useRef, useState } from 'react';
import { useTranslations } from 'next-intl';
import { clusterPoints, dotPositions, placeLabels, ringPositions, CLUSTER_PX, DOT_PX, RING_RADIUS, type Rect } from '@/lib/stringMap';
import type { StockBand } from '@/lib/stringShelf';

export interface MapDot {
  key: string;
  /** The model name drawn beside the dot (not the brand — there is no room). */
  model: string;
  ariaLabel: string;
  /** Up the side: the rating the member picked (power, control or feel). */
  value: number;
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
/** The selected label's pill padding, each side, in px (--space-2). */
const PILL_PAD = 6;
/** The corner hint's distance from the plot's edges, in px (--space-3 = 8). */
const HINT_INSET = 8;
/** How far the selected ring reaches past its dot, in px (the box-shadow below). */
const SELECTED_RING_PX = 5;
/** Ink at 10%, so the guides hold on cream as on dark. */
const GUIDE = 'color-mix(in srgb, var(--text-primary) 10%, transparent)';

/**
 * The trade-off map on "Strings in stock" (docs/design/strings-shelf-spec.md,
 * design 4a; docs/plans/stringing-canvas-redesign.md, Decision 8): every
 * plotted string a dot, durability along the bottom and the member's pick of
 * power, control or feel up the side, both axis titles OUTSIDE the plot.
 * Tapping a dot SELECTS it — the card under the map follows — and never opens
 * the sheet.
 *
 * STRINGS WITH IDENTICAL SCORES SHARE ONE DOT, with their count in it (Grant:
 * "How do we handel large list of maps? they overlapp"). Tapping it zooms in:
 * the plot shows only those strings, fanned round a dashed ring, with
 * "‹ All strings" to come back and a caption saying what they share. Outside
 * the zoom a cluster carries no label unless it holds the selected string,
 * whose label is always shown, as a pill.
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
  yLabel,
  mapLabel,
  axisName,
}: {
  dots: MapDot[];
  selected: string | null;
  onSelect: (key: string) => void;
  /** The side axis's words, e.g. "More control →". */
  yLabel: string;
  /** The plot's accessible name, e.g. "Strings by control and durability". */
  mapLabel: string;
  /** The side axis's name, for the zoom caption ("Power 8 · Durability 7"). */
  axisName: string;
}) {
  const t = useTranslations('home.stringing.offer');
  const plotRef = useRef<HTMLDivElement>(null);
  const hintRef = useRef<HTMLSpanElement>(null);
  const buttons = useRef<(HTMLButtonElement | null)[]>([]);
  const [measured, setMeasured] = useState(0);
  const width = measured || NOMINAL_W;
  const [font, setFont] = useState<string | null>(null);
  const [hint, setHint] = useState<Rect | null>(null);
  /** The cluster the plot is zoomed into, by its point key. */
  const [zoom, setZoom] = useState<string | null>(null);

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

  // The corner hint is space no label may cover.
  useLayoutEffect(() => {
    const el = hintRef.current;
    if (!el) { setHint(null); return; }
    setHint({ x: width - el.offsetWidth - HINT_INSET, y: 0, w: el.offsetWidth + HINT_INSET, h: el.offsetHeight + HINT_INSET });
  }, [width, font, zoom]);

  const clusters = useMemo(() => clusterPoints(dots), [dots]);
  const zoomed = zoom ? clusters.find((c) => c.key === zoom && c.members.length > 1) ?? null : null;
  // A switch of axis regroups the strings; a zoom whose cluster is gone ends.
  useEffect(() => {
    if (zoom && !zoomed) setZoom(null);
  }, [zoom, zoomed]);

  /** What the plot draws: a mark per cluster, or per string inside a zoom. */
  const marks = useMemo(() => {
    if (zoomed) {
      const ring = ringPositions(zoomed.members.length, width, PLOT_H);
      return zoomed.members.map((i, k) => ({ key: dots[i].key, members: [i], point: ring[k] }));
    }
    const centres = dotPositions(clusters.map((c) => dots[c.members[0]]), width, PLOT_H);
    return clusters.map((c, k) => ({ key: c.key, members: c.members, point: centres[k] }));
  }, [zoomed, clusters, dots, width]);

  const selectedMark = marks.findIndex((m) => m.members.some((i) => dots[i].key === selected));
  const textOf = (m: (typeof marks)[number]) => {
    if (m.members.length === 1) return dots[m.members[0]].model;
    const sel = m.members.find((i) => dots[i].key === selected);
    return sel !== undefined ? dots[sel].model : '';
  };

  const labels = useMemo(() => {
    if (font === null) return marks.map(() => null);
    const ctx = typeof document !== 'undefined' ? document.createElement('canvas').getContext('2d') : null;
    const widths = marks.map((m, i) => {
      const text = textOf(m);
      const pad = i === selectedMark ? PILL_PAD * 2 : 0;
      if (!ctx) return text.length * LABEL_PX * 0.6 + pad;
      ctx.font = `${i === selectedMark ? 600 : 400} ${LABEL_PX}px ${font}`;
      return Math.ceil(ctx.measureText(text).width) + pad;
    });
    return placeLabels({
      dots: marks.map((m) => m.point),
      widths,
      labelHeight: LABEL_H,
      width,
      height: PLOT_H,
      selected: selectedMark >= 0 ? selectedMark : null,
      // The selected mark wears its ring, so its label starts past the ring,
      // not past the dot: a pill drawn against the dot cut the ring in half.
      sizes: marks.map((m, i) => (m.members.length > 1 ? CLUSTER_PX : DOT_PX) + (i === selectedMark ? SELECTED_RING_PX * 2 : 0)),
      unlabelled: marks.map((m) => m.members.length > 1),
      reserved: hint ? [hint] : [],
    });
    // eslint-disable-next-line react-hooks/exhaustive-deps -- textOf reads marks/selected, both listed
  }, [marks, font, width, selectedMark, hint, selected]);

  function pick(i: number) {
    const m = marks[i];
    if (m.members.length > 1) {
      // Zoom in, and keep the card on one of these strings so it does not
      // empty while the member picks.
      setZoom(m.key);
      if (!m.members.some((n) => dots[n].key === selected)) onSelect(dots[m.members[0]].key);
      return;
    }
    onSelect(dots[m.members[0]].key);
  }

  function onKey(e: React.KeyboardEvent, i: number) {
    const step = e.key === 'ArrowRight' ? 1 : e.key === 'ArrowLeft' ? -1 : 0;
    if (!step) return;
    e.preventDefault();
    const next = (i + step + marks.length) % marks.length;
    if (marks[next].members.length === 1) onSelect(dots[marks[next].members[0]].key);
    buttons.current[next]?.focus();
  }

  const first = zoomed ? dots[zoomed.members[0]] : null;

  return (
    <div style={{ display: 'grid', gap: 'var(--space-2)' }}>
      {zoomed && (
        <button type="button" onClick={() => setZoom(null)} className="link-quiet link-quiet--flush" style={{ justifySelf: 'start', display: 'inline-flex', alignItems: 'center', gap: 'var(--space-1)' }}>
          <span className="material-icons icon-sm" aria-hidden="true">chevron_left</span>
          {t('allStrings')}
        </button>
      )}
    <div style={{ display: 'grid', gridTemplateColumns: '16px minmax(0, 1fr)', gridTemplateRows: `${PLOT_H}px auto`, columnGap: 'var(--space-2)', rowGap: 'var(--space-2)' }}>
      <span
        aria-hidden="true"
        className="fs-xs"
        style={{ gridRow: 1, gridColumn: 1, writingMode: 'vertical-rl', transform: 'rotate(180deg)', textAlign: 'center', lineHeight: '16px', color: 'var(--text-muted)' }}
      >
        {yLabel}
      </span>
      <div
        ref={plotRef}
        role="group"
        aria-label={zoomed && first ? t('clusterCaption', { count: zoomed.members.length, axis: axisName, value: first.value, durability: first.durability }) : mapLabel}
        style={{
          gridRow: 1,
          gridColumn: 2,
          // No box: the plot is drawn straight on the card's glass (Grant,
          // 2026-10-28), so the dashed cross is the only frame it has.
          position: 'relative',
        }}
      >
        {/* Where to start, in the corner nothing is drawn over. */}
        <span ref={hintRef} aria-hidden="true" className="fs-2xs" style={{ position: 'absolute', top: 'var(--space-2)', right: 'var(--space-3)', color: 'var(--text-muted)', pointerEvents: 'none' }}>
          {t('mapHint')}
        </span>

        {/* Keyed by the zoom, so going in and coming out crossfade
            (.motion-fade): the marks are different marks on each side. */}
        <div key={zoomed?.key ?? 'all'} className="motion-fade" style={{ position: 'absolute', inset: 0 }}>
          {zoomed ? (
            // The ring the strings sit on: decoration, not data.
            <span aria-hidden="true" style={{ position: 'absolute', left: width / 2 - RING_RADIUS, top: PLOT_H / 2 - RING_RADIUS, width: RING_RADIUS * 2, height: RING_RADIUS * 2, borderRadius: '50%', border: `1px dashed ${GUIDE}` }} />
          ) : (
            <>
              {/* Midpoint guides: decoration, not data. */}
              <span aria-hidden="true" style={{ position: 'absolute', left: '50%', top: 0, bottom: 0, borderLeft: `1px dashed ${GUIDE}` }} />
              <span aria-hidden="true" style={{ position: 'absolute', top: '50%', left: 0, right: 0, borderTop: `1px dashed ${GUIDE}` }} />
            </>
          )}

          {marks.map((m, i) => {
            const p = m.point;
            const isSel = i === selectedMark;
            const many = m.members.length > 1;
            const size = many ? CLUSTER_PX : DOT_PX;
            const out = !many && dots[m.members[0]].band === 'out';
            return (
              <button
                key={m.key}
                ref={(el) => { buttons.current[i] = el; }}
                type="button"
                aria-pressed={many ? undefined : isSel}
                aria-label={many ? t('clusterLabel', { count: m.members.length, names: m.members.map((n) => dots[n].model).join(', ') }) : dots[m.members[0]].ariaLabel}
                onClick={() => pick(i)}
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
                    left: (HIT - size) / 2,
                    top: (HIT - size) / 2,
                    width: size,
                    height: size,
                    boxSizing: 'border-box',
                    borderRadius: '50%',
                    display: 'flex',
                    alignItems: 'center',
                    justifyContent: 'center',
                    fontFamily: 'var(--font-mono)',
                    fontSize: 'var(--fs-2xs)',
                    fontWeight: 700,
                    color: 'var(--page-bg)',
                    // One colour for every string: stock is said on the card
                    // under the map, only when it is low or out. An empty ring
                    // still marks a string that cannot be had.
                    background: out ? 'transparent' : 'var(--accent)',
                    border: out ? '2px solid var(--text-muted)' : 'none',
                    // No transition: the ring jumps, which is also what
                    // reduced motion asks for.
                    boxShadow: isSel ? `0 0 0 3px var(--page-bg), 0 0 0 ${SELECTED_RING_PX}px var(--text-primary)` : 'none',
                  }}
                >
                  {many ? m.members.length : null}
                </span>
              </button>
            );
          })}

          {labels.map((l, i) => l && (
            <span
              key={marks[i].key}
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
                textAlign: 'center',
                fontWeight: i === selectedMark ? 600 : 400,
                color: i === selectedMark ? 'var(--text-primary)' : 'var(--text-secondary)',
                // The selected label is a pill, so it reads over a dot or a
                // guide it had to be clamped onto.
                ...(i === selectedMark ? { borderRadius: 'var(--radius-pill)', background: 'var(--page-bg)' } : null),
                zIndex: 3,
              }}
            >
              {textOf(marks[i])}
            </span>
          ))}
        </div>
      </div>
      {/* Starts under the plot's left edge (Grant's edit on the design canvas,
          2026-10-16): with three side axes, the eye reads the bottom axis
          first, from where the plot starts. */}
      <span aria-hidden="true" className="fs-xs" style={{ gridRow: 2, gridColumn: 2, textAlign: 'start', color: 'var(--text-muted)' }}>
        {t('axisDurability')}
      </span>
    </div>
      {zoomed && first && (
        <p className="fs-sm" role="status" style={{ margin: 0, color: 'var(--text-secondary)' }}>
          {t('clusterCaption', { count: zoomed.members.length, axis: axisName, value: first.value, durability: first.durability })}
        </p>
      )}
    </div>
  );
}
