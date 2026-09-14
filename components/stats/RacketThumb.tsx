'use client';

import { racketSrc } from '@/lib/racketLook';

/**
 * A catalog racket on a tile, drawn in that model's colours
 * (`lib/racketLook.ts`). A racket with no catalog id gets the app's own
 * graphite-and-green drawing.
 */
export default function RacketThumb({ catalogId, saved = false }: { catalogId?: string | null; saved?: boolean }) {
  return (
    <span className={`setup-thumb${saved ? ' setup-thumb--saved' : ''}`} aria-hidden="true">
      {/* eslint-disable-next-line @next/next/no-img-element -- an inline SVG data URL shown at 24px; next/image cannot optimise a data URL and would add nothing. */}
      <img src={racketSrc(catalogId)} alt="" />
    </span>
  );
}
