'use client';

import { useTranslations } from 'next-intl';
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
 * when data lands: the Location|When tile row, the announcement, the sign-up
 * card, the level card and the balance row, at the stack's own 10px gap
 * (`.bpm-home-skeleton` shares `--home-stack-gap`; it used to be `space-y-5`,
 * so the frame was 20px taller per card than the week it stood in for).
 * HomeTab renders the real `<PageHeader>` above this, so there is no header
 * strip here — the header slot is the real component, not a shimmer.
 *
 * The level card and the balance have RevealSlots of their own, but those
 * are INSIDE the week's slot, so they do not exist until the week has
 * loaded: without their two blocks here the page grew by 230px the moment
 * the week arrived (re-measured 2026-11-18 at 430px).
 */
export function TabSkeleton({ announcement }: { announcement: React.ReactNode }) {
  const tLoading = useTranslations('a11y');
  return (
    <div className="bpm-home-skeleton" role="status" aria-label={tLoading('loading')}>
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
          skeleton for a card that will not exist is a jump waiting to happen. */}
      {announcement}
      {/* The sign-up card: 192 signed up, 181 before signing up, at 430px
          (2026-11-18); a members-first club's list card is 345. */}
      <CardSkeleton height={192} />
      {/* The level card (SKILL_LEAD_HEIGHT) and the balance row
          (BALANCE_ROW_HEIGHT in HomeTab), both the same in every state. */}
      <CardSkeleton height={160} />
      <CardSkeleton height={50} />
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
export const CONSOLE_HEIGHTS = {
  // Re-measured 2026-11-18 at 430px: eyebrow + headline + two tiles (the
  // signed-up tile carries its bar) + the labelled switch with its "the
  // roster was notified" line + three buttons + the footer pair; the same
  // with 0 or 4 signed up, no waitlist line. 427 at 390px, where the
  // switch's line wraps. It was 358 from the 2026-10-20 redesign and the
  // console shoved everything below it by 53px on every open.
  nextSession: 411,
  tile: 109,
  // Re-measured 2026-10-20 at 430px after the redesign: hero block, two
  // still-owed rows, a paid-chips row and the add field (4 players, 2 owing).
  payments: 541,
  // The money-off club's list (SessionListCard), folded: header, the
  // "32 of 32 in · 3 waiting" line and the add field, no cancellations
  // (measured 2026-11-05, 430px, the six-feathers seed).
  sessionList: 178,
  invite: 343,
  // The grouped lists (People / Money / Club / More, eyebrows included):
  // re-measured 2026-11-18 at 430px with every row a first-come club with
  // money and stringing on shows (Club link, Sign-in readiness, Ledger,
  // E-transfers, Credit codes, E-transfer recipient, the seven Club rows,
  // Metrics, Release notes, Missing from the catalog); 950 at 390px. A
  // members-first club with money off lists 595.
  settings: 926,
  // Needs you: the eyebrow, then a list of TWO rows (48 + a 1px divider + 48)
  // — the usual count, unpaid and dormant (measured 2026-10-28, 430px).
  needsYouEyebrow: 16.5,
  needsYouList: 97,
} as const;

/**
 * Admin dashboard (Command Center) skeleton — the console's first three cards
 * (CONSOLE_HEIGHTS) in the console's own tile grid and gap. It used to be
 * 300 / 104 / 176 at a 16px gap, which matched none of them, so the console
 * jumped as it replaced this. The bar above is the caller's.
 */
export function AdminTabSkeleton() {
  const tLoading = useTranslations('a11y');
  // The console's order since 2026-11-04: the glance tiles first, then "This
  // week" — the Session · Payments toggle and the session card, which the
  // toggle opens on.
  return (
    <div className="flex flex-col gap-5" role="status" aria-label={tLoading('loading')}>
      <div className="cc-dgrid">
        <CardSkeleton height={CONSOLE_HEIGHTS.tile} />
        <CardSkeleton height={CONSOLE_HEIGHTS.tile} />
      </div>
      <CardSkeleton height={CONSOLE_HEIGHTS.nextSession} />
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
  const tLoading = useTranslations('a11y');
  return (
    <div className="space-y-4" role="status" aria-label={tLoading('loading')}>
      <CardSkeleton height={120} />
      <CardSkeleton height={260} />
    </div>
  );
}
