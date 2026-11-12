'use client';

import { useEffect, useRef, useState, type ReactNode } from 'react';
import { useFormatter, useNow, useTranslations } from 'next-intl';
import TopBar from '@/components/primitives/TopBar';
import CardSkeleton from '@/components/primitives/CardSkeleton';
import ErrorState from '@/components/primitives/ErrorState';
import EmptyState from '@/components/primitives/EmptyState';
import CardHeader from '@/components/primitives/CardHeader';
import { NOTICES_LIST_H } from '@/components/TabFallbacks';
import PushSettings from './PushSettings';
import InstallSheet from './InstallSheet';
import MigrateSheet from './MigrateSheet';
import { registerOpenSheet } from '@/lib/sheetStack';
import { useOnline } from '@/lib/useOnline';
import { usePaneMode } from '@/lib/paneMode';
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
  /** Web, with the native-migrate flag on: the page leads with the store app
   *  instead of a push switch (Grant: notifications are turned on IN the app).
   *  False in the store app, so there the push switch leads. */
  migrateOn: boolean;
}

const ICONS: Record<Notice['type'], string> = {
  signups_open: 'event',
  promoted: 'how_to_reg',
  stringing: 'sports_tennis',
  stringing_change: 'fact_check',
  announcement: 'campaign',
  settle_up: 'payments',
  member_joined: 'group_add',
};

/** The first loading frame (measured; `TabFallbacks.tsx` holds the number so
 *  the code-loading frame matches). The bell has usually read the list already. */
const LIST_SKELETON_H = NOTICES_LIST_H;

/** Later groups trail the first by one stagger step (loading cascade). */
const GROUP_STAGGER_MS = 40;

function tabOf(n: Notice): NoticeTab {
  return n.type === 'stringing' || n.type === 'stringing_change' ? 'stringing' : 'home';
}

/**
 * The Notifications page (`docs/plans/notification-center.md`), opened from the
 * bell beside the language and theme toggles, or from Profile's Notifications
 * row. At the top: in the store app, the push switch; on the web, a card for
 * the store app — turning notifications on happens there (Grant, 2026-11-04).
 * Below, what the club told this person, newest first, in their own language.
 *
 * Opening it marks everything seen — but what was new when it opened stays
 * under "New" for this visit, above "Earlier", so the reader can still tell.
 * A label, not a red dot per row: red means failure in this app (CLAUDE.md,
 * "Accent is currency"); the bell's dot is the one sanctioned exception.
 */
