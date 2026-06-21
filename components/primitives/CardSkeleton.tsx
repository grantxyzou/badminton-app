'use client';

/**
 * Fixed-height shimmer placeholder shaped like a `.glass-card`. Used while a
 * card's data loads so the page reserves the card's final footprint instead of
 * collapsing to nothing and reflowing when content pops in. Pair a stack of
 * these (in the same order as the real cards) to get a stable, top-to-bottom
 * reveal rather than out-of-order jank.
 *
 * Reuses the `.shimmer-line` token from globals.css for the moving sheen.
 */
export default function CardSkeleton({
  height = 96,
  className = '',
  rounded = 16,
}: {
  height?: number;
  className?: string;
  rounded?: number;
}) {
  return (
    <div
      className={`glass-card ${className}`}
      aria-hidden="true"
      style={{
        height,
        borderRadius: rounded,
        padding: 16,
        display: 'flex',
        flexDirection: 'column',
        gap: 10,
        justifyContent: 'center',
        overflow: 'hidden',
      }}
    >
      <div className="shimmer-line rounded-lg" style={{ height: 12, width: '45%' }} />
      <div className="shimmer-line rounded-lg" style={{ height: 12, width: '80%', animationDelay: '120ms' }} />
      <div className="shimmer-line rounded-lg" style={{ height: 12, width: '60%', animationDelay: '240ms' }} />
    </div>
  );
}

/**
 * The Home/Sign-Up tab skeleton — header strip + tile row + a couple of card
 * blocks, matching the real layout's order and rough heights. Renders instantly
 * on mount so the structure is stable before data lands.
 */
export function TabSkeleton() {
  return (
    <div className="space-y-5" role="status" aria-label="Loading">
      <div className="shimmer-line rounded-lg" style={{ height: 26, width: '55%' }} />
      <div className="grid grid-cols-2 gap-3">
        <CardSkeleton height={72} />
        <CardSkeleton height={72} />
      </div>
      <CardSkeleton height={110} />
      <CardSkeleton height={140} />
    </div>
  );
}

/**
 * Admin Command Center body skeleton — reserves the dashboard's rough
 * footprint (hero + tile row + a card) while admin auth resolves or the
 * console data loads, so the view fades in instead of popping from blank.
 * The page title is rendered separately by the caller's `<PageHeader>`.
 */
export function AdminTabSkeleton() {
  return (
    <div className="space-y-4" role="status" aria-label="Loading">
      <CardSkeleton height={120} />
      <div className="grid grid-cols-2 gap-3">
        <CardSkeleton height={80} />
        <CardSkeleton height={80} />
      </div>
      <CardSkeleton height={160} />
    </div>
  );
}
