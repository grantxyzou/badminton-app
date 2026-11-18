'use client';

/**
 * The bench's earnings (docs/plans/stringing-earnings.md; canvas boards
 * EarnRow, EarnPiles, EarnKept and EarnKeptOpen, Grant 2026-11-17).
 *
 * `EarningsLine` is the one line at the top of Stringing jobs; the page is
 * where it opens. Admin-only like the bench it sits on: the read is
 * `GET /api/stringing/earnings`, which answers an admin cookie only.
 *
 * The charts are drawn from the dataviz rules: one categorical order
 * (Collected, Owed, Not invoiced — `--earn-*`, validated on both grounds),
 * 2px surface gaps between fills, values in text ink beside a coloured key,
 * and the figures that do not fit a segment moved to its legend.
 */
import { useMemo, useState } from 'react';
import { useLocale, useTranslations } from 'next-intl';
import { fmtMoney } from '@/lib/fmt';
import ErrorState from '@/components/primitives/ErrorState';
import CardSkeleton from '@/components/primitives/CardSkeleton';
import { ShelfPack } from '@/components/stringing/StringPackImage';
import type { EarningsMonth, EarningsString, EarningsSummary, WaitingState } from '@/lib/stringingEarnings';

export type EarningsData = EarningsSummary & { now: string };

const money = (cents: number) => fmtMoney(Math.round(cents) / 100);
const DAY_MS = 86_400_000;
/** A figure prints inside its segment only when the segment is this wide. */
const INSIDE_SHARE = 0.14;

function monthName(month: string, locale: string, style: 'long' | 'short'): string {
  return new Intl.DateTimeFormat(locale, { month: style, timeZone: 'UTC' }).format(new Date(`${month}-15T12:00:00Z`));
}

/** The y-axis top: the smallest of 1, 2, 3, 5 × 10ⁿ dollars, times three ticks, that holds `max`. */
export function axisTop(maxCents: number): number {
  // Never under $30, so an empty window still has a readable axis.
  const max = Math.max(30, maxCents / 100);
  const raw = max / 3;
  const mag = 10 ** Math.floor(Math.log10(raw));
  const step = [1, 2, 3, 5, 10].map((m) => m * mag).find((s) => s >= raw) ?? 10 * mag;
  return step * 3 * 100;
}

type PileKey = 'collected' | 'owed' | 'unbilled';
const PILES: Array<{ key: PileKey; field: 'collectedCents' | 'owedCents' | 'notInvoicedCents'; name: 'pileCollected' | 'pileOwed' | 'pileUnbilled' }> = [
  { key: 'collected', field: 'collectedCents', name: 'pileCollected' },
  { key: 'owed', field: 'owedCents', name: 'pileOwed' },
  { key: 'unbilled', field: 'notInvoicedCents', name: 'pileUnbilled' },
];

function useMonthLabel() {
  const t = useTranslations('admin.stringing.earnings');
  const locale = useLocale();
  return (month: string, current: boolean) => (current ? t('soFar', { month: monthName(month, locale, 'long') }) : monthName(month, locale, 'long'));
}

// ── The line on the bench ──────────────────────────────────────────────────

export function EarningsLine({ data, error, onOpen, onRetry }: {
  data: EarningsData | null;
  error: boolean;
  onOpen: () => void;
  onRetry: () => void;
}) {
  const t = useTranslations('admin.stringing.earnings');
  const tBench = useTranslations('admin.stringing');
  const label = useMonthLabel();
  if (error) {
    return (
      <div className="glass-card">
        <ErrorState
          message={t('lineError')}
          action={<button type="button" className="cc-btn cc-btn-ghost" onClick={onRetry}>{tBench('retry')}</button>}
        />
      </div>
    );
  }
  if (!data) return <CardSkeleton height={84} />;
  const m = data.months[data.months.length - 1];
  const month = label(m.month, true);
  return (
    <button
      type="button"
      onClick={onOpen}
      className="glass-card earn-line"
      aria-label={t('lineAria', { month, collected: money(m.collectedCents), owed: money(m.owedCents), unbilled: money(m.notInvoicedCents) })}
      data-testid="earnings-line"
    >
      <span className="earn-line-body">
        <span className="section-label">{month}</span>
        {m.jobs === 0 ? (
          <span className="fs-md" style={{ color: 'var(--text-secondary)' }}>{t('lineEmpty')}</span>
        ) : (
          <>
            <span style={{ display: 'flex', alignItems: 'baseline', gap: 'var(--space-2)' }}>
              <span className="earn-val">{money(m.collectedCents)}</span>
              <span className="fs-sm" style={{ color: 'var(--text-muted)' }}>{t('collected')}</span>
            </span>
            <span className="fs-sm" style={{ display: 'flex', flexWrap: 'wrap', gap: 'var(--space-3)', color: 'var(--text-muted)' }}>
              <span><b className="earn-figure" style={{ color: 'var(--text-primary)' }}>{money(m.owedCents)}</b> {t('owed')}</span>
              {m.notInvoicedCents > 0 && (
                <span className="earn-warn"><b className="earn-figure">{money(m.notInvoicedCents)}</b> {t('notInvoiced')}</span>
              )}
            </span>
          </>
        )}
      </span>
      <span className="material-icons icon-md" aria-hidden="true" style={{ color: 'var(--text-muted)' }}>chevron_right</span>
    </button>
  );
}

