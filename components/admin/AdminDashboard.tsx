'use client';

import { useState, useCallback, useEffect } from 'react';
import type { AdminView } from './types';
import AdvanceSessionForm from './AdvanceSessionForm';
import CatalogGapsPage from './CatalogGapsPage';
import ReleasesView from './ReleasesView';
import CommandCenter from './CommandCenter/CommandCenter';
import BirdsPage from './CommandCenter/BirdsPage';
import RosterPage from './CommandCenter/RosterPage';
import SetupPage from './CommandCenter/SetupPage';
import PastSessionsPage from './CommandCenter/PastSessionsPage';
import StringingPage from './CommandCenter/StringingPage';
import LedgerPage from './LedgerPage';
import MetricsPage from './MetricsPage';
import PaymentsCard from './CommandCenter/PaymentsCard';
import AdminBackHeader from './AdminBackHeader';
import InviteCard from './CommandCenter/InviteCard';
import GiftCardsCard from './CommandCenter/GiftCardsCard';
import SignInReadinessCard from './CommandCenter/SignInReadinessCard';
import PaymentsInboxCard from './CommandCenter/PaymentsInboxCard';
import type { FilterKey as RosterFilter } from './CommandCenter/RosterPage';
import { useCurrentGroup } from '@/lib/useCurrentGroup';
import AnnouncementsCard from './CommandCenter/AnnouncementsCard';
import ETransferRecipientEditor from './CommandCenter/ETransferRecipientEditor';
import SkipDatesEditor from './CommandCenter/SkipDatesEditor';
import LateCancelEditor from './CommandCenter/LateCancelEditor';
import { isFlagOn } from '@/lib/flags';

/*
 * The admin subtree's router. Every view is a Command Center page; the
 * pre-Command-Center `Dashboard` (and the SessionDetailsEditor / DateTimeEditor
 * / MembersView / BirdInventoryView it routed to) lived in this file until the
 * COMMAND_CENTER flag was retired in September 2026, four months after the
 * Command Center shipped to everyone.
 */

/* ── Main component ── */

/* Where the admin was, across a pull-to-refresh. HomeShell keys the tab on
   its refresh nonce, so a pull remounted this at the dashboard from any
   sub-page (admin audit, 2026-10-12). sessionStorage, like the active tab:
   it survives a refresh, not a new launch. Only views that need nothing else
   to render are restored — Payments needs the session it was opened for. */
const VIEW_KEY = 'badminton_admin_view';
const RESTORABLE: ReadonlySet<AdminView> = new Set<AdminView>([
  'session-details', 'members', 'birds', 'releases', 'ledger', 'announcements', 'etransfer',
  'skip-dates', 'late-cancel', 'past-sessions', 'stringing', 'catalog-gaps', 'metrics', 'invite', 'gift-cards',
  'sign-in-readiness', 'etransfers',
]);
function storeView(v: AdminView | null) {
  try {
    if (v && RESTORABLE.has(v)) sessionStorage.setItem(VIEW_KEY, v);
    else sessionStorage.removeItem(VIEW_KEY);
  } catch { /* private mode: the place is not kept, nothing else changes */ }
}

