'use client';
import { useTranslations } from 'next-intl';
import type { CourtLine as CourtLineValue } from '@/lib/clubRun';

/**
 * "Filled up early? Another court can be added…" on the sign-up card while
 * the session is full or you are on its waitlist
 * (docs/plans/waitlist-court-line.md). Grant, 2026-11-04: "everyone should see
 * the idea of court can be added if sign up fills up early".
 *
 * It describes what COULD happen, never a promise: courts are booked with the
 * venue, outside the app, and the admin decides. Muted body copy, no accent —
 * nothing here is a thing to tap.
 */
export default function CourtLine({ line }: { line: CourtLineValue }) {
  const t = useTranslations('home.signup');
  const text =
    line.waiting === 0
      ? t('courtNone', { perCourt: line.perCourt })
      : line.more > 0
        ? t('courtSome', { waiting: line.waiting, more: line.more })
        : t('courtFull', { waiting: line.waiting });
  return (
    <p className="fs-sm" style={{ color: 'var(--text-muted)' }}>
      {text}
    </p>
  );
}
