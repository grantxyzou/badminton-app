'use client';

import { useState, useCallback, useEffect, useRef } from 'react';
import { usePaneMode } from '@/lib/paneMode';
import { PaneDetail, usePaneDetailReveal } from '@/components/primitives/PaneDetail';
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
import DoorPosterCard from './CommandCenter/DoorPosterCard';
import GiftCardsCard from './CommandCenter/GiftCardsCard';
import SignInReadinessCard from './CommandCenter/SignInReadinessCard';
import PaymentsInboxCard from './CommandCenter/PaymentsInboxCard';
import type { FilterKey as RosterFilter } from './CommandCenter/RosterPage';
import { useCurrentGroup } from '@/lib/useCurrentGroup';
import AnnouncementsCard from './CommandCenter/AnnouncementsCard';
import ETransferRecipientEditor from './CommandCenter/ETransferRecipientEditor';
import SkipDatesEditor from './CommandCenter/SkipDatesEditor';
import LateCancelEditor from './CommandCenter/LateCancelEditor';
import ClubRunPage from './CommandCenter/ClubRunPage';
import ClubNameEditor from './CommandCenter/ClubNameEditor';
import { isFlagOn } from '@/lib/flags';
import { TabActiveContext, useTabActive, useTabReturn } from '@/lib/tabActivity';
import { usePageBack } from '@/lib/pageStack';
import { popView, pushView, topView } from '@/lib/viewTrail';

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
  'sign-in-readiness', 'etransfers', 'club-name', 'club-run',
]);
/** The trail kept across a refresh: the pages from the console up, as far as each can be restored. */
function restorable(trail: readonly AdminView[]): AdminView[] {
  const kept: AdminView[] = [];
  for (const v of trail) {
    if (!RESTORABLE.has(v)) break;
    kept.push(v);
  }
  return kept;
}
function storeTrail(trail: readonly AdminView[]) {
  try {
    const kept = restorable(trail);
    if (kept.length > 0) sessionStorage.setItem(VIEW_KEY, JSON.stringify(kept));
    else sessionStorage.removeItem(VIEW_KEY);
  } catch { /* private mode: the place is not kept, nothing else changes */ }
}
function readTrail(): AdminView[] {
  try {
    const raw = sessionStorage.getItem(VIEW_KEY);
    if (!raw) return [];
    // A single view, as stored before the trail (2026-11-05).
    if (!raw.startsWith('[')) return restorable([raw as AdminView]);
    const parsed: unknown = JSON.parse(raw);
    return Array.isArray(parsed) ? restorable(parsed.filter((v): v is AdminView => typeof v === 'string')) : [];
  } catch {
    return [];
  }
}

