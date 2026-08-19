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
 * The player's rackets, listed on the Equipment tab itself.
 *
 * This used to live inside the picker sheet and hide itself below two rackets
 * ("a bag of one is chrome"). That was right for a sheet, where one row stole
 * space from a 50-row catalog — and wrong the moment the tab became the bag:
 * it left a one-racket player with no way to remove or replace the racket they
 * own. The list now always renders every racket, the active one included, so
 * the layout has one shape at one racket and at five.
 *
 * The active row shows a badge where the others show "Use this one", but keeps
 * its remove button. That's the invariant this component exists to hold: a
 * player with exactly one racket can still change it and still remove it.
 */
export default function BagList({ items, activeId, onActivate, onRemove, busy }: Props) {
  const t = useTranslations('valueHub');
  if (items.length === 0) return null;

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
