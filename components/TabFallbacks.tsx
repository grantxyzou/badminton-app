'use client';

import { useTranslations } from 'next-intl';
import PageHeader from '@/components/primitives/PageHeader';
import CardSkeleton, { AdminTabSkeleton } from '@/components/primitives/CardSkeleton';

/**
 * What a lazy tab shows while its JavaScript chunk downloads (`HomeShell`'s
 * `dynamic()` fallbacks) — loading cascade, phase 1.
 *
 * Each one is a copy of THAT TAB'S OWN first loading frame: same header, same
 * wrapper spacing, same skeleton heights. So the hand-off from "chunk loading"
 * to "tab loading" changes nothing on screen. These used to borrow Home's
 * `TabSkeleton` (a tile row and two Home cards, no header), and Admin had no
 * fallback at all — the page went blank.
 *
 * Heights measured from the running app at 400px wide, 2026-10-03. When a
 * tab's own first frame changes, change its copy here.
 */

/** StringingTab: header, then the shop card (84px in its "Coming soon" state). */
export function StringingFallback() {
  const tNav = useTranslations('nav');
  return (
    <div className="space-y-5" role="status" aria-label="Loading">
      <PageHeader>{tNav('stringing')}</PageHeader>
      <div className="space-y-4">
        <CardSkeleton height={84} />
      </div>
    </div>
  );
}

/**
 * Placeholder heights for the Stats You and Play registers' RevealSlots,
 * measured at 400px (2026-10-03). They live HERE, not in SkillsTab, so the
 * chunk fallback below and the register it hands over to read one set of
 * numbers — and so HomeShell's import of this file does not pull the Stats
 * chunk into the first download.
 */
export const STATS_HEIGHTS = {
  greeting: 94,
  // 240 empty (a first-time member's "rate your skills") to 680+ with data:
  // no one height fits, and the empty case is the first impression.
  trend: 320,
  whereYouSit: 192,
  kudosReceived: 140,
  record: 201,
  playWith: 212,
  giveKudos: 112,
} as const;

/**
 * StatsV2Shell: header + subhead, the OverviewStrip (98px while loading), the register
 * switch (32px), then the You register's slots exactly as its first frame
 * draws them (STATS_HEIGHTS). It was written before the register became a
 * RevealGroup and drifted (no greeting slot, 180 not 192), so the chunk
 * arriving moved the page.
 */
export function StatsFallback() {
  const t = useTranslations('stats');
  return (
    <div className="space-y-5 w-full" role="status" aria-label="Loading">
      <PageHeader>{t('heading')}</PageHeader>
      <p className="fs-md text-gray-400 px-2" style={{ marginTop: 'var(--space-1)' }}>
        {t('subheadV2')}
      </p>
      {/* 98: the OverviewStrip's OWN loading height (blank captions), which is
          the frame this hands over to. Loaded it can grow to 115 when a level
          trend wraps to a second line — data, not loading, decides that. */}
      <div className="grid grid-cols-3 gap-3">
        <CardSkeleton height={98} />
        <CardSkeleton height={98} />
        <CardSkeleton height={98} />
      </div>
      <div className="segment-control w-full" style={{ height: 32 }} aria-hidden="true" />
      <div className="flex flex-col gap-5">
        <CardSkeleton height={STATS_HEIGHTS.greeting} />
        <CardSkeleton height={STATS_HEIGHTS.trend} />
        <CardSkeleton height={STATS_HEIGHTS.whereYouSit} />
        <CardSkeleton height={STATS_HEIGHTS.kudosReceived} />
      </div>
    </div>
  );
}

/**
 * The member Profile page's shape: header, the identity card (84), then the
 * first two settings groups, each an eyebrow label over its list (195, 97).
 * Measured at 400px, 2026-10-03. It used to be one 220px block, which matched
 * nothing on the page it stood in for.
 */
export function ProfileSkeleton({ title }: { title: string }) {
  const label = (
    <div style={{ height: 22, display: 'flex', alignItems: 'center' }} aria-hidden="true">
      <div className="shimmer-line rounded-lg" style={{ height: 10, width: '30%' }} />
    </div>
  );
  return (
    <div className="flex flex-col gap-4" role="status" aria-label="Loading">
      <PageHeader>{title}</PageHeader>
      <CardSkeleton height={84} />
      {label}
      <CardSkeleton height={195} />
      {label}
      <CardSkeleton height={97} />
    </div>
  );
}

/** ProfileTab's own loading frame, exactly. */
export function ProfileFallback() {
  const tNav = useTranslations('nav');
  return <ProfileSkeleton title={tNav('profile')} />;
}

/**
 * AdminTab's auth-check branch: the console's TopBar, then its skeleton.
 *
 * The bar is a static copy of `<TopBar>`'s markup with an INERT chevron: a
 * chunk fallback gets no props, so it has no back action to give the button,
 * and a working-looking button that did nothing would be worse than a glyph.
 * It is on screen only while the admin chunk downloads.
 */
export function AdminFallback() {
  const pageT = useTranslations('pages.admin');
  return (
    <div className="space-y-5" role="status" aria-label="Loading">
      <div className="bpm-topbar">
        <span className="bpm-topbar__back" aria-hidden="true">
          <span className="material-icons" aria-hidden="true">chevron_left</span>
        </span>
        <div className="bpm-topbar__col">
          <h1 className="bpm-topbar__title">{pageT('title')}</h1>
        </div>
      </div>
      <AdminTabSkeleton />
    </div>
  );
}