export default function AdminDashboard({ onExit }: { onExit: () => void }) {
  /* THE TRAIL (docs/plans/back-navigation.md): the pages open above the
     console, top-most last. Opening a page pushes it and Back pops ONE, so
     How your club runs → Late cancellations → Back returns to How your club
     runs. It held only the current page until 2026-11-05, and every Back went
     to the console, skipping the page the admin came from (Grant: "forward to
     a page then back takes me to a page before"). */
  const [trail, setTrail] = useState<AdminView[]>([]);
  const view: AdminView = topView(trail, 'dashboard');
  // Restored after mount, never in the initializer (the HomeShell rule:
  // sessionStorage during hydration is a mismatch).
  useEffect(() => {
    const saved = readTrail();
    if (saved.length > 0) setTrail(saved);
  }, []);
  useEffect(() => { storeTrail(trail); }, [trail]);
  const exit = useCallback(() => { storeTrail([]); onExit(); }, [onExit]);
  const [refreshKey, setRefreshKey] = useState(0);
  // Session the Ledger drilled into; PaymentsCard preselects its chip.
  const [paymentsSessionId, setPaymentsSessionId] = useState<string | null>(null);
  // Member the Roster should open on arrival (from Sign-in readiness), or
  // the filter it opens on (from Needs you's dormant row).
  const [rosterFocus, setRosterFocus] = useState<string | null>(null);
  const [rosterFilter, setRosterFilter] = useState<RosterFilter>('all');
  const { group } = useCurrentGroup();
  // The Admin tab is kept once visited (HomeShell). Back on it after a while,
  // re-read the console quietly, as the other tabs do.
  const onScreen = useTabActive();
  useTabReturn(() => setRefreshKey((k) => k + 1));

  // Which way the last move went. A push slides the page in from the right;
  // going BACK used to have no motion at all (the Command Center just cut in).
  // A pop fades rather than sliding from the left: the Command Center renders
  // fixed-position toasts, and a transform on their ancestor would drag them.
  const [popped, setPopped] = useState(false);
  // Two pages on an open foldable (lib/paneMode.ts); false on one screen.
  const pane = usePaneMode();
  const pageMotion = pane ? undefined : 'animate-slideInRight';
  const detailRef = useRef<HTMLDivElement>(null);
  const push = useCallback((next: AdminView) => {
    setPopped(false);
    // The console is the bottom of the trail, never a page on it; the page
    // already on top is not stacked twice.
    setTrail((t) => pushView(t, next, 'dashboard'));
  }, []);

  const goBack = useCallback(() => {
    setRefreshKey(k => k + 1);
    setPopped(true);
    setTrail(popView);
  }, []);

  // The Android back button steps back through the same trail before it
  // leaves the tab (lib/pageStack.ts).
  usePageBack(trail.length > 0, goBack);

  // On two pages a row on the console REPLACES the right page rather than
  // stacking on it; a page opening another (How your club runs → Late
  // cancellations) still stacks, so that one keeps its Back.
  const openFromConsole = useCallback((next: AdminView) => {
    setPopped(false);
    setTrail(next === 'dashboard' ? [] : [next]);
  }, []);

  /* ── Drill-down routing ──
     The page on top of the console, or null on the console itself. The
     CONSOLE STAYS MOUNTED underneath (hidden) while a page is open, so Back
     shows it at once instead of rebuilding it — every Back used to re-run
     its fourteen reads behind skeletons (Grant, 2026-10-25: "Admin is still
     choppy and slow"). Back still bumps `refreshKey`, so what the page
     changed is re-read quietly: a revealed card keeps its content. */
  const pageFor = (v: AdminView): React.ReactNode => {
      if (v === 'session-details') {
      return <div className={pageMotion}><SetupPage onBack={goBack} /></div>;
    }
    if (v === 'members') {
      return (
        <div className={pageMotion}>
          <RosterPage
            onBack={() => { setRosterFocus(null); setRosterFilter('all'); goBack(); }}
            focusName={rosterFocus}
            initialFilter={rosterFilter}
          />
        </div>
      );
    }
    if (v === 'birds') {
      return <div className={pageMotion}><BirdsPage onBack={goBack} /></div>;
    }
    if (v === 'advance') return <div className={pageMotion}><AdvanceSessionForm onBack={goBack} /></div>;
    if (v === 'releases') return <div className={pageMotion}><ReleasesView onBack={goBack} /></div>;
    if (v === 'catalog-gaps') return <div className={pageMotion}><CatalogGapsPage onBack={goBack} /></div>;
    if (v === 'metrics') return <div className={pageMotion}><MetricsPage onBack={goBack} /></div>;
    // Flag-gated at the route level too — every price on this screen is exact,
    // which is precisely what the player API strips.
    if (v === 'stringing' && isFlagOn('NEXT_PUBLIC_FLAG_STRINGING')) {
      return <div className={pageMotion}><StringingPage onBack={goBack} /></div>;
    }
    if (v === 'ledger') {
      return (
        <div className={pane ? undefined : popped ? 'motion-fade' : 'animate-slideInRight'}>
          <LedgerPage
            onBack={goBack}
            onOpenSession={(sessionId) => {
              setPaymentsSessionId(sessionId);
              push('payments');
            }}
            onOpenPastSessions={() => push('past-sessions')}
          />
        </div>
      );
    }
    if (v === 'payments') {
      // Reached from a Ledger row or a Past sessions row.
      return (
        <div className="animate-slideInRight space-y-3">
          <AdminBackHeader onBack={goBack} title="Payments" />
          <PaymentsCard refreshKey={refreshKey} initialSessionId={paymentsSessionId} />
        </div>
      );
    }
    if (v === 'announcements') {
      return (
        <div className="animate-slideInRight space-y-3">
          <AdminBackHeader onBack={goBack} title="Announcements" />
          <AnnouncementsCard refreshKey={refreshKey} />
        </div>
      );
    }
    if (v === 'etransfer') {
      return (
        <div className="animate-slideInRight space-y-3">
          <AdminBackHeader onBack={goBack} title="E-transfer recipient" />
          <ETransferRecipientEditor />
        </div>
      );
    }
    if (v === 'skip-dates') {
      return (
        <div className="animate-slideInRight space-y-3">
          <AdminBackHeader onBack={goBack} title="Skip dates" />
          <SkipDatesEditor />
        </div>
      );
    }
    if (v === 'late-cancel') {
      return (
        <div className="animate-slideInRight space-y-3">
          <AdminBackHeader onBack={goBack} title="Late cancellations" />
          <LateCancelEditor />
        </div>
      );
    }
    if (v === 'club-run') {
      return (
        <div className="animate-slideInRight space-y-3">
          <AdminBackHeader onBack={goBack} title="How your club runs" />
          <ClubRunPage onOpenLateCancel={() => push('late-cancel')} />
        </div>
      );
    }
    if (v === 'club-name') {
      return (
        <div className="animate-slideInRight space-y-3">
          <AdminBackHeader onBack={goBack} title="Club name" />
          <ClubNameEditor />
        </div>
      );
    }
    if (v === 'invite') {
      return (
        <div className="animate-slideInRight space-y-3">
          <AdminBackHeader onBack={goBack} title="Invite someone" />
          <InviteCard enabled groupName={group?.name} bare />
          {/* The club's door link, for a chat or a wall (docs/plans/door-link.md). */}
          <DoorPosterCard groupName={group?.name} />
        </div>
      );
    }
    if (v === 'gift-cards') {
      return (
        <div className="animate-slideInRight space-y-3">
          <AdminBackHeader onBack={goBack} title="Credit codes" />
          <GiftCardsCard refreshKey={refreshKey} bare />
        </div>
      );
    }
    if (v === 'sign-in-readiness') {
      // A name opens the member in the Roster (recovery code inside); the
      // Roster's Back lands on the console, the same as from Needs you.
      return (
        <div className="animate-slideInRight space-y-3">
          <AdminBackHeader onBack={goBack} title="Sign-in readiness" />
          <SignInReadinessCard refreshKey={refreshKey} standalone onOpenMember={(name) => { setRosterFocus(name); push('members'); }} />
        </div>
      );
    }
    if (v === 'etransfers' && isFlagOn('NEXT_PUBLIC_FLAG_PAYMENTS_AUTO')) {
      return (
        <div className="animate-slideInRight space-y-3">
          <AdminBackHeader onBack={goBack} title="E-transfers" />
          <PaymentsInboxCard refreshKey={refreshKey} standalone onChanged={() => setRefreshKey((k) => k + 1)} />
        </div>
      );
    }
    if (v === 'past-sessions') {
      return (
        <PastSessionsPage
          onBack={goBack}
          onOpenSession={(sessionId) => {
            setPaymentsSessionId(sessionId);
            push('payments');
          }}
        />
      );
    }
    return null;
  };
  /* One screen: the page on top of the console. Two pages (an open
     foldable): the console keeps the LEFT page and the page opens on the
     RIGHT — Roster before any tap, the people being what a console is most
     often opened for (docs/plans/foldable-layout.md). */
  const subPage = pane ? null : pageFor(view);
  const rightView: AdminView = view === 'dashboard' ? 'members' : view;

  usePaneDetailReveal(detailRef, pane ? rightView : null);

  if (pane) {
    const page = pageFor(rightView) ?? pageFor('members');
    return (
      <div className="admin-shell">
        <div className={popped ? 'motion-fade admin-console' : 'admin-console'}>
          <TabActiveContext.Provider value={onScreen}>
            <CommandCenter
              refreshKey={refreshKey}
              setView={openFromConsole}
              onExit={exit}
              onOpenDormant={() => { setRosterFilter('dormant'); openFromConsole('members'); }}
              openView={rightView}
            />
          </TabActiveContext.Provider>
        </div>
        <div ref={detailRef} className="admin-detail">
          <PaneDetail nested={trail.length > 1}>
            {/* A page opens from the fold; going Back fades, as it does on one screen. */}
            <div key={rightView} className={popped ? 'motion-fade' : 'pane-page-open'}>{page}</div>
          </PaneDetail>
        </div>
      </div>
    );
  }

  return (
    <>
      <div hidden={subPage !== null} className={popped ? 'motion-fade' : undefined}>
        {/* A sheet opened on the console portals out of this hidden box, so it
            is told the console is off screen while a page sits on top. */}
        <TabActiveContext.Provider value={onScreen && subPage === null}>
          <CommandCenter
            refreshKey={refreshKey}
            setView={push}
            onExit={exit}
            onOpenDormant={() => { setRosterFilter('dormant'); push('members'); }}
          />
        </TabActiveContext.Provider>
      </div>
      {subPage}
    </>
  );
}