// ── The page ───────────────────────────────────────────────────────────────

export default function StringingEarningsPage({ data, error, onRetry }: { data: EarningsData | null; error: boolean; onRetry: () => void }) {
  const t = useTranslations('admin.stringing.earnings');
  const tBench = useTranslations('admin.stringing');
  const [picked, setPicked] = useState<number | null>(null);
  if (error) {
    return (
      <div className="glass-card">
        <ErrorState
          message={t('loadError')}
          action={<button type="button" className="cc-btn cc-btn-ghost" onClick={onRetry}>{tBench('retry')}</button>}
        />
      </div>
    );
  }
  if (!data) return (<><CardSkeleton height={110} /><CardSkeleton height={120} /><CardSkeleton height={220} /></>);
  const last = data.months.length - 1;
  const i = picked ?? last;
  const cur = data.months[i];
  const prev = i > 0 ? data.months[i - 1] : null;
  return (
    <>
      <Tiles cur={cur} prev={prev} />
      <WhereItIs cur={cur} />
      <ByMonth months={data.months} selected={i} last={last} onPick={setPicked} />
      <Waiting cur={cur} now={data.now} />
      <AfterCost cur={cur} />
      <ByString cur={cur} strings={data.strings} />
    </>
  );
}

function Tiles({ cur, prev }: { cur: EarningsMonth; prev: EarningsMonth | null }) {
  const t = useTranslations('admin.stringing.earnings');
  const locale = useLocale();
  const kept = cur.workCents - cur.stringCostCents;
  const delta = prev ? cur.workCents - prev.workCents : null;
  return (
    <div className="earn-tiles">
      <div className="glass-card earn-tile">
        <span className="fs-sm" style={{ color: 'var(--text-muted)' }}>{t('workDone')}</span>
        <span className="earn-val">{money(cur.workCents)}</span>
        {delta !== null && prev ? (
          <span className={`fs-sm ${delta >= 0 ? 'earn-up' : 'earn-down'}`}>
            <span aria-hidden="true">{delta >= 0 ? '▲' : '▼'} </span>
            {t('vs', { amount: money(Math.abs(delta)), month: monthName(prev.month, locale, 'short') })}
          </span>
        ) : (
          <span className="fs-sm" style={{ color: 'var(--text-muted)' }}>{t('jobs', { n: cur.jobs })}</span>
        )}
      </div>
      <div className="glass-card earn-tile">
        <span className="fs-sm" style={{ color: 'var(--text-muted)' }}>{t('afterCost')}</span>
        <span className="earn-val">{money(kept)}</span>
        <span className="fs-sm" style={{ color: 'var(--text-muted)' }}>
          {cur.workCents > 0 ? t('margin', { pct: Math.round((kept / cur.workCents) * 100) }) : t('jobs', { n: cur.jobs })}
        </span>
      </div>
    </div>
  );
}

