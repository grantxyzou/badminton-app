'use client';
import { useTranslations } from 'next-intl';
import { specTiers } from '@/lib/racketSpecs';
import type { CatalogItem } from '@/lib/types';

interface Props {
  /** Resolved catalog row for the active racket. Null when unset OR when the
   *  stored catalogId no longer resolves (discontinued/removed row). */
  item: CatalogItem | null;
  /** Label stored on the gear doc. Survives a dangling catalogId. */
  label: string | null;
  loading: boolean;
  error: boolean;
}

/**
 * The Equipment tab's lead card. The question is the permanent label in every
 * state — nothing reflows when the player answers it.
 *
 * Content is two tiers, most-human first (plain language, then the spec
 * sheet), because "4U · head-heavy · stiff" alone is precise and opaque to
 * anyone who doesn't already know rackets. See lib/racketSpecs.ts.
 *
 * Display only — not a button. It used to open the picker, which made sense
 * when the picker also held the bag. Now that the tab lists your rackets
 * directly below, switching and removing live there and adding lives on its
 * own button, so a tappable hero would just be a second door to the same room.
 */
export default function YourRacketCard({ item, label, loading, error }: Props) {
  const t = useTranslations('valueHub');
  const { plain, specs } = item ? specTiers(item) : { plain: null, specs: null };

  return (
    <div
      className="glass-card"
      style={{ padding: 20, display: 'flex', flexDirection: 'column', gap: 'var(--space-2)', width: '100%', textAlign: 'left' }}
    >
      <p style={{ fontSize: 'var(--fs-sm)', color: 'var(--text-secondary)', margin: 0 }}>{t('usingToday')}</p>

      {error ? (
        <span className="field-error" role="alert">{t('recError')}</span>
      ) : loading ? (
        <span className="shimmer-line rounded-lg" style={{ height: 22, width: '70%' }} aria-hidden="true" />
      ) : label ? (
        <>
          <span style={{ fontFamily: 'var(--font-display)', fontSize: 'var(--fs-stat)', fontWeight: 600, lineHeight: 1.2 }}>
            {item?.model ?? label}
          </span>
          {item?.brand && (
            <span style={{ fontSize: 'var(--fs-sm)', color: 'var(--text-secondary)' }}>{item.brand}</span>
          )}
          {plain && (
            <span style={{ fontSize: 'var(--fs-md)', color: 'var(--text-primary)', marginTop: 'var(--space-2)' }}>{plain}</span>
          )}
          {specs && (
            <span style={{ fontSize: 'var(--fs-sm)', color: 'var(--text-muted)' }}>{specs}</span>
          )}
        </>
      ) : (
        <span style={{ fontSize: 'var(--fs-base)', color: 'var(--text-muted)' }}>{t('noRacketYet')}</span>
      )}
    </div>
  );
}
