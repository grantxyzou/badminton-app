'use client';

import { useEffect, useState } from 'react';
import { useTranslations } from 'next-intl';
import { BottomSheet, BottomSheetHeader, BottomSheetBody } from '@/components/BottomSheet';
import StatusBadge from '@/components/primitives/StatusBadge';
import ErrorState from '@/components/primitives/ErrorState';
import CardSkeleton from '@/components/primitives/CardSkeleton';
import { catalogSpecRows } from '@/lib/catalogSpecs';
import { cadRange } from '@/lib/catalogPrice';
import { CLUB_GEAR_MIN_COHORT } from '@/lib/clubGear';
import type { StringColourId } from '@/lib/stringPalette';
import { ColourList } from './StringColours';
import RatingMeters, { ratingSourceKey, type MeterRow } from './RatingMeters';
import { stringColours, stringTypeOf, typeBand, stockColour, type StockBand } from '@/lib/stringShelf';
import type { CatalogItem, StringFit } from '@/lib/types';

const BASE = process.env.NEXT_PUBLIC_BASE_PATH ?? '';

/** A chip in the fact row: inner-card fill, radius 8. */
const CHIP: React.CSSProperties = {
  display: 'inline-flex',
  alignItems: 'center',
  gap: 'var(--space-2)',
  padding: 'var(--space-2) var(--space-4)',
  borderRadius: 'var(--radius-sm)',
  background: 'var(--inner-card-bg)',
  border: '1px solid var(--inner-card-border)',
  color: 'var(--text-secondary)',
};

/** A swatch: the 30%-ink inset ring is what lets White show on cream. */
const SWATCH: React.CSSProperties = {
  width: 16,
  height: 16,
  borderRadius: '50%',
  flex: 'none',
  boxShadow: 'inset 0 0 0 1px color-mix(in srgb, var(--text-primary) 30%, transparent)',
};

type FitState = { status: 'loading' } | { status: 'none' } | { status: 'failed' } | { status: 'ready'; fit: StringFit };

/**
 * One string the club offers, explained (Stringing canvas, 2026-10-28;
 * docs/plans/stringing-canvas-redesign.md, Decision 9).
 *
 *   - THE HERO, on the string type's own colour: the name and whether it is on
 *     the shelf; what it is ("Power · Hard feel") and its gauge; the club's
 *     price; then its ratings as meters, with whose ratings they are — the
 *     maker's ("Rated by Yonex") or the community's (`ratingSource`).
 *   - what it is for, then its tension window and level as chips;
 *   - "Based on your racket and skill": the member's own racket, the pairing
 *     engine's verdict and reason (`/api/stringing/fit`), and the tension and
 *     level checks. Absent when the engine cannot say — no check-in, or no
 *     racket the catalog knows — never filled with a guess;
 *   - the maker's colours (or the reel's, when the club has said);
 *   - "Restring with this string", which opens the request with it picked.
 *
 * The older "What this means" and "Specs" sections went: the hero names the
 * type, the feel and the gauge, and the fit section says what they mean for
 * this member's racket — which is the part a member cannot get from the box.
 */
