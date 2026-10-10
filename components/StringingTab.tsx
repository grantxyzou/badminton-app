'use client';

import { useEffect, useState } from 'react';
import { useTranslations } from 'next-intl';
import PageHeader from '@/components/primitives/PageHeader';
import CardSkeleton from '@/components/primitives/CardSkeleton';
import { RevealGroup, RevealSlot } from '@/components/primitives/Reveal';
import StringingCard from '@/components/stringing/StringingCard';
import StringerJobsCard from '@/components/stringing/StringerJobsCard';
import StringsWeOfferCard from '@/components/stringing/StringsWeOfferCard';
import { getIdentity, IDENTITY_EVENT } from '@/lib/identity';

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
export default function StringingTab() {
  const tNav = useTranslations('nav');
  // Read after mount: identity lives in localStorage, which SSR cannot see.
  const [hasIdentity, setHasIdentity] = useState(false);
  useEffect(() => {
    const read = () => setHasIdentity(getIdentity() !== null);
    read();
    window.addEventListener(IDENTITY_EVENT, read);
    return () => window.removeEventListener(IDENTITY_EVENT, read);
  }, []);

  return (
    <div className="space-y-5">
      <PageHeader>{tNav('stringing')}</PageHeader>
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
