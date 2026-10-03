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
 * StatsV2Shell: header + subhead, the OverviewStrip (115px), the register
 * switch (32px), then the You register's two skeletons (SkillTrendCard 320,
 * WhereYouSitCard 180) in the order they finally sit.
 */
export function StatsFallback() {
  const t = useTranslations('stats');
  return (
    <div className="space-y-5 w-full" role="status" aria-label="Loading">
      <PageHeader>{t('heading')}</PageHeader>
      <p className="fs-md text-gray-400 px-2" style={{ marginTop: 'var(--space-1)' }}>
        {t('subheadV2')}
      </p>
      <div className="grid grid-cols-3 gap-3">
        <CardSkeleton height={115} />
        <CardSkeleton height={115} />
        <CardSkeleton height={115} />
      </div>
      <div className="segment-control w-full" style={{ height: 32 }} aria-hidden="true" />
      <div className="space-y-5">
        <CardSkeleton height={320} />
        <CardSkeleton height={180} />
      </div>
    </div>
  );
}

/** ProfileTab's `profile-loading` branch, exactly. */
export function ProfileFallback() {
  const tNav = useTranslations('nav');
  return (
    <div className="flex flex-col gap-4" role="status" aria-label="Loading">
      <PageHeader>{tNav('profile')}</PageHeader>
      <CardSkeleton height={220} />
    </div>
  );
}

/** AdminTab's auth-check branch, exactly. */
export function AdminFallback() {
  const pageT = useTranslations('pages.admin');
  return (
    <div className="space-y-5" role="status" aria-label="Loading">
      <PageHeader>{pageT('title')}</PageHeader>
      <AdminTabSkeleton />
    </div>
  );
}