export default function StringDetailSheet({
  item,
  label,
  open,
  onClose,
  price,
  band = null,
  clubCount = null,
  clubColours = [],
  onRestring,
}: {
  item: CatalogItem | null;
  /** The shelf's own name for it, which is what a request sends. */
  label?: string | null;
  open: boolean;
  onClose: () => void;
  /** The club's price: a figure, `null` for "Ask", `undefined` when none is set. */
  price?: string | null;
  band?: StockBand | null;
  clubCount?: number | null;
  /** The colours the club says it has this string in. When set, they replace
   *  the maker's list — which can only say "ask the stringer". */
  clubColours?: StringColourId[];
  /** Opens the request sheet with this string picked. No button without it. */
  onRestring?: (label: string) => void;
}) {
  const t = useTranslations('home.stringing.offer');
  const a = item?.attributes ?? {};
  const num = (k: string) => (typeof a[k] === 'number' ? (a[k] as number) : null);
  const text = (k: string) => (typeof a[k] === 'string' && (a[k] as string).trim() ? (a[k] as string) : null);
  const type = stringTypeOf(item);
  const feel = text('feel')?.toLowerCase();
  const mm = num('gaugeMm');
  const gaugeClass = text('gaugeClass')?.toLowerCase();
  const shopRange = item ? cadRange(item) : null;
  const colours = stringColours(item);
  const hasPrice = price !== undefined;
  const source = ratingSourceKey(a.ratingSource);

  // Power first: it is the axis the map leads with, and the word a player uses.
  const meters: MeterRow[] = [
    ['power', num('repulsion')],
    ['control', num('control')],
    ['durability', num('durability')],
    ['sound', num('hittingSound')],
  ]
    .filter((r): r is [string, number] => r[1] !== null)
    .map(([key, value]) => ({ key, label: t(key), value }));

  const headline = [
    type ? t(`hero_${type}`) : null,
    feel === 'soft' || feel === 'medium' || feel === 'hard' ? t(`heroFeel_${feel}`) : null,
  ].filter(Boolean) as string[];

  // Tension range and level, from the same curated rows as Specs.
  const facts = item ? catalogSpecRows(item).filter((r) => r.labelKey === 'specTension' || r.labelKey === 'specLevel') : [];
  const showCount = clubCount !== null && clubCount >= CLUB_GEAR_MIN_COHORT;

  const [fit, setFit] = useState<FitState>({ status: 'loading' });
  const [fitAttempt, setFitAttempt] = useState(0);
  const itemId = item?.id ?? null;
  useEffect(() => {
    if (!open || !itemId) return;
    let cancelled = false;
    setFit({ status: 'loading' });
    fetch(`${BASE}/api/stringing/fit?id=${encodeURIComponent(itemId)}`, { cache: 'no-store' })
      .then((r) => (r.ok ? r.json() : Promise.reject(new Error(`fit ${r.status}`))))
      .then((d) => {
        if (cancelled) return;
        setFit(d && d.fit ? { status: 'ready', fit: d.fit as StringFit } : { status: 'none' });
      })
      .catch(() => { if (!cancelled) setFit({ status: 'failed' }); });
    return () => { cancelled = true; };
  }, [open, itemId, fitAttempt]);

  return (
    <BottomSheet open={open} onClose={onClose} ariaLabel={item ? `${item.brand} ${item.model}` : t('title')}>
      <BottomSheetHeader onClose={onClose} closeLabel={t('close')}>
        <span style={{ fontSize: 'var(--fs-lg)', fontWeight: 600 }}>{item ? `${item.brand} ${item.model}` : ''}</span>
      </BottomSheetHeader>
      <BottomSheetBody>
        {item && (
          <div style={{ display: 'flex', flexDirection: 'column', gap: 'var(--space-5)' }}>
            <div style={{ borderRadius: 'var(--radius-xl)', padding: 'var(--space-5)', background: typeBand(type), display: 'flex', flexDirection: 'column', gap: 'var(--space-5)' }}>
              <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', gap: 'var(--space-3)' }}>
                <span className="bpm-h3" style={{ minWidth: 0 }}>{item.brand} {item.model}</span>
                {band && (
                  <span className="fs-xs" style={{ flex: 'none', display: 'inline-flex', alignItems: 'center', gap: 'var(--space-1)', height: 'var(--space-7)', padding: '0 var(--space-4)', borderRadius: 'var(--radius-pill)', background: 'color-mix(in srgb, var(--page-bg) 35%, transparent)', color: 'var(--text-secondary)', lineHeight: 1 }}>
                    <span aria-hidden="true" style={{ width: 6, height: 6, borderRadius: '50%', background: stockColour(band) }} />
                    {t(`stock_${band}`)}
                  </span>
                )}
              </div>
              <div style={{ display: 'flex', alignItems: 'flex-end', justifyContent: 'space-between', gap: 'var(--space-4)' }}>
                <div style={{ minWidth: 0 }}>
                  {headline.length > 0 && (
                    <div style={{ fontFamily: 'var(--font-display)', fontSize: 'var(--fs-stat-lg)', fontWeight: 700, lineHeight: 'var(--lh-tight)' }}>
                      {headline.map((h, i) => (
                        <span key={h}>
                          {i > 0 && <span style={{ color: 'var(--text-muted)' }}> · </span>}
                          {h}
                        </span>
                      ))}
                    </div>
                  )}
                  {mm !== null && (
                    <span className="fs-sm" style={{ color: 'var(--text-secondary)' }}>
                      {gaugeClass ? t('gaugeLine', { mm: mm.toFixed(2), class: gaugeClass }) : t('gaugeMm', { mm: mm.toFixed(2) })}
                    </span>
                  )}
                </div>
                {hasPrice && (
                  <div style={{ flex: 'none', display: 'flex', flexDirection: 'column', alignItems: 'flex-end' }}>
                    <span style={{ fontFamily: 'var(--font-mono)', fontSize: 'var(--fs-stat-lg)', fontWeight: 700, lineHeight: 'var(--lh-tight)' }}>{price ?? t('priceAsk')}</span>
                    <span className="fs-sm" style={{ color: 'var(--text-secondary)' }}>{t('restringPrice')}</span>
                  </div>
                )}
              </div>
              {meters.length > 0 && (
                <div style={{ display: 'flex', flexDirection: 'column', gap: 'var(--space-3)', paddingTop: 'var(--space-4)', borderTop: '1px solid color-mix(in srgb, var(--text-primary) 16%, transparent)' }}>
                  <RatingMeters rows={meters} onBand />
                  {source && (
                    <span className="fs-xs" style={{ color: 'var(--text-secondary)' }}>
                      {source === 'brand' ? t('ratedBy', { brand: item.brand }) : t('ratedCommunity')}
                    </span>
                  )}
                </div>
              )}
            </div>

            {text('bestFor') && (
              <p className="fs-md" style={{ margin: 0, color: 'var(--text-primary)', lineHeight: 'var(--lh-normal)' }}>{text('bestFor')}</p>
            )}

            {(facts.length > 0 || showCount) && (
              <div className="fs-sm" style={{ display: 'flex', flexWrap: 'wrap', gap: 'var(--space-2)' }}>
                {facts.map((f) => <span key={f.labelKey} style={CHIP}>{f.value}</span>)}
                {showCount && (
                  <span style={CHIP}>
                    <span className="material-icons icon-xs" aria-hidden="true">group</span>
                    {t('clubCount', { count: clubCount! })}
                  </span>
                )}
              </div>
            )}

            <FitSection state={fit} onRetry={() => setFitAttempt((n) => n + 1)} />

            {clubColours.length > 0 ? (
              <section aria-label={t('coloursOnReel')} className="flex flex-col gap-2">
                <span className="section-label-muted">{t('coloursOnReel')}</span>
                <ColourList ids={clubColours} />
              </section>
            ) : colours.length > 0 && (
              <section aria-label={t('colours')} className="flex flex-col gap-2">
                <span className="section-label-muted">{t('colours')}</span>
                <div className="fs-base" style={{ display: 'flex', flexWrap: 'wrap', gap: 'var(--space-4)' }}>
                  {colours.map((c) => (
                    <span key={c.name} style={{ display: 'inline-flex', alignItems: 'center', gap: 'var(--space-2)', color: 'var(--text-secondary)' }}>
                      <span aria-hidden="true" style={{ ...SWATCH, background: c.fill }} />
                      {c.name}
                    </span>
                  ))}
                </div>
                <p className="fs-xs" style={{ margin: 0, color: 'var(--text-muted)' }}>{t('coloursNote')}</p>
              </section>
            )}

            {/* The shop's typical range only when the club has no price of its
                own — beside a real price it is a second number for no reason. */}
            {!hasPrice && shopRange && (
              <p className="fs-xs" style={{ margin: 0, color: 'var(--text-muted)' }}>
                {t('typicalPrice', { range: shopRange[0] === shopRange[1] ? `$${shopRange[0]}` : `$${shopRange[0]}–${shopRange[1]}` })}
              </p>
            )}

            {onRestring && label && band !== 'out' && (
              <button
                type="button"
                className="cc-btn cc-btn-primary cc-btn-lg"
                style={{ width: '100%' }}
                onClick={() => onRestring(label)}
              >
                {t('restringWith')}
              </button>
            )}
          </div>
        )}
      </BottomSheetBody>
    </BottomSheet>
  );
}

