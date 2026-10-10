'use client';

import { useTranslations } from 'next-intl';
import { BottomSheet, BottomSheetHeader, BottomSheetBody } from '@/components/BottomSheet';
import { catalogSpecRows } from '@/lib/catalogSpecs';
import { cadRange } from '@/lib/catalogPrice';
import type { CatalogItem } from '@/lib/types';

/**
 * One string the club offers, explained (docs/plans/string-inventory.md):
 * what it is for, its ratings, the spec sheet, and — the part a member
 * cannot get from the box — what each of those words means for how it
 * plays. The catalog's figures are the maker's or the community's
 * (`ratingSource`), shown as such; the club's price is the rate card's.
 */
export default function StringDetailSheet({ item, open, onClose }: { item: CatalogItem | null; open: boolean; onClose: () => void }) {
  const t = useTranslations('home.stringing.offer');
  const tSpec = useTranslations('stats.gear');
  const a = item?.attributes ?? {};
  const num = (k: string) => (typeof a[k] === 'number' ? (a[k] as number) : null);
  const text = (k: string) => (typeof a[k] === 'string' && (a[k] as string).trim() ? (a[k] as string) : null);
  const ratings: Array<[string, number | null]> = [['repulsion', num('repulsion')], ['durability', num('durability')], ['control', num('control')]];
  const gaugeClass = text('gaugeClass')?.toLowerCase();
  const type = text('stringType')?.toLowerCase();
  const feel = text('feel')?.toLowerCase();
  const mm = num('gaugeMm');
  const price = item ? cadRange(item) : null;

  const meaning: string[] = [];
  if (mm !== null && (gaugeClass === 'thin' || gaugeClass === 'standard' || gaugeClass === 'thick')) {
    meaning.push(t(`gauge_${gaugeClass}`, { mm: mm.toFixed(2) }));
  }
  if (type === 'durability' || type === 'repulsion' || type === 'control' || type === 'hybrid' || type === 'all-round') {
    meaning.push(t(`type_${type.replace('-', '_')}`));
  }
  if (feel === 'soft' || feel === 'medium' || feel === 'hard') meaning.push(t(`feel_${feel}`));

  return (
    <BottomSheet open={open} onClose={onClose} ariaLabel={item ? `${item.brand} ${item.model}` : t('title')}>
      <BottomSheetHeader onClose={onClose} closeLabel={t('close')}>
        <span style={{ fontSize: 'var(--fs-lg)', fontWeight: 600 }}>{item ? `${item.brand} ${item.model}` : ''}</span>
      </BottomSheetHeader>
      <BottomSheetBody>
        {item && (
          <div style={{ display: 'flex', flexDirection: 'column', gap: 'var(--space-5)' }}>
            {text('bestFor') && (
              <p className="fs-md" style={{ margin: 0, color: 'var(--text-primary)', lineHeight: 'var(--lh-normal)' }}>{text('bestFor')}</p>
            )}

            <section aria-label={t('ratings')} className="flex flex-col gap-2">
              <span className="section-label">{t('ratings')}</span>
              {ratings.map(([key, value]) => value === null ? null : (
                <div key={key} style={{ display: 'grid', gridTemplateColumns: '6.5rem 1fr 2.5rem', alignItems: 'center', gap: 'var(--space-3)' }}>
                  <span className="fs-sm" style={{ color: 'var(--text-secondary)' }}>{t(key)}</span>
                  <div style={{ height: 6, borderRadius: 'var(--radius-pill)', background: 'var(--inner-card-bg)', overflow: 'hidden' }}>
                    <div style={{ width: `${Math.max(0, Math.min(10, value)) * 10}%`, height: '100%', borderRadius: 'var(--radius-pill)', background: 'var(--accent)' }} />
                  </div>
                  <span className="fs-sm" style={{ fontFamily: 'var(--font-mono)', color: 'var(--text-muted)', textAlign: 'right' }}>{value}/10</span>
                </div>
              ))}
              {text('ratingSource') && <p className="fs-xs" style={{ margin: 0, color: 'var(--text-muted)' }}>{t('ratingSource', { source: text('ratingSource')! })}</p>}
            </section>

            {meaning.length > 0 && (
              <section aria-label={t('meansTitle')} className="flex flex-col gap-2">
                <span className="section-label">{t('meansTitle')}</span>
                {meaning.map((line) => (
                  <p key={line} className="fs-base" style={{ margin: 0, color: 'var(--text-secondary)', lineHeight: 'var(--lh-normal)' }}>{line}</p>
                ))}
              </section>
            )}

            <section aria-label={t('specs')} className="flex flex-col gap-1">
              <span className="section-label">{t('specs')}</span>
              <dl className="fs-sm" style={{ margin: 0, display: 'grid', gridTemplateColumns: 'auto 1fr', columnGap: 'var(--space-4)', rowGap: 'var(--space-1)' }}>
                {/* The two ratings drawn as bars above are not repeated as rows. */}
                {catalogSpecRows(item).filter((r) => r.labelKey !== 'specRepulsion' && r.labelKey !== 'specDurability').map((r) => (
                  <div key={r.labelKey} style={{ display: 'contents' }}>
                    <dt style={{ color: 'var(--text-muted)' }}>{tSpec(r.labelKey)}</dt>
                    <dd style={{ margin: 0, color: 'var(--text-primary)' }}>{r.value}</dd>
                  </div>
                ))}
              </dl>
              {price && <p className="fs-xs" style={{ margin: 0, color: 'var(--text-muted)' }}>{t('typicalPrice', { range: `$${price[0]}–${price[1]}` })}</p>}
            </section>
          </div>
        )}
      </BottomSheetBody>
    </BottomSheet>
  );
}
