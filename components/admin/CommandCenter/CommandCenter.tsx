'use client';

import { useState } from 'react';
import { useTranslations } from 'next-intl';
import PageHeader from '../../primitives/PageHeader';
import AnomalyFeed from './AnomalyFeed';

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

      {/* Placeholder cards — will be replaced as cards are built in plans 2B-ii / 2B-iii */}
      <CommandCenterPlaceholder
        title="Next session"
        hint="Coming soon — capacity, deadline, signup status at a glance."
      />
      <CommandCenterPlaceholder
        title="Payments"
        hint="Coming soon — paid/pending grid, group receipt export."
      />
      <CommandCenterPlaceholder
        title="Bird inventory"
        hint="Coming soon — tubes on hand, weeks remaining at current burn rate."
      />
      <CommandCenterPlaceholder
        title="Roster health"
        hint="Coming soon — invite list, waitlist, recent removals."
      />
      <CommandCenterPlaceholder
        title="Recent sessions"
        hint="Coming soon — last 6 sessions with attendance + paid %."
      />

      {/* Hidden bump, exposed via window for test/dev — not used in real flow. */}
      <button type="button" hidden onClick={() => setLocalRefresh((n) => n + 1)} />
    </div>
  );
}

function CommandCenterPlaceholder({ title, hint }: { title: string; hint: string }) {
  return (
    <section className="glass-card p-4 space-y-1 opacity-60" aria-label={title}>
      <h3 className="bpm-h3">{title}</h3>
      <p className="text-xs text-gray-400">{hint}</p>
    </section>
  );
}