export default function AdminDashboard({ onExit }: { onExit: () => void }) {
  const [view, setView] = useState<AdminView>('dashboard');
  // Restored after mount, never in the initializer (the HomeShell rule:
  // sessionStorage during hydration is a mismatch).
  useEffect(() => {
    try {
      const saved = sessionStorage.getItem(VIEW_KEY) as AdminView | null;
      if (saved && RESTORABLE.has(saved)) setView(saved);
    } catch { /* nothing to restore */ }
  }, []);
  useEffect(() => { storeView(view); }, [view]);
  const exit = useCallback(() => { storeView(null); onExit(); }, [onExit]);
  const [refreshKey, setRefreshKey] = useState(0);
  // Session the Ledger drilled into; PaymentsCard preselects its chip.
  const [paymentsSessionId, setPaymentsSessionId] = useState<string | null>(null);
  // Member the Roster should open on arrival (from Sign-in readiness), or
  // the filter it opens on (from Needs you's dormant row).
  const [rosterFocus, setRosterFocus] = useState<string | null>(null);
  const [rosterFilter, setRosterFilter] = useState<RosterFilter>('all');
  const { group } = useCurrentGroup();

  // Which way the last move went. A push slides the page in from the right;
  // going BACK used to have no motion at all (the Command Center just cut in).
  // A pop fades rather than sliding from the left: the Command Center renders
  // fixed-position toasts, and a transform on their ancestor would drag them.
  const [popped, setPopped] = useState(false);
  const push = useCallback((next: AdminView) => {
    setPopped(false);
    setView(next);
  }, []);

  const goBack = useCallback(() => {
    setRefreshKey(k => k + 1);
    setPopped(true);
    setView('dashboard');
  }, []);

  // Payments is reached from the Ledger or from Past sessions (itself under
  // the Ledger), so Back retraces the trail rather than jumping home.
  const [paymentsFrom, setPaymentsFrom] = useState<'ledger' | 'past-sessions'>('ledger');
  const goBackTo = useCallback((to: AdminView) => {
    setRefreshKey(k => k + 1);
    setPopped(true);
    setView(to);
  }, []);

  /* ── Drill-down routing ── */
  if (view === 'session-details') {
    return <div className="animate-slideInRight"><SetupPage onBack={goBack} /></div>;
  }
  if (view === 'members') {
    return (
      <div className="animate-slideInRight">
        <RosterPage
          onBack={() => { setRosterFocus(null); setRosterFilter('all'); goBack(); }}
          focusName={rosterFocus}
          initialFilter={rosterFilter}
        />
      </div>
    );
  }
  if (view === 'birds') {
    return <div className="animate-slideInRight"><BirdsPage onBack={goBack} /></div>;
  }
  if (view === 'advance') return <div className="animate-slideInRight"><AdvanceSessionForm onBack={goBack} /></div>;
  if (view === 'releases') return <div className="animate-slideInRight"><ReleasesView onBack={goBack} /></div>;
  if (view === 'catalog-gaps') return <div className="animate-slideInRight"><CatalogGapsPage onBack={goBack} /></div>;
  if (view === 'metrics') return <div className="animate-slideInRight"><MetricsPage onBack={goBack} /></div>;
  // Flag-gated at the route level too — every price on this screen is exact,
  // which is precisely what the player API strips.
  if (view === 'stringing' && isFlagOn('NEXT_PUBLIC_FLAG_STRINGING')) {
    return <div className="animate-slideInRight"><StringingPage onBack={goBack} /></div>;
  }
  if (view === 'ledger') {
    return (
      <div className={popped ? 'motion-fade' : 'animate-slideInRight'}>
        <LedgerPage
          onBack={goBack}
          onOpenSession={(sessionId) => {
            setPaymentsSessionId(sessionId);
            setPaymentsFrom('ledger');
            push('payments');
          }}
          onOpenPastSessions={() => push('past-sessions')}
        />
      </div>
    );
  }
  if (view === 'payments') {
    // Reached from a Ledger row or a Past sessions row.
    return (
      <div className="animate-slideInRight space-y-3">
        <AdminBackHeader onBack={() => goBackTo(paymentsFrom)} title="Payments" />
        <PaymentsCard refreshKey={refreshKey} initialSessionId={paymentsSessionId} />
      </div>
    );
  }
  if (view === 'announcements') {
    return (
      <div className="animate-slideInRight space-y-3">
        <AdminBackHeader onBack={goBack} title="Announcements" />
        <AnnouncementsCard refreshKey={refreshKey} />
      </div>
    );
  }
  if (view === 'etransfer') {
    return (
      <div className="animate-slideInRight space-y-3">
        <AdminBackHeader onBack={goBack} title="E-transfer recipient" />
        <ETransferRecipientEditor />
      </div>
    );
  }
  if (view === 'skip-dates') {
    return (
      <div className="animate-slideInRight space-y-3">
        <AdminBackHeader onBack={goBack} title="Skip dates" />
        <SkipDatesEditor />
      </div>
    );
  }
  if (view === 'late-cancel') {
    return (
      <div className="animate-slideInRight space-y-3">
        <AdminBackHeader onBack={goBack} title="Late cancellations" />
        <LateCancelEditor />
      </div>
    );
  }
  if (view === 'invite') {
    return (
      <div className="animate-slideInRight space-y-3">
        <AdminBackHeader onBack={goBack} title="Invite someone" />
        <InviteCard enabled groupName={group?.name} bare />
      </div>
    );
  }
  if (view === 'gift-cards') {
    return (
      <div className="animate-slideInRight space-y-3">
        <AdminBackHeader onBack={goBack} title="Gift cards" />
        <GiftCardsCard refreshKey={refreshKey} bare />
      </div>
    );
  }
  if (view === 'sign-in-readiness') {
    // A name opens the member in the Roster (recovery code inside); the
    // Roster's Back lands on the console, the same as from Needs you.
    return (
      <div className="animate-slideInRight space-y-3">
        <AdminBackHeader onBack={goBack} title="Sign-in readiness" />
        <SignInReadinessCard refreshKey={refreshKey} standalone onOpenMember={(name) => { setRosterFocus(name); push('members'); }} />
      </div>
    );
  }
  if (view === 'etransfers' && isFlagOn('NEXT_PUBLIC_FLAG_PAYMENTS_AUTO')) {
    return (
      <div className="animate-slideInRight space-y-3">
        <AdminBackHeader onBack={goBack} title="E-transfers" />
        <PaymentsInboxCard refreshKey={refreshKey} standalone onChanged={() => setRefreshKey((k) => k + 1)} />
      </div>
    );
  }
  if (view === 'past-sessions') {
    return (
      <PastSessionsPage
        onBack={() => goBackTo('ledger')}
        onOpenSession={(sessionId) => {
          setPaymentsSessionId(sessionId);
          setPaymentsFrom('past-sessions');
          push('payments');
        }}
      />
    );
  }

  return (
    <div className={popped ? 'motion-fade' : undefined}>
      <CommandCenter
        refreshKey={refreshKey}
        setView={push}
        onExit={exit}
        onOpenDormant={() => { setRosterFilter('dormant'); push('members'); }}
      />
    </div>
  );
}