function WhereItIs({ cur }: { cur: EarningsMonth }) {
  const t = useTranslations('admin.stringing.earnings');
  const total = cur.workCents;
  const parts = PILES.filter((p) => cur[p.field] > 0).map((p) => {
    const share = cur[p.field] / total;
    return { ...p, amount: money(cur[p.field]), share, inside: share >= INSIDE_SHARE };
  });
  return (
    <section className="glass-card p-5 flex flex-col gap-3" aria-label={t('whereTitle')}>
      <h3 className="section-label" style={{ margin: 0 }}>{t('whereTitle')}</h3>
      {parts.length === 0 ? (
        <p className="fs-base" style={{ margin: 0, color: 'var(--text-muted)' }}>{t('nothing')}</p>
      ) : (
        <>
          <div
            className="earn-bar"
            role="img"
            aria-label={t('barAria', { parts: parts.map((p) => `${t(p.name)} ${p.amount}`).join(', '), total: money(total) })}
          >
            {parts.map((p) => (
              <span key={p.key} className={`earn-seg earn-fill-${p.key}`} style={{ width: `${p.share * 100}%` }}>
                {p.inside ? p.amount : ''}
              </span>
            ))}
          </div>
          <div className="earn-legend">
            {parts.map((p) => (
              <span key={p.key} className="earn-key">
                <span className={`earn-swatch earn-fill-${p.key}`} aria-hidden="true" />
                {t(p.name)}
                {!p.inside && <b className="earn-figure">{p.amount}</b>}
              </span>
            ))}
          </div>
        </>
      )}
    </section>
  );
}

function ByMonth({ months, selected, last, onPick }: { months: EarningsMonth[]; selected: number; last: number; onPick: (i: number) => void }) {
  const t = useTranslations('admin.stringing.earnings');
  const locale = useLocale();
  const label = useMonthLabel();
  const top = axisTop(Math.max(...months.map((m) => m.workCents)));
  const ticks = [3, 2, 1, 0].map((k) => String(Math.round((top / 100) * (k / 3))));
  return (
    <section className="glass-card p-5 flex flex-col gap-3" aria-label={t('monthsTitle')}>
      <h3 className="section-label" style={{ margin: 0 }}>{t('monthsTitle')}</h3>
      <div className="earn-cols">
        <div className="earn-ticks" aria-hidden="true">
          {ticks.map((tick) => <span key={tick}>{tick}</span>)}
        </div>
        <div className="earn-plot">
          <div className="earn-grid" aria-hidden="true"><span /><span /><span /><span /></div>
          <div className="earn-col-row">
            {months.map((m, j) => {
              const on = j === selected;
              // Top of the stack first: Not invoiced, Owed, Collected on the baseline.
              const stack = [...PILES].reverse().filter((p) => m[p.field] > 0);
              return (
                <button
                  key={m.month}
                  type="button"
                  className="earn-col"
                  aria-pressed={on}
                  aria-label={t('colAria', {
                    month: label(m.month, j === last), total: money(m.workCents),
                    collected: money(m.collectedCents), owed: money(m.owedCents), unbilled: money(m.notInvoicedCents),
                  })}
                  onClick={() => onPick(j)}
                >
                  <span className="earn-col-total">{money(m.workCents)}</span>
                  <span className="earn-col-stack" style={{ height: `calc(128rem / 16 * ${m.workCents / top})` }}>
                    {stack.map((p) => (
                      <span key={p.key} className={on ? `earn-fill-${p.key}` : 'earn-fill-other'} style={{ flex: m[p.field] }} />
                    ))}
                  </span>
                  <span className="earn-col-month">{monthName(m.month, locale, 'short')}</span>
                </button>
              );
            })}
          </div>
        </div>
      </div>
    </section>
  );
}

const WAIT_FILL: Record<WaitingState, PileKey> = { invoiced: 'owed', owed: 'owed', not_invoiced: 'unbilled', not_ready: 'unbilled' };

function Waiting({ cur, now }: { cur: EarningsMonth; now: string }) {
  const t = useTranslations('admin.stringing.earnings');
  if (cur.waiting.length === 0) return null;
  const nowMs = Date.parse(now);
  const days = (since: string | null) => (since ? Math.max(0, Math.floor((nowMs - Date.parse(since)) / DAY_MS)) : 0);
  const stateOf = (state: WaitingState, since: string | null) => {
    const n = days(since);
    if (state === 'invoiced') return t('waitInvoiced', { days: t('days', { n }) });
    if (state === 'owed') return t('waitOwed', { days: t('days', { n }) });
    if (state === 'not_invoiced') return t('waitNotInvoiced', { ago: t('ago', { n }) });
    return t('waitNotReady');
  };
  return (
    <section className="glass-card p-5 flex flex-col gap-1" aria-label={t('waitingTitle')}>
      <h3 className="section-label" style={{ margin: 0, paddingBottom: 'var(--space-2)' }}>{t('waitingTitle')}</h3>
      {cur.waiting.map((w) => (
        <div key={w.jobId} className="earn-wait">
          <span className={`earn-swatch earn-fill-${WAIT_FILL[w.state]}`} aria-hidden="true" />
          <span style={{ flex: 1, minWidth: 0, display: 'flex', flexDirection: 'column', gap: 'var(--space-05)' }}>
            <span className="fs-md" style={{ fontWeight: 600 }}>{w.who}</span>
            <span className="fs-sm" style={{ color: 'var(--text-muted)' }}>{stateOf(w.state, w.since)}</span>
          </span>
          <span className="earn-figure fs-md">{money(w.amountCents)}</span>
        </div>
      ))}
    </section>
  );
}

