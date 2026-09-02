'use client';

import { useState, useCallback } from 'react';
import type { AdminView } from './types';
import AdvanceSessionForm from './AdvanceSessionForm';
import ReleasesView from './ReleasesView';
import CommandCenter from './CommandCenter/CommandCenter';
import BirdsPage from './CommandCenter/BirdsPage';
import RosterPage from './CommandCenter/RosterPage';
import SetupPage from './CommandCenter/SetupPage';
import PastSessionsPage from './CommandCenter/PastSessionsPage';
import StringingPage from './CommandCenter/StringingPage';
import LedgerPage from './LedgerPage';
import PaymentsCard from './CommandCenter/PaymentsCard';
import AdminBackHeader from './AdminBackHeader';
import AnnouncementsCard from './CommandCenter/AnnouncementsCard';
import ETransferRecipientEditor from './CommandCenter/ETransferRecipientEditor';
import SkipDatesEditor from './CommandCenter/SkipDatesEditor';
import { isFlagOn } from '@/lib/flags';

/*
 * The admin subtree's router. Every view is a Command Center page; the
 * pre-Command-Center `Dashboard` (and the SessionDetailsEditor / DateTimeEditor
 * / MembersView / BirdInventoryView it routed to) lived in this file until the
 * COMMAND_CENTER flag was retired in September 2026, four months after the
 * Command Center shipped to everyone.
 */

/* ── Main component ── */

export default function AdminDashboard({ onExit }: { onExit: () => void }) {
  const [view, setView] = useState<AdminView>('dashboard');
  const [refreshKey, setRefreshKey] = useState(0);
  // Session the Ledger drilled into; PaymentsCard preselects its chip.
  const [paymentsSessionId, setPaymentsSessionId] = useState<string | null>(null);

  const goBack = useCallback(() => {
    setRefreshKey(k => k + 1);
    setView('dashboard');
  }, []);

  // Payments is reached from the Ledger, so Back returns there (not the
  // dashboard) — preserving the drill-in trail.
  const goBackToLedger = useCallback(() => {
    setRefreshKey(k => k + 1);
    setView('ledger');
  }, []);

  /* ── Drill-down routing ── */
  // 'session-details' and 'date-time' are two entry points to one screen — the
  // pre-Command-Center layout had separate editors for them, retired with the
  // COMMAND_CENTER flag (2026-09).
  if (view === 'session-details' || view === 'date-time') {
    return <div className="animate-slideInRight"><SetupPage onBack={goBack} /></div>;
  }
  if (view === 'members') {
    return <div className="animate-slideInRight"><RosterPage onBack={goBack} /></div>;
  }
  if (view === 'birds') {
    return <div className="animate-slideInRight"><BirdsPage onBack={goBack} /></div>;
  }
  if (view === 'advance') return <div className="animate-slideInRight"><AdvanceSessionForm onBack={goBack} /></div>;
  if (view === 'releases') return <div className="animate-slideInRight"><ReleasesView onBack={goBack} /></div>;
  // Flag-gated at the route level too — every price on this screen is exact,
  // which is precisely what the player API strips.
  if (view === 'stringing' && isFlagOn('NEXT_PUBLIC_FLAG_STRINGING')) {
    return <div className="animate-slideInRight"><StringingPage onBack={goBack} /></div>;
  }
  if (view === 'ledger') {
    return (
      <div className="animate-slideInRight">
        <LedgerPage
          onBack={goBack}
          onOpenSession={(sessionId) => {
            setPaymentsSessionId(sessionId);
            setView('payments');
          }}
        />
      </div>
    );
  }
  if (view === 'payments') {
    // Reached via the Ledger drill-in.
    return (
      <div className="animate-slideInRight space-y-3">
        <AdminBackHeader onBack={goBackToLedger} title="Payments" />
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
  if (view === 'past-sessions') {
    return <PastSessionsPage onBack={goBack} />;
  }

  return <CommandCenter refreshKey={refreshKey} setView={setView} onExit={onExit} />;
}
