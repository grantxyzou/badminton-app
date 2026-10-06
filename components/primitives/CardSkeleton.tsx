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
        padding: 'var(--space-5)',
        display: 'flex',
        flexDirection: 'column',
        gap: 'var(--space-4)',
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
export function TabSkeleton({ announcement }: { announcement?: React.ReactNode } = {}) {
  return (
    <div className="space-y-5" role="status" aria-label="Loading">
      {/* tile row: Location | When. 133, re-measured 2026-10-03 at 400px: the
          club's address and a long date ("Monday, October 5") both wrap to two
          lines on a phone, so the old 108 (one line) jumped every week. */}
      <div className="grid grid-cols-2 gap-3">
        <CardSkeleton height={133} />
        <CardSkeleton height={133} />
      </div>
      {/* The announcement. Home passes the SERVER-RENDERED card itself (it is
          the LCP element, so it is drawn for real, not shimmered), or `null`
          when the server found none — then no slot is reserved, because a
          skeleton for a card that will not exist is a jump waiting to happen.
          Omitted entirely, the old fixed 120px block. */}
      {announcement === undefined ? <CardSkeleton height={120} /> : announcement}
      {/* sign-up card */}
      <CardSkeleton height={210} />
    </div>
  );
}

/**
 * The admin console's card heights, measured on the running console at 400px
 * (2026-10-05). ONE copy, read by AdminTabSkeleton below and by the console's
 * RevealSlot placeholders (CommandCenter.tsx), so the auth-check frame and the
 * console it hands over to cannot drift apart. Here rather than in the admin
 * code so this file — which everyone downloads — imports nothing from it.
 */
export const CONSOLE_HEIGHTS = { nextSession: 274, tile: 109, payments: 351, invite: 343, settings: 391 } as const;

/**
 * Admin dashboard (Command Center) skeleton — the console's first three cards
 * (CONSOLE_HEIGHTS) in the console's own tile grid and gap. It used to be
 * 300 / 104 / 176 at a 16px gap, which matched none of them, so the console
 * jumped as it replaced this. The bar above is the caller's.
 */
export function AdminTabSkeleton() {
  return (
    <div className="flex flex-col gap-5" role="status" aria-label="Loading">
      <CardSkeleton height={CONSOLE_HEIGHTS.nextSession} />
      <div className="cc-dgrid">
        <CardSkeleton height={CONSOLE_HEIGHTS.tile} />
        <CardSkeleton height={CONSOLE_HEIGHTS.tile} />
      </div>
      <CardSkeleton height={CONSOLE_HEIGHTS.payments} />
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
