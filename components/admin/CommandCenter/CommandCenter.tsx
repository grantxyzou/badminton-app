'use client';

import { useState } from 'react';
import { useTranslations } from 'next-intl';
import PageHeader from '../../primitives/PageHeader';
import AnomalyFeed from './AnomalyFeed';
import NextSessionCard from './NextSessionCard';
import PaymentsCard from './PaymentsCard';
import BirdInventoryCard from './BirdInventoryCard';
import RosterHealthCard from './RosterHealthCard';
import RecentSessionsStrip from './RecentSessionsStrip';

interface CommandCenterProps {
  /** Same prop the legacy Dashboard uses — bumped when admin returns from a drill-in. */
  refreshKey: number;
  /** Same drill-in router as the legacy Dashboard. */
  setView: (v: string) => void;
}

/**
 * The new admin landing surface — a stack of cards that surfaces state
 * across every admin domain (session, payments, birds, roster) so the
 * organizer can confirm "everything looks right" in 30 seconds.
 *
 * Currently behind NEXT_PUBLIC_FLAG_COMMAND_CENTER. Cards are added one at
 * a time; until they're all live, this component renders alongside the
 * legacy Dashboard depending on the flag.
 */
export default function CommandCenter({ refreshKey, setView: _setView }: CommandCenterProps) {
  const pageT = useTranslations('pages.admin');
  // Local refresh — bumped when an action inside a card needs the feed to refetch.
  const [localRefresh, setLocalRefresh] = useState(0);
  const composedRefresh = refreshKey + localRefresh;

  return (
    <div className="space-y-5 w-full">
      <PageHeader>{pageT('title')}</PageHeader>

      <AnomalyFeed refreshKey={composedRefresh} />
      <NextSessionCard refreshKey={composedRefresh} />
      <PaymentsCard refreshKey={composedRefresh} />
      <BirdInventoryCard />
      <RosterHealthCard />
      <RecentSessionsStrip />

      {/* Hidden bump, exposed via window for test/dev — not used in real flow. */}
      <button type="button" hidden onClick={() => setLocalRefresh((n) => n + 1)} />
    </div>
  );
}

