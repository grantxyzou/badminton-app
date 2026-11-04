'use client';

import { useEffect, useRef, useState } from 'react';
import { useTranslations } from 'next-intl';
import { refreshNotices, useNotices } from '@/lib/useNotices';

/**
 * The third round button, beside the language and theme toggles (Grant,
 * 2026-11-03). A red dot when something arrived since the page was last
 * opened (`docs/plans/notification-center.md`).
 *
 * It owns WHEN the list is re-read, because it is the one piece always on
 * screen: on mount, when the app comes back to the foreground, and when the
 * store app resumes (`bpm:resume`). A dot that only changed on a reload would
 * read as broken.
 */
interface Props {
  onOpen: () => void;
  /** The page is open: the bell shows pressed, and a tap closes it. */
  active?: boolean;
  onClose?: () => void;
}

export default function NotificationsButton({ onOpen, active = false, onClose }: Props) {
  const t = useTranslations('notifications');
  const { status, unread } = useNotices();
  // Only from a read that answered: unknown is not "nothing new", and it is
  // not "something new" either.
  const showDot = status === 'ready' && unread > 0;

  // Ring once each time the dot ARRIVES (hidden → shown), never on a
  // re-render. The count keys the glyph, so a remount replays the animation.
  const [rings, setRings] = useState(0);
  const hadDot = useRef(false);
  useEffect(() => {
    if (showDot && !hadDot.current) setRings((n) => n + 1);
    hadDot.current = showDot;
  }, [showDot]);

  useEffect(() => {
    void refreshNotices();
    const onVisible = () => {
      if (document.visibilityState === 'visible') void refreshNotices();
    };
    const onResume = () => void refreshNotices();
    document.addEventListener('visibilitychange', onVisible);
    window.addEventListener('bpm:resume', onResume);
    return () => {
      document.removeEventListener('visibilitychange', onVisible);
      window.removeEventListener('bpm:resume', onResume);
    };
  }, []);

  const label = showDot ? t('openUnread', { count: unread }) : t('open');
  return (
    <button
      type="button"
      className="notif-toggle"
      onClick={active && onClose ? onClose : onOpen}
      aria-label={label}
      aria-pressed={active}
      title={label}
    >
      <span key={rings} className={rings > 0 ? 'material-icons notif-ring' : 'material-icons'} aria-hidden>
        notifications
      </span>
      {showDot && <span className="notif-dot" aria-hidden />}
    </button>
  );
}