const VERDICT_TONE = { good_match: 'paid', worth_a_look: 'unpaid', not_for_frame: 'waitlist' } as const;

/** "Based on your racket and skill" — or nothing, when the engine cannot say. */
function FitSection({ state, onRetry }: { state: FitState; onRetry: () => void }) {
  const t = useTranslations('home.stringing.offer');
  if (state.status === 'none') return null;
  return (
    <section aria-label={t('fitTitle')} className="flex flex-col gap-2">
      <span className="section-label-muted">{t('fitTitle')}</span>
      {/* The section's place, held while the engine answers: an absent
          section that pops in would push the colours and the button down. */}
      {state.status === 'loading' ? (
        <CardSkeleton height={148} />
      ) : state.status === 'failed' ? (
        <ErrorState
          message={t('fitError')}
          action={<button type="button" className="cc-btn cc-btn-ghost" onClick={onRetry}>{t('retry')}</button>}
        />
      ) : (
        <FitCard fit={state.fit} />
      )}
    </section>
  );
}

function FitCard({ fit }: { fit: StringFit }) {
  const t = useTranslations('home.stringing.offer');
  const overlap = fit.frameTension && fit.stringTension
    ? Math.min(fit.frameTension[1], fit.stringTension[1]) >= Math.max(fit.frameTension[0], fit.stringTension[0])
    : null;
  const levelMatch = fit.stringLevel ? fit.stringLevel.toLowerCase().includes(fit.level.toLowerCase()) : null;
  const span = (r: [number, number]) => `${r[0]}–${r[1]}`;

  const checks: { key: string; ok: boolean | null; label: string; value: string }[] = [];
  if (fit.frameTension && fit.stringTension) {
    checks.push({
      key: 'tension',
      ok: overlap,
      label: t('fitTension'),
      value: t('fitTensionValue', { frame: span(fit.frameTension), string: span(fit.stringTension) }),
    });
  }
  if (fit.stringLevel) {
    checks.push({
      key: 'level',
      ok: levelMatch,
      label: t('fitLevel'),
      value: levelMatch ? t('fitLevelSame', { level: fit.stringLevel }) : t('fitLevelOther', { level: fit.stringLevel, you: t(`level_${fit.level}`) }),
    });
  }

  return (
    <div style={{ display: 'flex', flexDirection: 'column', gap: 'var(--space-4)', padding: 'var(--space-4)', borderRadius: 'var(--radius-lg)', background: 'var(--inner-card-bg)', border: '1px solid var(--inner-card-border)' }}>
      <div style={{ display: 'flex', alignItems: 'center', gap: 'var(--space-4)' }}>
        <span className="material-icons icon-md" aria-hidden="true" style={{ flex: 'none', color: 'var(--text-muted)' }}>sports_tennis</span>
        <span style={{ flex: 1, minWidth: 0 }}>
          <span className="fs-md" style={{ display: 'block', fontWeight: 600 }}>{fit.racket}</span>
          <span className="fs-sm" style={{ display: 'block', color: 'var(--text-muted)' }}>{t('fitFromGear')}</span>
        </span>
        <StatusBadge variant="state" tone={VERDICT_TONE[fit.verdict]}>{t(`fit_${fit.verdict}`)}</StatusBadge>
      </div>
      {fit.reason && (
        <p className="fs-md" style={{ margin: 0, color: 'var(--text-secondary)', lineHeight: 'var(--lh-normal)' }}>{fit.reason}</p>
      )}
      {checks.length > 0 && (
        <div style={{ display: 'flex', flexDirection: 'column', gap: 'var(--space-3)', paddingTop: 'var(--space-4)', borderTop: '1px solid var(--inner-card-border)' }}>
          {checks.map((c) => (
            <div key={c.key} className="fs-base" style={{ display: 'flex', alignItems: 'center', gap: 'var(--space-3)' }}>
              <span
                className="material-icons icon-sm"
                aria-hidden="true"
                style={{ flex: 'none', color: c.ok === false ? 'var(--sev-warn)' : 'var(--accent)' }}
              >
                {c.ok === false ? 'warning' : 'check_circle'}
              </span>
              <span style={{ flex: 1, color: 'var(--text-secondary)' }}>{c.label}</span>
              <span style={{ color: 'var(--text-primary)', textAlign: 'right' }}>{c.value}</span>
            </div>
          ))}
        </div>
      )}
    </div>
  );
}
