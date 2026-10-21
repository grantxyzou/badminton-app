'use client';

import { useTranslations } from 'next-intl';
import { paletteFill } from '@/lib/stringShelf';
import { STRING_PALETTE, type StringColourId } from '@/lib/stringPalette';

/**
 * The colours a club has a string in: the bench's picker and the Stringing
 * tab's swatches, one palette (`lib/stringPalette.ts`) and one set of names.
 */

const DOT = {
  width: 'var(--space-4)',
  height: 'var(--space-4)',
  borderRadius: '50%',
  flex: '0 0 auto',
  // A white swatch on a cream card needs an edge to be seen at all.
  boxShadow: 'inset 0 0 0 1px color-mix(in srgb, var(--text-primary) 30%, transparent)',
} as const;

export function ColourDot({ id, size = 'md' }: { id: StringColourId; size?: 'sm' | 'md' }) {
  const s = size === 'sm' ? 'var(--space-3)' : DOT.width;
  return <span aria-hidden="true" style={{ ...DOT, width: s, height: s, background: paletteFill(id) }} />;
}

/** A row of dots, named for a screen reader: "White, yellow". */
export function ColourDots({ ids, size = 'sm' }: { ids: StringColourId[]; size?: 'sm' | 'md' }) {
  const t = useTranslations('home.stringing.offer');
  if (ids.length === 0) return null;
  return (
    <span
      role="img"
      aria-label={t('coloursLabel', { colours: ids.map((id) => t(`colourName.${id}`)).join(', ') })}
      style={{ display: 'inline-flex', alignItems: 'center', gap: 'var(--space-1)' }}
    >
      {ids.map((id) => <ColourDot key={id} id={id} size={size} />)}
    </span>
  );
}

/** Swatches with their names, for a string's page. */
export function ColourList({ ids }: { ids: StringColourId[] }) {
  const t = useTranslations('home.stringing.offer');
  return (
    <div className="fs-base" style={{ display: 'flex', flexWrap: 'wrap', gap: 'var(--space-4)' }}>
      {ids.map((id) => (
        <span key={id} style={{ display: 'inline-flex', alignItems: 'center', gap: 'var(--space-2)', color: 'var(--text-secondary)' }}>
          <ColourDot id={id} />
          {t(`colourName.${id}`)}
        </span>
      ))}
    </div>
  );
}

/**
 * The picker: every palette colour as a pressed / unpressed chip. Order
 * follows the palette, so two stringers picking the same set see it the same.
 */
export function ColourPicker({
  value,
  onChange,
  disabled = false,
  label,
}: {
  value: StringColourId[];
  onChange: (next: StringColourId[]) => void;
  disabled?: boolean;
  label: string;
}) {
  const t = useTranslations('home.stringing.offer');
  const on = new Set(value);
  return (
    <div role="group" aria-label={label} style={{ display: 'flex', flexWrap: 'wrap', gap: 'var(--space-2)' }}>
      {STRING_PALETTE.map((id) => {
        const pressed = on.has(id);
        return (
          <button
            key={id}
            type="button"
            aria-pressed={pressed}
            disabled={disabled}
            onClick={() => onChange(STRING_PALETTE.filter((c) => (c === id ? !pressed : on.has(c))))}
            style={{ minHeight: 44, padding: 0, background: 'transparent', border: 'none', cursor: 'pointer', display: 'flex', alignItems: 'center', color: 'inherit' }}
          >
            <span className={pressed ? 'filter-chip filter-chip--applied' : 'filter-chip'} style={{ display: 'inline-flex', alignItems: 'center', gap: 'var(--space-2)' }}>
              <ColourDot id={id} size="sm" />
              {t(`colourName.${id}`)}
            </span>
          </button>
        );
      })}
    </div>
  );
}
