'use client';

import { useTranslations } from 'next-intl';
import { stockColour, type StockBand } from '@/lib/stringShelf';

/**
 * In stock / Low / Out: a 6px dot and the word. The band only — a player is
 * never shown sets, metres or cost (docs/design/strings-shelf-spec.md).
 */
export default function StockBadge({ band }: { band: StockBand }) {
  const t = useTranslations('home.stringing.offer');
  return (
    <span className="fs-xs" style={{ display: 'inline-flex', alignItems: 'center', gap: 'var(--space-1)', color: band === 'out' ? 'var(--text-muted)' : 'var(--text-secondary)', whiteSpace: 'nowrap' }}>
      <span aria-hidden="true" style={{ width: 6, height: 6, borderRadius: '50%', background: stockColour(band), flex: 'none' }} />
      {t(`stock_${band}`)}
    </span>
  );
}
