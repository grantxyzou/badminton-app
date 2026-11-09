'use client';

import { useEffect, useState } from 'react';
import { useFormatter, useTranslations } from 'next-intl';
import CardSkeleton from '@/components/primitives/CardSkeleton';
import ErrorState from '@/components/primitives/ErrorState';
import EmptyState from '@/components/primitives/EmptyState';
import { BALANCE_EVENT } from '@/lib/balanceRefresh';
import { fmtCents } from './GiftCardsPage';

const BASE = process.env.NEXT_PUBLIC_BASE_PATH ?? '';

/** One month as `GET /api/members/me/payments` sends it, in cents. */
export interface PaymentMonth {
  month: string;
  sessions: number;
  stringing: number;
  other: number;
  nights: number;
  guests: Array<{ name: string; date: string }>;
}

/** Bottom to top, as the bars stack and the legend reads. */
export const SERIES = ['sessions', 'stringing', 'other'] as const;
type Series = (typeof SERIES)[number];

export const monthTotal = (m: PaymentMonth) => m.sessions + m.stringing + m.other;

/** The month the chart opens on: the latest with any payment, else the last. */
export function initialMonth(months: PaymentMonth[]): string | null {
  for (let i = months.length - 1; i >= 0; i--) if (monthTotal(months[i]) > 0) return months[i].month;
  return months.at(-1)?.month ?? null;
}

// Geometry, in the SVG's own units (spec §4: 22 wide, a 150 plot, 2 between
// segments, a 4 radius on the top segment only).
const COL_W = 52;
const BAR_W = 22;
const PLOT_H = 150;
const LABEL_H = 22;
const VALUE_H = 18;
const GAP = 2;
const RADIUS = 4;

/** A bar segment whose top corners are rounded and bottom corners square. */
function topRounded(x: number, y: number, w: number, h: number): string {
  const r = Math.min(RADIUS, h, w / 2);
  return `M${x} ${y + h}V${y + r}Q${x} ${y} ${x + r} ${y}H${x + w - r}Q${x + w} ${y} ${x + w} ${y + r}V${y + h}Z`;
}

/**
 * WHAT YOU'VE PAID (docs/superpowers/specs/2026-11-09-profile-reorg-design.md §4):
 * a stacked bar per month for the last six, in the app's green from dark to
 * light (Sessions, Stringing, Other — never gift cards). Each month is a
 * button; the one chosen shows its total over the bar, and the breakdown
 * under the plot is the chart's table: every figure in words and numbers, so
 * nothing rests on telling three greens apart.
 */
