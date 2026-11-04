'use client';

import { useEffect, useState } from 'react';
import { useFormatter, useNow, useTranslations } from 'next-intl';
import TopBar from '@/components/primitives/TopBar';
import CardSkeleton from '@/components/primitives/CardSkeleton';
import ErrorState from '@/components/primitives/ErrorState';
import EmptyState from '@/components/primitives/EmptyState';
import PushSettings from './PushSettings';
import InstallSheet from './InstallSheet';
import MigrateSheet from './MigrateSheet';
import { registerOpenSheet } from '@/lib/sheetStack';
import { useOnline } from '@/lib/useOnline';
import { getNotices, markNoticesSeen, refreshNotices, useNotices, type Notice } from '@/lib/useNotices';
import type { UsePushResult } from '@/lib/usePush';

/** Where a notice's tap goes. Everything but the bench is about Home's week or balance. */
export type NoticeTab = 'home' | 'stringing';

interface Props {
  onBack: () => void;
  onNavigate: (tab: NoticeTab) => void;
  /** Owned by HomeShell, shared with Profile's Notifications row. */
  push: UsePushResult;
  isAdmin: boolean;
  /** Web, with the native-migrate flag on: offer the store app. */
  migrateOn: boolean;
}

const ICONS: Record<Notice['type'], string> = {
  signups_open: 'event',
  promoted: 'how_to_reg',
  stringing: 'sports_tennis',
  stringing_change: 'fact_check',
  announcement: 'campaign',
  settle_up: 'payments',
};

function tabOf(n: Notice): NoticeTab {
  return n.type === 'stringing' || n.type === 'stringing_change' ? 'stringing' : 'home';
}

/**
 * The Notifications page (`docs/plans/notification-center.md`), opened from the
 * bell beside the language and theme toggles, or from Profile's Notifications
 * row. Push settings at the top; below, what the club told this person, newest
 * first, in their own language.
 *
 * Opening it marks everything seen — but the rows that were new when it opened
 * keep their dot for this visit, so the reader can still tell which ones those
 * were.
 */
export default function NotificationsPage({ onBack, onNavigate, push, isAdmin, migrateOn }: Props) {
  const t = useTranslations('notifications');
  const format = useFormatter();
  const now = useNow({ updateInterval: 60_000 });
  const online = useOnline();
  const { status, notices } = useNotices();
  const [installOpen, setInstallOpen] = useState(false);
  const [migrateOpen, setMigrateOpen] = useState(false);
  /** The stamp as it stood when the page opened; `undefined` until read. */
  const [newSince, setNewSince] = useState<string | null | undefined>(undefined);

  // Read, remember what was new, then mark it seen. Once per opening.
  useEffect(() => {
    let live = true;
    void refreshNotices().then(() => {
      const snap = getNotices();
      if (!live || snap.status !== 'ready') return;
      setNewSince(snap.seenAt);
      if (snap.unread > 0) void markNoticesSeen();
    });
    return () => {
      live = false;
    };
  }, []);

  // Android's back button closes the page, as it closes a sheet, rather than
  // jumping Home or leaving the app.
  useEffect(() => registerOpenSheet(onBack), [onBack]);

  function title(n: Notice): string {
    switch (n.type) {
      case 'signups_open': return t('signupsOpenTitle');
      case 'promoted': return t('promotedTitle');
      case 'stringing': return n.stage === 'ready_for_you' ? t('stringingReadyTitle') : t('stringingOnTitle');
      case 'stringing_change': return t('stringingChangeTitle');
      case 'announcement': return t('announcementTitle');
      case 'settle_up': return t('settleUpTitle');
    }
  }

  function when(at: string | undefined): string | null {
    if (!at) return null;
    const d = new Date(at);
    if (Number.isNaN(d.getTime())) return null;
    // Session times are Vancouver time, whatever the reader's zone (CLAUDE.md).
    return format.dateTime(d, { weekday: 'long', month: 'short', day: 'numeric', timeZone: 'America/Vancouver' });
  }

  function body(n: Notice): string {
    const racket = n.racketLabel || t('racketFallback');
    switch (n.type) {
      case 'signups_open': {
        const w = when(n.sessionAt);
        return w ? t('signupsOpenBody', { when: w }) : t('signupsOpenBodyNoDate');
      }
      case 'promoted': {
        const w = when(n.sessionAt);
        return w ? t('promotedBody', { when: w }) : t('promotedBodyNoDate');
      }
      case 'stringing':
        return n.stage === 'ready_for_you' ? t('stringingReadyBody', { racket }) : t('stringingOnBody', { racket });
      case 'stringing_change':
        return t('stringingChangeBody', { racket });
      case 'announcement':
        return n.text || t('announcementBodyEmpty');
      case 'settle_up':
        return t('settleUpBody', { count: n.count ?? 1 });
    }
  }

  function list() {
    if (status === 'loading' && notices.length === 0) {
      return <CardSkeleton height={220} />;
    }
    if (status === 'error' && notices.length === 0) {
      return (
        <ErrorState
          message={t('loadError')}
          action={
            <button type="button" className="cc-btn cc-btn-ghost" disabled={!online} onClick={() => void refreshNotices()}>
              {t('retry')}
            </button>
          }
        />
      );
    }
    if (notices.length === 0) {
      return (
        <div className="glass-card p-5">
          <EmptyState icon="notifications">{t('empty')}</EmptyState>
        </div>
      );
    }
    return (
      <ul className="glass-card notice-list" aria-label={t('recent')}>
        {notices.map((n) => {
          const isNew = newSince !== undefined && (newSince === null || n.at > newSince);
          return (
            <li key={n.id}>
              <button type="button" className="notice-row" onClick={() => onNavigate(tabOf(n))}>
                <span className="material-icons icon-md notice-row-icon" aria-hidden>{ICONS[n.type]}</span>
                <span className="notice-row-text">
                  <span className="notice-row-title fs-md">
                    {title(n)}
                    {isNew && <span className="notice-new-dot" role="img" aria-label={t('new')} />}
                  </span>
                  <span className="notice-row-body fs-sm">{body(n)}</span>
                  <span className="notice-row-time fs-xs">{format.relativeTime(new Date(n.at), now)}</span>
                </span>
              </button>
            </li>
          );
        })}
      </ul>
    );
  }

  return (
    // Not wrapped in a header-only element: TopBar is sticky (StatsPrivacyScreen).
    <div className="animate-slideInRight space-y-5">
      <TopBar title={t('title')} onBack={onBack} backLabel={t('back')} />

      <div className="glass-card p-5">
        <PushSettings
          push={push}
          isAdmin={isAdmin}
          onOpenInstall={() => setInstallOpen(true)}
          onOpenMigrate={migrateOn ? () => setMigrateOpen(true) : undefined}
        />
      </div>

      <section className="space-y-3">
        <p className="section-label-muted">{t('recent')}</p>
        {list()}
      </section>

      <InstallSheet open={installOpen} onClose={() => setInstallOpen(false)} />
      {migrateOn && <MigrateSheet open={migrateOpen} onClose={() => setMigrateOpen(false)} />}
    </div>
  );
}
