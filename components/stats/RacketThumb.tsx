'use client';

const BASE = process.env.NEXT_PUBLIC_BASE_PATH ?? '';

/** The one stand-in render every racket row shares (`public/brand/racket-standin.svg`). */
export const RACKET_STANDIN_SRC = `${BASE}/brand/racket-standin.svg`;

/**
 * The stand-in racket on a tile. ONE image for every model — it is not a
 * claim that any two frames look alike, which is why `CatalogItem` has no
 * image field and must not grow one for this.
 */
export default function RacketThumb({ saved = false }: { saved?: boolean }) {
  return (
    <span className={`setup-thumb${saved ? ' setup-thumb--saved' : ''}`} aria-hidden="true">
      {/* eslint-disable-next-line @next/next/no-img-element -- a 2 KB static SVG stand-in, shown at 24px; next/image would add a loader round trip per row for nothing. */}
      <img src={RACKET_STANDIN_SRC} alt="" />
    </span>
  );
}