function AfterCost({ cur }: { cur: EarningsMonth }) {
  const t = useTranslations('admin.stringing.earnings');
  if (cur.workCents === 0) return null;
  const kept = cur.workCents - cur.stringCostCents;
  const toCollect = cur.owedCents + cur.notInvoicedCents;
  return (
    <section className="glass-card p-5 flex flex-col gap-3" aria-label={t('afterCost')}>
      <h3 className="section-label" style={{ margin: 0 }}>{t('afterCost')}</h3>
      <div
        className="earn-fall"
        role="img"
        aria-label={t('fallAria', { work: money(cur.workCents), cost: money(cur.stringCostCents), kept: money(kept) })}
      >
        <span className="earn-fall-col">
          <span className="earn-figure fs-sm">{money(cur.workCents)}</span>
          <span className="earn-fall-bar earn-fall-work" style={{ height: 'calc(100% - var(--space-6))' }} />
        </span>
        <span className="earn-fall-col">
          <span className="earn-figure fs-sm">−{money(cur.stringCostCents)}</span>
          {/* The decrease floats at the height it comes off: its bottom is
              where the kept bar's top is. */}
          <span className="earn-fall-bar earn-fall-bar--float earn-fall-cost" style={{ height: `calc((100% - var(--space-6)) * ${cur.stringCostCents / cur.workCents})` }} />
          <span aria-hidden="true" style={{ height: `calc((100% - var(--space-6)) * ${Math.max(0, kept) / cur.workCents})`, flex: 'none' }} />
        </span>
        <span className="earn-fall-col">
          <span className="earn-figure fs-sm">{money(kept)}</span>
          <span className="earn-fall-bar earn-fall-kept" style={{ height: `calc((100% - var(--space-6)) * ${Math.max(0, kept) / cur.workCents})` }} />
        </span>
      </div>
      <div className="earn-fall-labels fs-sm" style={{ color: 'var(--text-muted)' }}>
        <span>{t('workDone')}</span>
        <span>{t('fallString', { n: cur.sets })}</span>
        <span>{t('afterCost')}</span>
      </div>
      {toCollect > 0 && <p className="fs-sm earn-warn" style={{ margin: 0 }}>{t('toCollect', { amount: money(toCollect) })}</p>}
    </section>
  );
}

interface StringRow {
  info: EarningsString;
  jobs: number;
  sets: number;
  workCents: number;
  costCents: number;
  /** What one job fetched here, to the dollar: the stepper's starting point. */
  baseCents: number | null;
}

