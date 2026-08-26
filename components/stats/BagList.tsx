'use client';
import { useTranslations } from 'next-intl';
import StatusBadge from '@/components/primitives/StatusBadge';
import type { GearItem } from '@/lib/types';
import { gearItemLabel } from '@/lib/tension';

interface Props {
  items: GearItem[];
  activeId: string | undefined;
  onActivate: (id: string) => void;
  onRemove: (id: string) => void;
  /** Apply the sheet's tension field to an owned STRING. Absent (or with no
   *  number typed) and the control is not offered. See the docstring. */
  onSetTension?: (item: GearItem) => void;
  /** Whether a usable number is currently in the tension field. */
  tensionReady?: boolean;
  busy: boolean;
}

/**
 * Items you already own in one category, rendered inside `GearSheet` above
 * the catalog.
 *
 * This used to live on the Equipment tab itself, one level above the sheet.
 * It moved back in with `GearSheet` when the tab's whole bag-on-the-tab
 * layout was retired — a category's owned items and the catalog to add more
 * of them are now one job (see `GearSheet`'s docstring), not two surfaces
 * that have to agree with each other. The list still always renders every
 * owned item, active one included — collapsing below two entries was wrong
 * even in a sheet, since it left a one-item bag with no way to remove or
 * replace what's owned.
 *
 * "Active" is a racket-only concept — a player has exactly one racket in play
 * but can own several strings at once with no such pointer — so the active
 * badge / "Use this one" control only ever renders for `category: 'racket'`
 * rows. Every category keeps its remove button.
 *
 * A string row shows its logged tension (`gearItemLabel`, shared with
 * `YourKitCard`'s row) — this list is where a member would look to confirm a
 * tension they just entered actually landed, so it can't show a plainer view
 * of the same item than the row that opened this sheet.
 *
 * It also has to be where they can CHANGE it. These rows were read-only, and
 * `GearSheet` filters everything you own out of the catalog below, so a string
 * already in the bag was not tappable anywhere: the only way to record a
 * tension was to add a string you did not already own. The feature therefore
 * worked exactly once per string and never again, and "update the tension on
 * the strings I'm playing" — the thing the field exists for — was impossible.
 * The control mirrors the racket rows' "Use this one": same place, same
 * shape, one job.
 */
export default function BagList({
  items, activeId, onActivate, onRemove, onSetTension, tensionReady, busy,
}: Props) {
  const t = useTranslations('stats.gear');
  if (items.length === 0) return null;

  return (
    <section style={{ display: 'flex', flexDirection: 'column', gap: 'var(--space-2)' }}>
      <p className="section-label" style={{ margin: 0 }}>{t('ownedTitle')}</p>
      <ul style={{ listStyle: 'none', margin: 0, padding: 0, display: 'flex', flexDirection: 'column', gap: 6 }}>
        {items.map((item) => {
          const isActive = item.id === activeId;
          const showActivate = item.category === 'racket';
          return (
            <li
              key={item.id}
              className="cc-mini-card"
              style={{ display: 'flex', alignItems: 'center', gap: 'var(--space-3)', padding: 12, borderRadius: 'var(--radius-lg)' }}
            >
              <span style={{ flex: 1, fontSize: 'var(--fs-md)' }}>{gearItemLabel(item, t('lb'))}</span>
              {showActivate && (isActive ? (
                <StatusBadge variant="accent">{t('ownedActive')}</StatusBadge>
              ) : (
                <button
                  type="button"
                  className="cc-btn cc-btn-ghost"
                  disabled={busy}
                  aria-label={`${t('ownedSetActive')} — ${item.label}`}
                  onClick={() => onActivate(item.id)}
                >
                  {t('ownedSetActive')}
                </button>
              ))}
              {onSetTension && item.category === 'string' && (
                <button
                  type="button"
                  className="cc-btn cc-btn-ghost"
                  // Disabled rather than hidden when the field is empty: the
                  // control appearing and vanishing as you type reads as a
                  // glitch, and the disabled state is the app's own way of
                  // saying "this needs something from you first".
                  disabled={busy || !tensionReady}
                  aria-label={`${t('ownedSetTension')} — ${item.label}`}
                  onClick={() => onSetTension(item)}
                >
                  {t('ownedSetTension')}
                </button>
              )}
              <button
                type="button"
                className="cc-btn cc-btn-ghost"
                disabled={busy}
                aria-label={`${t('ownedRemove')} — ${item.label}`}
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
