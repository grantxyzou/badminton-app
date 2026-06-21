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
/**
 * Home tab BODY skeleton — mirrors HomeTab's real card stack so nothing shifts
 * when data lands: the Location|When tile row, the announcement/cost card, then
 * the tall sign-up card. Heights match the live cards (measured ≈108 / 120 /
 * 210). HomeTab renders the real `<PageHeader>` above this, so there is no
 * header strip here — the header slot is the real component, not a shimmer.
 */
export function TabSkeleton() {
  return (
    <div className="space-y-5" role="status" aria-label="Loading">
      {/* tile row: Location | When */}
      <div className="grid grid-cols-2 gap-3">
        <CardSkeleton height={108} />
        <CardSkeleton height={108} />
      </div>
      {/* announcement / cost card */}
      <CardSkeleton height={120} />
      {/* sign-up card */}
      <CardSkeleton height={210} />
    </div>
  );
}

/**
 * Admin dashboard (Command Center) skeleton — mirrors the console's real stack:
 * the tall status card, the 2-col Birds|Roster tile row, then a card. Heights
 * track the live layout (measured ≈300 / 104 tiles / 176). This is what
 * next/prod shows, so the auth-check skeleton reserves the tiles immediately.
 * The page title is rendered separately by the caller's `<PageHeader>`.
 */
export function AdminTabSkeleton() {
  return (
    <div className="space-y-4" role="status" aria-label="Loading">
      <CardSkeleton height={300} />
      {/* Birds | Roster tile row */}
      <div className="grid grid-cols-2 gap-3">
        <CardSkeleton height={104} />
        <CardSkeleton height={104} />
      </div>
      <CardSkeleton height={176} />
    </div>
  );
}

/**
 * Admin drill-down PAGE body skeleton (Setup / Roster / Birds) — these are
 * single-purpose form/list pages with no tile row, so a couple of stacked
 * cards mirror them. The `<AdminBackHeader>` is rendered separately by the
 * caller, so there is no header strip here.
 */
export function AdminPageSkeleton() {
  return (
    <div className="space-y-4" role="status" aria-label="Loading">
      <CardSkeleton height={120} />
      <CardSkeleton height={260} />
    </div>
  );
}
