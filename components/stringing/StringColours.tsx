'use client';

import { useCallback } from 'react';
import { useTranslations } from 'next-intl';
import { reelColourFill } from '@/lib/stringShelf';
import {
  comboParts, isCustomColourId, isStringColourId,
  type CustomColour, type ReelColourId,
} from '@/lib/stringPalette';

/**
 * The colours a club has a string in: the bench's picker and the Stringing
 * tab's swatches, one vocabulary (`lib/stringPalette.ts`) and one set of
 * names. A two-colour set draws split down the middle, mains on the left; a
 * club's own colour draws from its hex and reads by the name it was given.
 */

const DOT = {
  width: 'var(--space-4)',
  height: 'var(--space-4)',
  borderRadius: '50%',
  flex: '0 0 auto',
  // A white swatch on a cream card needs an edge to be seen at all.
  boxShadow: 'inset 0 0 0 1px color-mix(in srgb, var(--text-primary) 30%, transparent)',
} as const;

/**
 * A reel colour's name in the app's language: the palette's translated word
 * (`short` for a tile's one line: "Fl. yellow"), a club colour as typed, or
 * "<mains> / <crosses>" built from the translated parts.
 */
export function useReelColourName(customs: readonly CustomColour[] = []) {
  const t = useTranslations('home.stringing.offer');
  return useCallback(
    function name(id: ReelColourId, short = false): string {
      if (isStringColourId(id)) return t(short ? `colourShort.${id}` : `colourName.${id}`);
      if (isCustomColourId(id)) return customs.find((c) => c.id === id)?.name ?? t('customUnnamed');
      const parts = comboParts(id);
      if (!parts) return t('customUnnamed');
      return t('comboName', { mains: name(parts.mains, short), crosses: name(parts.crosses, short) });
    },
    [t, customs],
  );
}

export function ColourDot({ id, size = 'md' }: { id: ReelColourId; size?: 'sm' | 'md' }) {
  const s = size === 'sm' ? 'var(--space-3)' : DOT.width;
  return <span aria-hidden="true" style={{ ...DOT, width: s, height: s, background: reelColourFill(id) }} />;
}

/** A row of dots, named for a screen reader: "White, Red / White". */
export function ColourDots({ ids, size = 'sm', customs = [] }: { ids: ReelColourId[]; size?: 'sm' | 'md'; customs?: readonly CustomColour[] }) {
  const t = useTranslations('home.stringing.offer');
  const name = useReelColourName(customs);
  if (ids.length === 0) return null;
  return (
    <span
      role="img"
      aria-label={t('coloursLabel', { colours: ids.map((id) => name(id)).join(', ') })}
      style={{ display: 'inline-flex', alignItems: 'center', gap: 'var(--space-1)' }}
    >
      {ids.map((id) => <ColourDot key={id} id={id} size={size} />)}
    </span>
  );
}

/** Swatches with their names, for a string's page. */
export function ColourList({ ids, customs = [] }: { ids: ReelColourId[]; customs?: readonly CustomColour[] }) {
  const name = useReelColourName(customs);
  return (
    <div className="fs-base" style={{ display: 'flex', flexWrap: 'wrap', gap: 'var(--space-4)' }}>
      {ids.map((id) => (
        <span key={id} style={{ display: 'inline-flex', alignItems: 'center', gap: 'var(--space-2)', color: 'var(--text-secondary)' }}>
          <ColourDot id={id} />
          {name(id)}
        </span>
      ))}
    </div>
  );
}
