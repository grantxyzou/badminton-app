'use client';
import { useTranslations } from 'next-intl';

/**
 * "Another court can be added when enough people are on the waitlist." on the
 * sign-up card while the session is full or you are on its waitlist
 * (docs/plans/waitlist-court-line.md). Grant, 2026-11-04: "everyone should see
 * the idea of court can be added if sign up fills up early".
 *
 * The idea, not the count (Grant, 2026-11-11, on the design canvas): the
 * counted wording ("1 on the waitlist, 3 more would fill one") is the admin's,
 * on the Next session card. Shown only where `courtLine` answers, so a club
 * whose court size is unknown says nothing.
 *
 * It describes what COULD happen, never a promise: courts are booked with the
 * venue, outside the app, and the admin decides. Muted body copy, no accent —
 * nothing here is a thing to tap.
 */
export default function CourtLine() {
  const t = useTranslations('home.signup');
  return (
    <p className="fs-sm" style={{ color: 'var(--text-muted)' }}>
      {t('courtLater')}
    </p>
  );
}
