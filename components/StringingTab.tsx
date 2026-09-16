'use client';

import { useEffect, useState } from 'react';
import { useTranslations } from 'next-intl';
import PageHeader from '@/components/primitives/PageHeader';
import StringingCard from '@/components/stringing/StringingCard';
import StringerJobsCard from '@/components/stringing/StringerJobsCard';
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
      <div className="space-y-4">
        <StringingCard hasIdentity={hasIdentity} />
        <StringerJobsCard hasIdentity={hasIdentity} />
      </div>
    </div>
  );
}