function ByString({ cur, strings }: { cur: EarningsMonth; strings: EarningsString[] }) {
  const t = useTranslations('admin.stringing.earnings');
  const [open, setOpen] = useState<string | null>(null);
  // A what-if per string, in cents. Never saved: leaving the page forgets it.
  const [sim, setSim] = useState<Record<string, number>>({});
  const rows = useMemo<StringRow[]>(() => {
    const month = new Map(cur.strings.map((s) => [s.key, s]));
    return strings
      // Every shelf string, strung this month or not; own string and a string
      // the shelf does not list only when they were used.
      .filter((s) => s.key.startsWith('s:') || month.has(s.key))
      .map((info) => {
        const m = month.get(info.key);
        const jobs = m?.jobs ?? 0;
        const workCents = m?.workCents ?? 0;
        return {
          info, jobs, sets: m?.sets ?? 0, workCents, costCents: m?.costCents ?? 0,
          baseCents: jobs > 0 && workCents > 0 ? Math.round(workCents / jobs / 100) * 100 : null,
        };
      });
  }, [cur, strings]);
  if (rows.length === 0) return null;
  const priceOf = (r: StringRow) => sim[r.info.key] ?? r.baseCents;
  const netOf = (r: StringRow) => {
    const real = r.workCents - r.costCents;
    const p = priceOf(r);
    return p !== null && r.baseCents !== null ? real + r.jobs * (p - r.baseCents) : real;
  };
  const sorted = [...rows].sort((a, b) => netOf(b) - netOf(a));
  const max = Math.max(1, ...sorted.map(netOf));
  const nameOf = (r: StringRow) => (r.info.own ? t('ownString') : r.info.label);
  return (
    <section className="glass-card p-5 flex flex-col gap-2" aria-label={t('byString')}>
      <h3 className="section-label" style={{ margin: 0, paddingBottom: 'var(--space-2)' }}>{t('byString')}</h3>
      {sorted.map((r) => {
        const key = r.info.key;
        const isOpen = open === key;
        const net = netOf(r);
        const price = priceOf(r);
        const simulated = price !== null && r.baseCents !== null && price !== r.baseCents;
        const used = r.jobs === 0 ? t('notStrung') : r.info.own ? t('ownJobs', { n: r.jobs }) : t('setsUsed', { n: r.sets });
        const name = nameOf(r);
        return (
          <div key={key} className="earn-string" data-open={isOpen} data-testid="earn-string">
            <button
              type="button"
              className="earn-string-head"
              aria-expanded={isOpen}
              aria-label={(isOpen ? t('rowHide', { name, net: money(net) }) : t('rowShow', { name, net: money(net) }))}
              onClick={() => setOpen(isOpen ? null : key)}
            >
              {r.info.own ? (
                <span className="string-pack-img string-pack-row earn-own" aria-hidden="true">
                  <span className="material-icons icon-sm">person</span>
                </span>
              ) : (
                <ShelfPack catalogId={r.info.catalogId} reserve />
              )}
              <span className="earn-string-main">
                <span className="earn-string-name">
                  <span className="fs-md">{name}</span>
                  <span className={`fs-sm ${r.jobs === 0 ? 'earn-warn' : ''}`} style={r.jobs === 0 ? undefined : { color: 'var(--text-muted)' }}>{used}</span>
                </span>
                <span className="earn-string-bar">
                  <span className="earn-string-fill" aria-hidden="true" style={{ width: `${(Math.max(0, net) / max) * 78}%` }} />
                  <span className={`earn-figure fs-base ${net < 0 ? 'earn-down' : ''}`}>{money(net)}</span>
                  {simulated && <span className="fs-sm earn-warn">{t('simulated')}</span>}
                </span>
              </span>
              <span className="earn-eye" data-open={isOpen} aria-hidden="true">
                <span className="material-icons icon-md">visibility</span>
              </span>
            </button>
            {isOpen && (
              <div className="earn-kv motion-fade">
                <span>{t('kString')}</span>
                <span>
                  {r.info.own ? t('playersOwn')
                    : !r.info.key.startsWith('s:') ? t('notOnShelf')
                    : r.info.costPerSetCents === null ? t('noPurchase')
                    : t('perSet', { amount: money(r.info.costPerSetCents) })}
                </span>
                {price !== null && (
                  <>
                    <span>{t('kSimulate')}</span>
                    <span className="earn-step">
                      <button type="button" aria-label={t('less')} onClick={() => setSim((s) => ({ ...s, [key]: Math.max(100, price - 100) }))}>−</button>
                      <span className="earn-figure" style={{ minWidth: 'var(--space-8)', textAlign: 'center' }}>{money(price)}</span>
                      <button type="button" aria-label={t('more')} onClick={() => setSim((s) => ({ ...s, [key]: price + 100 }))}>+</button>
                    </span>
                  </>
                )}
                {!r.info.own && r.info.purchasedCostCents > 0 && (
                  <>
                    <span>{t('kPayback')}</span>
                    <span>{payback(r.info, price, t)}</span>
                  </>
                )}
                {r.info.remainingSets !== null && (
                  <>
                    <span>{t('kLeft')}</span>
                    <span>{t('setsLeft', { n: Math.max(0, r.info.remainingSets) })}</span>
                  </>
                )}
              </div>
            )}
          </div>
        );
      })}
    </section>
  );
}

/** What was bought for a string against all the work ever done with it. */
function payback(info: EarningsString, priceCents: number | null, t: ReturnType<typeof useTranslations>): string {
  const gap = info.purchasedCostCents - info.allTimeWorkCents;
  if (gap <= 0) return t('paidOff');
  if (!priceCents) return '—';
  return t('moreJobs', { n: Math.ceil(gap / priceCents) });
}