export default function PaymentsChart() {
  const t = useTranslations('profile.balance.chart');
  const format = useFormatter();
  const [months, setMonths] = useState<PaymentMonth[] | null>(null);
  const [loadError, setLoadError] = useState(false);
  const [chosen, setChosen] = useState<string | null>(null);
  const [nonce, setNonce] = useState(0);

  // A payment made from the page above (credit) lands in this month: re-read
  // quietly, keeping the chart on screen while it does.
  useEffect(() => {
    const onChanged = () => setNonce((n) => n + 1);
    window.addEventListener(BALANCE_EVENT, onChanged);
    return () => window.removeEventListener(BALANCE_EVENT, onChanged);
  }, []);

  useEffect(() => {
    let live = true;
    fetch(`${BASE}/api/members/me/payments?months=6`, { cache: 'no-store' })
      .then((r) => {
        if (!r.ok) throw new Error(String(r.status));
        return r.json() as Promise<{ months: PaymentMonth[] }>;
      })
      .then((d) => {
        if (!live) return;
        setMonths(d.months);
        setLoadError(false);
        setChosen((c) => c ?? initialMonth(d.months));
      })
      .catch(() => {
        if (live) setLoadError(true);
      });
    return () => {
      live = false;
    };
  }, [nonce]);

  const monthName = (m: string, style: 'short' | 'long') =>
    format.dateTime(new Date(`${m}-15T12:00:00Z`), { month: style, timeZone: 'UTC' });
  const day = (iso: string) => format.dateTime(new Date(iso), { month: 'short', day: 'numeric', timeZone: 'America/Vancouver' });

  if (loadError) {
    return (
      <div className="glass-card p-5">
        <ErrorState message={t('loadError')} />
      </div>
    );
  }
  if (!months) return <CardSkeleton height={300} />;

  const total = months.reduce((s, m) => s + monthTotal(m), 0);
  if (total === 0) {
    return (
      <div className="glass-card p-5 flex flex-col gap-3">
        <p className="fs-base" style={{ margin: '0', color: 'var(--text-muted)' }}>{t('window')}</p>
        <EmptyState>{t('empty')}</EmptyState>
      </div>
    );
  }

  const present = SERIES.filter((s) => months.some((m) => m[s] > 0));
  const max = Math.max(...months.map(monthTotal));
  const width = COL_W * months.length;
  const height = VALUE_H + PLOT_H + LABEL_H;
  const selected = months.find((m) => m.month === chosen) ?? null;

  const seriesLabel = (s: Series, m: PaymentMonth) => {
    if (s === 'sessions') return t('sessionsNights', { count: m.nights });
    if (s === 'stringing') return t('series.stringing');
    const names = m.guests.map((g) => (g.date ? `${g.name}, ${day(g.date)}` : g.name));
    return names.length > 0 ? t('guests', { names: names.join(' · ') }) : t('series.other');
  };
  const spoken = (m: PaymentMonth) => {
    const parts = present.filter((s) => m[s] > 0).map((s) => `${t(`series.${s}`)} ${fmtCents(m[s])}`);
    return parts.length > 0
      ? t('monthLabel', { month: monthName(m.month, 'long'), total: fmtCents(monthTotal(m)), parts: parts.join(', ') })
      : t('monthLabelNone', { month: monthName(m.month, 'long') });
  };

  return (
    <div className="glass-card p-5 flex flex-col gap-4" data-payments-chart>
      <div style={{ display: 'flex', alignItems: 'baseline', justifyContent: 'space-between', gap: 'var(--space-3)' }}>
        <span className="fs-base" style={{ color: 'var(--text-muted)' }}>{t('window')}</span>
        <span className="money-row__amount">{fmtCents(total)}</span>
      </div>

      <ul className="pay-chart__legend" aria-label={t('legend')}>
        {present.map((s) => (
          <li key={s}>
            <span className={`pay-chart__swatch pay-chart__swatch--${s}`} aria-hidden="true" />
            {t(`series.${s}`)}
          </li>
        ))}
      </ul>

      <div className="pay-chart" style={{ position: 'relative' }}>
        <svg
          viewBox={`0 0 ${width} ${height}`}
          role="img"
          aria-label={months.map(spoken).join('. ')}
          className="pay-chart__svg"
        >
          {months.map((m, i) => {
            const x = i * COL_W + (COL_W - BAR_W) / 2;
            const on = m.month === chosen;
            const segs = SERIES.filter((s) => m[s] > 0);
            let y = VALUE_H + PLOT_H;
            const barTop = VALUE_H + PLOT_H - (monthTotal(m) / max) * PLOT_H;
            return (
              <g key={m.month}>
                {on && <rect className="pay-chart__col--on" x={i * COL_W + 2} y={0} width={COL_W - 4} height={height} rx={RADIUS * 2} />}
                {segs.map((s, k) => {
                  const h = (m[s] / max) * PLOT_H;
                  y -= h;
                  const top = k === segs.length - 1;
                  // The surface gap between stacked fills (2 units), taken
                  // from the segment's own height so the total stays true.
                  const drawH = Math.max(h - (k > 0 ? GAP : 0), 1);
                  return top ? (
                    <path key={s} className={`pay-chart__seg--${s}`} d={topRounded(x, y, BAR_W, drawH)} />
                  ) : (
                    <rect key={s} className={`pay-chart__seg--${s}`} x={x} y={y} width={BAR_W} height={drawH} />
                  );
                })}
                {on && monthTotal(m) > 0 && (
                  <text className="pay-chart__value" x={x + BAR_W / 2} y={barTop - 6} textAnchor="middle">
                    {fmtCents(monthTotal(m))}
                  </text>
                )}
                <text
                  className={on ? 'pay-chart__month pay-chart__month--on' : 'pay-chart__month'}
                  x={i * COL_W + COL_W / 2}
                  y={height - 6}
                  textAnchor="middle"
                >
                  {monthName(m.month, 'short')}
                </text>
              </g>
            );
          })}
          <line className="pay-chart__baseline" x1={0} x2={width} y1={VALUE_H + PLOT_H + 0.5} y2={VALUE_H + PLOT_H + 0.5} />
        </svg>
        {/* The tap targets: a full column each, over the drawing. */}
        <div className="pay-chart__hits">
          {months.map((m) => (
            <button
              key={m.month}
              type="button"
              className="pay-chart__hit"
              aria-pressed={m.month === chosen}
              aria-label={spoken(m)}
              onClick={() => setChosen(m.month)}
            />
          ))}
        </div>
      </div>

      {selected && (
        <div key={selected.month} className="pay-chart__breakdown motion-fade">
          <div style={{ display: 'flex', justifyContent: 'space-between', gap: 'var(--space-3)' }}>
            <span className="fs-md" style={{ fontWeight: 600, color: 'var(--text-primary)' }}>{monthName(selected.month, 'long')}</span>
            <span className="money-row__amount" style={{ fontWeight: 600 }}>{fmtCents(monthTotal(selected))}</span>
          </div>
          {monthTotal(selected) === 0 ? (
            <p className="fs-sm" style={{ margin: '0', color: 'var(--text-muted)' }}>{t('nothingThisMonth')}</p>
          ) : (
            present
              .filter((s) => selected[s] > 0)
              .map((s) => (
                <div key={s} className="pay-chart__line">
                  <span className={`pay-chart__swatch pay-chart__swatch--${s}`} aria-hidden="true" />
                  <span style={{ flex: 1, minWidth: 0 }}>{seriesLabel(s, selected)}</span>
                  <span className="money-row__amount">{fmtCents(selected[s])}</span>
                </div>
              ))
          )}
        </div>
      )}
    </div>
  );
}
