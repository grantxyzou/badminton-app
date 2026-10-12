'use client';

import { useEffect, useState } from 'react';
import dynamic from 'next/dynamic';
import { useTranslations } from 'next-intl';
import PageHeader from '@/components/primitives/PageHeader';
import RegisterSwitch from '@/components/primitives/RegisterSwitch';
import CardSkeleton, { AdminPageSkeleton } from '@/components/primitives/CardSkeleton';
import { RevealGroup, RevealSlot } from '@/components/primitives/Reveal';
import StringingCard from '@/components/stringing/StringingCard';
import StringerJobsCard from '@/components/stringing/StringerJobsCard';
import StringsWeOfferCard from '@/components/stringing/StringsWeOfferCard';
import { getIdentity, IDENTITY_EVENT } from '@/lib/identity';
import { isFlagOn } from '@/lib/flags';
import AdminErrorBoundary from '@/components/AdminErrorBoundary';
import { STRINGING_HEIGHTS } from '@/components/TabFallbacks';

const BASE = process.env.NEXT_PUBLIC_BASE_PATH ?? '';

// Admin code, so it stays out of the tab's chunk until an admin opens the
// Bench (the bundle-split rule HomeShell keeps for whole tabs).
const StringingPage = dynamic(() => import('@/components/admin/CommandCenter/StringingPage'), {
  ssr: false,
  loading: () => <AdminPageSkeleton />,
});

export type StringingView = 'racket' | 'strings' | 'bench';

/**
 * The Stringing tab, in the nav slot Sign-Ups used to hold (2026-09-16), as
 * registers like Stats (docs/plans/stringing-tabs.md; Grant, 2026-10-12: "can
 * you add tabs to the stringing page like the stats page?").
 *
 *   - Racket: the service card. Request a restring, and follow the one you
 *     have. It is the default, because that is why most people open the tab.
 *   - Strings: the shelf, with every price on it. The service card's "View
 *     pricing" expander listed them a second time and went.
 *   - Bench: only for someone who strings. An admin gets the bench itself,
 *     inline; its sub-screens take the whole tab over. A stringer who is not
 *     an admin gets their own queue.
 *
 * The cards keep their own gates: `StringingCard` shows "Coming soon" until an
 * admin opens the shop (and while that answer is unknown).
 */
interface Props {
  /** HomeShell's server-checked admin verdict; the bench routes re-check it anyway. */
  isAdmin?: boolean;
  /** The register, owned by HomeShell above this tab's refresh key so a
   *  pull-to-refresh keeps it. Uncontrolled (Racket first) without it. */
  view?: StringingView;
  onViewChange?: (view: StringingView) => void;
}

export default function StringingTab({ isAdmin = false, view: controlled, onViewChange }: Props) {
  const tNav = useTranslations('nav');
  const t = useTranslations('home.stringing.registers');
  const [uncontrolled, setUncontrolled] = useState<StringingView>('racket');
  const view = controlled ?? uncontrolled;
  const setView = onViewChange ?? setUncontrolled;
  // A bench sub-screen (a job, intake, the archive, set-up) stands in for the
  // whole tab: the header and switch hide, the Bench register stays mounted
  // underneath so the bench keeps its data.
  const [takeover, setTakeover] = useState(false);

  // Read after mount: identity lives in localStorage, which SSR cannot see.
  // `identityRead` is the "not known yet" half, so a stringer coming back to
  // their Bench waits for it instead of painting Racket for a frame.
  const [hasIdentity, setHasIdentity] = useState(false);
  const [identityRead, setIdentityRead] = useState(false);
  useEffect(() => {
    const read = () => {
      setHasIdentity(getIdentity() !== null);
      setIdentityRead(true);
    };
    read();
    window.addEventListener(IDENTITY_EVENT, read);
    return () => window.removeEventListener(IDENTITY_EVENT, read);
  }, []);

  const flagOn = isFlagOn('NEXT_PUBLIC_FLAG_STRINGING');
  const adminBench = isAdmin && flagOn;
  /* Whether a member who is not an admin strings for the club. null = not
     known yet. Asked once; the answer is the stringer read's `canString`, so a
     stringer with nothing assigned still gets their Bench. Anything short of a
     confirmed yes offers no Bench: a tab that opens onto a refusal is worse
     than none. */
  const [stringer, setStringer] = useState<boolean | null>(null);
  useEffect(() => {
    if (!flagOn || isAdmin || !hasIdentity) return;
    let cancelled = false;
    fetch(`${BASE}/api/stringing/jobs?view=stringer`, { cache: 'no-store' })
      .then((r) => (r.ok ? r.json() : null))
      .then((d) => { if (!cancelled) setStringer(d?.canString === true); })
      .catch(() => { if (!cancelled) setStringer(false); });
    return () => { cancelled = true; };
  }, [flagOn, isAdmin, hasIdentity]);

  const benchOn = adminBench || stringer === true;
  const views: StringingView[] = benchOn ? ['racket', 'strings', 'bench'] : ['racket', 'strings'];
  // A Bench remembered for someone who no longer has one opens on Racket.
  // While a stringer's answer is still out it waits, rather than flashing
  // Racket and then jumping.
  const benchPending =
    view === 'bench' && !adminBench && flagOn && (!identityRead || (hasIdentity && stringer === null));
  const current: StringingView = views.includes(view) || benchPending ? view : 'racket';

  return (
    <div className="space-y-5 w-full">
      {/* PageHeader must stay a direct child of the tall scroll root or its
          `position: sticky` un-sticks. */}
      {!takeover && <PageHeader>{tNav('stringing')}</PageHeader>}
      {!takeover && (
        <RegisterSwitch views={views} value={current} onChange={setView} label={(id) => t(id)} ariaLabel={tNav('stringing')} />
      )}

      {/* Keyed by register so a switch remounts and crossfades (opacity only:
          the register is replaced, it moves nowhere), as on Stats. */}
      <div key={current} className="motion-fade">
        {current === 'racket' && (
          <RevealGroup>
            <RevealSlot placeholder={<CardSkeleton height={STRINGING_HEIGHTS.service} />}>
              <StringingCard hasIdentity={hasIdentity} onShowStrings={() => setView('strings')} />
            </RevealSlot>
          </RevealGroup>
        )}

        {current === 'strings' && (
          <RevealGroup>
            <RevealSlot placeholder={<CardSkeleton height={STRINGING_HEIGHTS.shelf} />}>
              <StringsWeOfferCard showEmpty />
            </RevealSlot>
          </RevealGroup>
        )}

        {current === 'bench' && benchPending && <CardSkeleton height={STRINGING_HEIGHTS.service} />}

        {current === 'bench' && adminBench && (
          <AdminErrorBoundary>
            <StringingPage embedded crumb={tNav('stringing')} onBack={() => setView('racket')} onTakeover={setTakeover} />
          </AdminErrorBoundary>
        )}

        {current === 'bench' && !adminBench && stringer === true && (
          <RevealGroup>
            <RevealSlot placeholder={<CardSkeleton height={STRINGING_HEIGHTS.service} />}>
              <StringerJobsCard hasIdentity={hasIdentity} showEmpty />
            </RevealSlot>
          </RevealGroup>
        )}
      </div>
    </div>
  );
}
