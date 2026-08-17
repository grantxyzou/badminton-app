'use client';
import { useTranslations } from 'next-intl';
import StatusBadge from '@/components/primitives/StatusBadge';
import type { GearItem } from '@/lib/types';

interface Props {
  items: GearItem[];
  activeId: string | undefined;
  onActivate: (id: string) => void;
  onRemove: (id: string) => void;
  busy: boolean;
}

/**
 * The player's racket bag, shown above the picker inside GearSheet.
 *
 * Hidden below two rackets: with one racket there is no choice to make, and a
 * "bag" of one is chrome. The single-racket experience is unchanged from
 * before the bag existed.
 */
export default function BagList({ items, activeId, onActivate, onRemove, busy }: Props) {
  const t = useTranslations('valueHub');
  if (items.length < 2) return null;

  return (
    <section style={{ display: 'flex', flexDirection: 'column', gap: 'var(--space-2)' }}>
      <p className="section-label" style={{ margin: 0 }}>{t('bagTitle')}</p>
      <ul style={{ listStyle: 'none', margin: 0, padding: 0, display: 'flex', flexDirection: 'column', gap: 6 }}>
        {items.map((item) => {
          const isActive = item.id === activeId;
          return (
            <li
              key={item.id}
              className="cc-mini-card"
              style={{ display: 'flex', alignItems: 'center', gap: 'var(--space-3)', padding: 12, borderRadius: 'var(--radius-lg)' }}
            >
              <span style={{ flex: 1, fontSize: 'var(--fs-md)' }}>{item.label}</span>
              {isActive ? (
                <StatusBadge variant="accent">{t('bagActive')}</StatusBadge>
              ) : (
                <button
                  type="button"
                  className="cc-btn cc-btn-ghost"
                  disabled={busy}
                  aria-label={`${t('bagSetActive')} — ${item.label}`}
                  onClick={() => onActivate(item.id)}
                >
                  {t('bagSetActive')}
                </button>
              )}
              <button
                type="button"
                className="cc-btn cc-btn-ghost"
                disabled={busy}
                aria-label={`${t('bagRemove')} — ${item.label}`}
                onClick={() => onRemove(item.id)}
              >
                <span className="material-icons" style={{ fontSize: 'var(--icon-sm)' }} aria-hidden="true">close</span>
              </button>
            </li>
          );
        })}
      </ul>
    </section>
  );
}
