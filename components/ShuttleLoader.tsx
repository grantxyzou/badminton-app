'use client';

/**
 * Section-level shimmer loader. (The branded "wave" ShuttleLoader was retired
 * in the loading-sequence consolidation — the shuttlecock identity now lives
 * only in the cold-start splash. All in-app data loading uses the shimmer
 * family: this loader plus `CardSkeleton`/`TabSkeleton`.)
 */

/**
 * Subtle shimmer placeholder lines for section-level loading (<2s).
 */
export function ShimmerLoader({ lines = 3 }: { lines?: number }) {
  return (
    <div className="space-y-3 py-4 px-2" role="status" aria-label="Loading">
      {Array.from({ length: lines }).map((_, i) => (
        <div
          key={i}
          className="shimmer-line rounded-lg"
          style={{
            height: 12,
            width: `${75 - i * 15}%`,
            animationDelay: `${i * 150}ms`,
          }}
        />
      ))}
    </div>
  );
}