export default function NotificationsPage({ onBack, onNavigate, push, isAdmin, migrateOn }: Props) {
  const t = useTranslations('notifications');
  const tp = useTranslations('profile.push');
  const format = useFormatter();
  const now = useNow({ updateInterval: 60_000 });
  const online = useOnline();
  const pane = usePaneMode();
  const { status, notices } = useNotices();
  const [installOpen, setInstallOpen] = useState(false);
  const [migrateOpen, setMigrateOpen] = useState(false);
  /** The stamp as it stood when the page opened; `undefined` until read.
   *  Seeded from the bell's read so the groups do not reshuffle on arrival. */
  const [newSince, setNewSince] = useState<string | null | undefined>(() => {
    const snap = getNotices();
    return snap.status === 'ready' ? snap.seenAt : undefined;
  });
  const rootRef = useRef<HTMLDivElement>(null);

  // A full page took the screen: move focus onto it (its Back button), and
  // hand it back to whatever opened it — the bell — on the way out.
  useEffect(() => {
    const opener = document.activeElement;
    rootRef.current?.querySelector<HTMLElement>('button')?.focus({ preventScroll: true });
    return () => {
      if (opener instanceof HTMLElement && opener.isConnected) opener.focus({ preventScroll: true });
    };
  }, []);

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
      case 'member_joined': return t('memberJoinedTitle');
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
      case 'member_joined': {
        const name = n.memberName || t('someoneNew');
        return n.club ? t('memberJoinedBody', { name, club: n.club }) : t('memberJoinedBodyNoClub', { name });
      }
    }
  }

  function row(n: Notice) {
    return (
      <li key={n.id}>
        <button type="button" className="notice-row" onClick={() => onNavigate(tabOf(n))}>
          <span className="material-icons icon-md notice-row-icon" aria-hidden>{ICONS[n.type]}</span>
          <span className="notice-row-text">
            <span className="notice-row-title fs-md">{title(n)}</span>
            <span className="notice-row-body fs-sm">{body(n)}</span>
            <span className="notice-row-time fs-xs">{format.relativeTime(new Date(n.at), now)}</span>
          </span>
        </button>
      </li>
    );
  }

  /** A labelled section; the label stays above whatever state is below it. */
  function group(label: string, content: ReactNode, index = 0) {
    return (
      <section
        key={label}
        className="space-y-3 motion-fade"
        style={index > 0 ? { animationDelay: `${index * GROUP_STAGGER_MS}ms` } : undefined}
      >
        <p className="section-label-muted">{label}</p>
        {content}
      </section>
    );
  }

  function list() {
    if (status === 'loading' && notices.length === 0) {
      return group(t('recent'), <CardSkeleton height={LIST_SKELETON_H} />);
    }
    if (status === 'error' && notices.length === 0) {
      return group(
        t('recent'),
        <ErrorState
          message={t('loadError')}
          action={
            <button type="button" className="cc-btn cc-btn-ghost" disabled={!online} onClick={() => void refreshNotices()}>
              {t('retry')}
            </button>
          }
        />,
      );
    }
    if (notices.length === 0) {
      return group(
        t('recent'),
        <div className="glass-card p-5">
          <EmptyState icon="notifications">{t('empty')}</EmptyState>
        </div>,
      );
    }
    const isNew = (n: Notice) => newSince !== undefined && (newSince === null || n.at > newSince);
    const fresh = notices.filter(isNew);
    const older = notices.filter((n) => !isNew(n));
    const groups = [
      { label: t('new'), items: fresh },
      // "Earlier" only means something under "New"; on its own it is "Recent".
      { label: fresh.length > 0 ? t('earlier') : t('recent'), items: older },
    ].filter((g) => g.items.length > 0);
    return groups.map((g, i) =>
      group(
        g.label,
        <ul className="glass-card notice-list" aria-label={g.label}>{g.items.map(row)}</ul>,
        i,
      ),
    );
  }

  const showPushCard = !migrateOn || push.state.status === 'on';
  /* An open foldable (docs/plans/foldable-layout.md): the title and this
     phone's settings on the LEFT page, the Recent list on the RIGHT, rather
     than one column across the fold. With no setting to show there is no
     left page to fill, and the page keeps its one column. */
  const twoPages = pane && (migrateOn || showPushCard);
  const settings = (
    <>
      {migrateOn && (
        // A flex gap, not space-y: the body's inline margin would cancel it.
        <div className="glass-card p-5 flex flex-col gap-3">
          <CardHeader icon="install_mobile" title={tp('appTitle')} />
          <p className="fs-md" style={{ color: 'var(--text-primary)', margin: 0 }}>{tp('appBody')}</p>
          {/* The member-facing filled CTA (CLAUDE.md: `.btn-primary`, not the
              tinted admin `.cc-btn-primary`). It is this page's one action. */}
          <button type="button" className="btn-primary w-full" onClick={() => setMigrateOpen(true)}>
            {tp('appCta')}
          </button>
        </div>
      )}

      {/* The push switch: always in the store app; on the web only for a
          browser that already has push on, so it can still be turned off. */}
      {showPushCard && (
        <div className="glass-card p-5">
          <PushSettings push={push} isAdmin={isAdmin} onOpenInstall={() => setInstallOpen(true)} />
        </div>
      )}
    </>
  );

  return (
    // Not wrapped in a header-only element: TopBar is sticky (StatsPrivacyScreen).
    <div ref={rootRef} className={twoPages ? 'animate-slideInRight space-y-5 notices-shell' : 'animate-slideInRight space-y-5'}>
      <TopBar title={t('title')} onBack={onBack} backLabel={t('back')} />

      {twoPages ? <div className="space-y-5 notices-settings">{settings}</div> : settings}

      {twoPages ? <div className="notices-recent">{list()}</div> : list()}

      <InstallSheet open={installOpen} onClose={() => setInstallOpen(false)} />
      {migrateOn && <MigrateSheet open={migrateOpen} onClose={() => setMigrateOpen(false)} />}
    </div>
  );
}
