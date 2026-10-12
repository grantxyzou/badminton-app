'use client';

import { useEffect, useState } from 'react';
import dynamic from 'next/dynamic';
import { useTranslations } from 'next-intl';
import PageHeader from '@/components/primitives/PageHeader';
import CardSkeleton from '@/components/primitives/CardSkeleton';
import { RevealGroup, RevealSlot } from '@/components/primitives/Reveal';
import StringingCard from '@/components/stringing/StringingCard';
import StringerJobsCard from '@/components/stringing/StringerJobsCard';
import StringsWeOfferCard from '@/components/stringing/StringsWeOfferCard';
import { getIdentity, IDENTITY_EVENT } from '@/lib/identity';
import { isFlagOn } from '@/lib/flags';
import { AdminPageSkeleton } from '@/components/primitives/CardSkeleton';
import AdminErrorBoundary from '@/components/AdminErrorBoundary';
import BenchEntryRow from '@/components/stringing/BenchEntryRow';

// Admin code, so it stays out of the tab's chunk until an admin opens it
// (the bundle-split rule HomeShell keeps for whole tabs).
const StringingPage = dynamic(() => import('@/components/admin/CommandCenter/StringingPage'), {
  ssr: false,
  loading: () => <AdminPageSkeleton />,
});

/**
 * The Stringing tab, in the nav slot Sign-Ups used to hold (2026-09-16).
 *
 * Sign-Ups left the nav because Home's sign-up card now carries everything that
 * tab did: who is in (numbered, with the waitlist), cancelling your spot, and
 * kudos per name. Stringing was a card at the bottom of Home's account group,
 * below the week's actual decision; as a tab it has room for a job's progress
 * without competing with it.
 *
 * Both cards keep their own gates: `StringingCard` shows "Coming soon" until an
 * admin opens the shop (and while that answer is unknown), and
 * `StringerJobsCard` renders only for someone with work assigned.
 */
interface Props {
  /** HomeShell's server-checked admin verdict; the bench routes re-check it anyway. */
  isAdmin?: boolean;
  /** Whether the bench is open IN this tab. Owned by HomeShell, above this
   *  tab's refresh key, so a pull-to-refresh does not drop the admin back to
   *  the tab's root (docs/plans/bench-redesign.md). */
  benchOpen?: boolean;
  onBenchOpenChange?: (open: boolean) => void;
}

export default function StringingTab({ isAdmin = false, benchOpen = false, onBenchOpenChange }: Props) {
  const tNav = useTranslations('nav');
  const benchOn = isAdmin && isFlagOn('NEXT_PUBLIC_FLAG_STRINGING') && !!onBenchOpenChange;
  // Read after mount: identity lives in localStorage, which SSR cannot see.
  const [hasIdentity, setHasIdentity] = useState(false);
  useEffect(() => {
    const read = () => setHasIdentity(getIdentity() !== null);
    read();
    window.addEventListener(IDENTITY_EVENT, read);
    return () => window.removeEventListener(IDENTITY_EVENT, read);
  }, []);

  // The bench, opened from this tab: the nav keeps Stringing lit and Back
  // returns here. The Command Center's own row still opens it under Admin.
  if (benchOn && benchOpen) {
    return (
      <AdminErrorBoundary>
        <div className="animate-slideInRight">
          <StringingPage onBack={() => onBenchOpenChange!(false)} crumb={tNav('stringing')} />
        </div>
      </AdminErrorBoundary>
    );
  }

  return (
    <div className="space-y-5">
      <PageHeader>{tNav('stringing')}</PageHeader>
      {benchOn && <BenchEntryRow onOpen={() => onBenchOpenChange!(true)} />}
      {/* Loading cascade: the shop card first, then the stringer's queue (only
          ever there for the stringer), each holding its place. A flex gap so a
          closed slot leaves none. */}
      <div className="flex flex-col gap-4">
        <RevealGroup>
          <RevealSlot placeholder={<CardSkeleton height={84} />}>
            <StringingCard hasIdentity={hasIdentity} />
          </RevealSlot>
          <RevealSlot canBeEmpty placeholder={null}>
            <StringerJobsCard hasIdentity={hasIdentity} />
          </RevealSlot>
          {/* The strings on the shelf, explained (docs/plans/string-inventory.md).
              Absent until the club lists some, so it holds its order and no space. */}
          <RevealSlot canBeEmpty placeholder={null}>
            <StringsWeOfferCard />
          </RevealSlot>
        </RevealGroup>
      </div>
    </div>
  );
}
