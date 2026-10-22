'use client';

import { useTranslations } from 'next-intl';
import { BottomSheet, BottomSheetHeader, BottomSheetBody } from '@/components/BottomSheet';
import { catalogSpecRows } from '@/lib/catalogSpecs';
import { cadRange } from '@/lib/catalogPrice';
import { CLUB_GEAR_MIN_COHORT } from '@/lib/clubGear';
import type { StringColourId } from '@/lib/stringPalette';
import { ColourList } from './StringColours';
import { stringColours, stringTypeOf, typeBand, typeTint, stockColour, type StockBand } from '@/lib/stringShelf';
import type { CatalogItem } from '@/lib/types';

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

/**
 * One string the club offers, explained (docs/plans/string-inventory.md;
 * the product sheet, design 2e, in docs/design/strings-shelf-spec.md): a
 * header band with the gauge, the club's price and whether it is on the
 * shelf; what it is for; the facts a player checks; the maker's colours; its
 * ratings; and — the part a member cannot get from the box — what each of
 * those means for how it plays. The catalog's figures are the maker's or the
 * community's (`ratingSource`), shown as such.
 *
 * Browsing only: there is no request button here. A request starts from the
 * Home card's request sheet.
 */
export default function StringDetailSheet({
  item,
  open,
  onClose,
  price,
  band = null,
  clubCount = null,
  clubColours = [],
}: {
  item: CatalogItem | null;
  open: boolean;
  onClose: () => void;
  /** The club's price: a figure, `null` for "Ask", `undefined` when none is set. */
  price?: string | null;
  band?: StockBand | null;
  clubCount?: number | null;
  /** The colours the club says it has this string in. When set, they replace
   *  the maker's list — which can only say "ask the stringer". */
  clubColours?: StringColourId[];
}) {
  const t = useTranslations('home.stringing.offer');
  const tSpec = useTranslations('stats.gear');
  const a = item?.attributes ?? {};
  const num = (k: string) => (typeof a[k] === 'number' ? (a[k] as number) : null);
  const text = (k: string) => (typeof a[k] === 'string' && (a[k] as string).trim() ? (a[k] as string) : null);
  // Power first: it is the axis the map leads with, and the word a player uses.
  const ratings: Array<[string, number | null]> = [['power', num('repulsion')], ['control', num('control')], ['durability', num('durability')]];
  const gaugeClass = text('gaugeClass')?.toLowerCase();
  const type = stringTypeOf(item);
  const feel = text('feel')?.toLowerCase();
  const mm = num('gaugeMm');
  const crossMm = num('gaugeCrossMm');
  const shopRange = item ? cadRange(item) : null;
  const colours = stringColours(item);
  const hasPrice = price !== undefined;

  const meaning: string[] = [];
  if (mm !== null && (gaugeClass === 'thin' || gaugeClass === 'standard' || gaugeClass === 'thick')) {
    meaning.push(t(`gauge_${gaugeClass}`, { mm: mm.toFixed(2) }));
  }
  if (type) meaning.push(t(`type_${type}`));
  if (feel === 'soft' || feel === 'medium' || feel === 'hard') meaning.push(t(`feel_${feel}`));

  // Tension range, feel and level, from the same curated rows as Specs.
  const facts = item ? catalogSpecRows(item).filter((r) => r.labelKey === 'specTension' || r.labelKey === 'specFeel' || r.labelKey === 'specLevel') : [];
  const showCount = clubCount !== null && clubCount >= CLUB_GEAR_MIN_COHORT;

  return (
    <BottomSheet open={open} onClose={onClose} ariaLabel={item ? `${item.brand} ${item.model}` : t('title')}>
      <BottomSheetHeader onClose={onClose} closeLabel={t('close')}>
        <span style={{ fontSize: 'var(--fs-lg)', fontWeight: 600 }}>{item ? `${item.brand} ${item.model}` : ''}</span>
      </BottomSheetHeader>
      <BottomSheetBody>
        {item && (
          <div style={{ display: 'flex', flexDirection: 'column', gap: 'var(--space-5)' }}>
            {(type || band || mm !== null || hasPrice) && (
              <div style={{ borderRadius: 'var(--radius-lg)', padding: 'var(--space-5)', background: typeBand(type), display: 'flex', flexDirection: 'column', gap: 'var(--space-4)' }}>
                <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', gap: 'var(--space-3)' }}>
                  {type ? (
                    <span className="section-label" style={{ fontSize: 'var(--fs-xs)', color: typeTint(type) ?? 'var(--text-secondary)' }}>{t(`typeWord_${type}`)}</span>
                  ) : <span />}
                  {band && (
                    <span className="fs-sm" style={{ display: 'inline-flex', alignItems: 'center', gap: 'var(--space-2)', padding: 'var(--space-1) var(--space-4)', borderRadius: 'var(--radius-pill)', background: 'color-mix(in srgb, var(--page-bg) 45%, transparent)', color: 'var(--text-secondary)' }}>
                      <span aria-hidden="true" style={{ width: 6, height: 6, borderRadius: '50%', background: stockColour(band) }} />
                      {t(`stock_${band}`)}
                    </span>
                  )}
                </div>
                <div style={{ display: 'flex', alignItems: 'flex-end', justifyContent: 'space-between', gap: 'var(--space-4)' }}>
                  {mm !== null ? (
                    <div style={{ display: 'flex', flexDirection: 'column', gap: 'var(--space-1)' }}>
                      <span style={{ fontFamily: 'var(--font-mono)', fontSize: 'var(--fs-count)', fontWeight: 600, lineHeight: 1, color: 'var(--text-primary)' }}>
                        {mm.toFixed(2)}
                        <span style={{ fontSize: 'var(--fs-base)', fontWeight: 400, color: 'var(--text-secondary)' }}> mm</span>
                      </span>
                      {(text('gaugeClass') || crossMm !== null) && (
                        <span className="fs-xs" style={{ color: 'var(--text-secondary)' }}>
                          {[text('gaugeClass') ? t('gaugeWord', { class: text('gaugeClass')! }) : null, crossMm !== null ? t('gaugeCross', { mm: crossMm.toFixed(2) }) : null].filter(Boolean).join(' · ')}
                        </span>
                      )}
                    </div>
                  ) : <span />}
                  {hasPrice && (
                    <div style={{ display: 'flex', flexDirection: 'column', alignItems: 'flex-end', gap: 'var(--space-1)' }}>
                      <span style={{ fontFamily: 'var(--font-mono)', fontSize: 'var(--fs-stat-lg)', fontWeight: 700, lineHeight: 1, color: 'var(--text-primary)' }}>{price ?? t('priceAsk')}</span>
                      <span className="fs-xs" style={{ color: 'var(--text-secondary)' }}>{t('restringWith')}</span>
                    </div>
                  )}
                </div>
              </div>
            )}

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

            <section aria-label={t('ratings')} className="flex flex-col gap-2">
              <span className="section-label-muted">{t('ratings')}</span>
              {ratings.map(([key, value]) => value === null ? null : (
                <div key={key} style={{ display: 'grid', gridTemplateColumns: '6.5rem 1fr 2.5rem', alignItems: 'center', gap: 'var(--space-3)' }}>
                  <span className="fs-sm" style={{ color: 'var(--text-secondary)' }}>{t(key)}</span>
                  <div style={{ height: 6, borderRadius: 'var(--radius-pill)', background: 'var(--inner-card-bg)', overflow: 'hidden' }}>
                    <div style={{ width: `${Math.max(0, Math.min(10, value)) * 10}%`, height: '100%', borderRadius: 'var(--radius-pill)', background: 'var(--accent)' }} />
                  </div>
                  <span className="fs-sm" style={{ fontFamily: 'var(--font-mono)', color: 'var(--text-muted)', textAlign: 'right' }}>{value}/10</span>
                </div>
              ))}
              {text('ratingSource') && <p className="fs-xs" style={{ margin: 0, color: 'var(--text-muted)' }}>{t('ratingSourcePower', { source: text('ratingSource')! })}</p>}
            </section>

            {meaning.length > 0 && (
              <section aria-label={t('meansTitle')} className="flex flex-col gap-2">
                <span className="section-label-muted">{t('meansTitle')}</span>
                {meaning.map((line) => (
                  <p key={line} className="fs-base" style={{ margin: 0, color: 'var(--text-secondary)', lineHeight: 'var(--lh-normal)' }}>{line}</p>
                ))}
              </section>
            )}

            <section aria-label={t('specs')} className="flex flex-col gap-1">
              <span className="section-label-muted">{t('specs')}</span>
              <dl className="fs-sm" style={{ margin: 0, display: 'grid', gridTemplateColumns: 'auto 1fr', columnGap: 'var(--space-4)', rowGap: 'var(--space-1)' }}>
                {/* The two ratings drawn as bars above are not repeated as rows. */}
                {catalogSpecRows(item).filter((r) => r.labelKey !== 'specRepulsion' && r.labelKey !== 'specDurability').map((r) => (
                  <div key={r.labelKey} style={{ display: 'contents' }}>
                    <dt style={{ color: 'var(--text-muted)' }}>{tSpec(r.labelKey)}</dt>
                    <dd style={{ margin: 0, color: 'var(--text-primary)' }}>{r.value}</dd>
                  </div>
                ))}
              </dl>
              {/* The shop's typical range only when the club has no price of
                  its own — beside a real price it is a second number to
                  compare against for no reason. */}
              {!hasPrice && shopRange && <p className="fs-xs" style={{ margin: 0, color: 'var(--text-muted)' }}>{t('typicalPrice', { range: shopRange[0] === shopRange[1] ? `$${shopRange[0]}` : `$${shopRange[0]}–${shopRange[1]}` })}</p>}
            </section>
          </div>
        )}
      </BottomSheetBody>
    </BottomSheet>
  );
}
