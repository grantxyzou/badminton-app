'use client';

import { useState, useCallback, useEffect } from 'react';
import { useTranslations } from 'next-intl';
import { benchSignals, type BenchRow } from '@/lib/useAdminNeedsYou';
import TopBar from '../../primitives/TopBar';
import AnomalyFeed from './AnomalyFeed';
import { isFlagOn } from '@/lib/flags';
import AccessRequestsCard from './AccessRequestsCard';
import NextSessionCard from './NextSessionCard';
import PaymentsCard from './PaymentsCard';
import SessionListCard from './SessionListCard';
import NeedsYouCard from './NeedsYouCard';
import ProfileEyebrow from '@/components/primitives/ProfileEyebrow';
import SettingsList, { type SettingsRow } from '@/components/profile/SettingsList';
import AdminDashTiles from './AdminDashTiles';
import PlayerProfileSheet from './PlayerProfileSheet';
import ReceiptSheet from './ReceiptSheet';
import type { AdminView } from '../types';
import type { ReceiptInput } from '@/lib/receiptTemplate';
import { buildReceiptInput } from '@/lib/buildReceiptInput';
import { RevealGroup, RevealSlot } from '@/components/primitives/Reveal';
import CardSkeleton, { CONSOLE_HEIGHTS } from '@/components/primitives/CardSkeleton';
import { sharedFetch } from '@/lib/sharedRead';
import { useClubRun } from '@/lib/useClubRun';
import { CLUB_STYLES } from '@/lib/clubRun';

const BASE = process.env.NEXT_PUBLIC_BASE_PATH ?? '';

export interface OpenReceiptOpts {
  mode: 'group' | 'individual';
  playerName?: string;
}

interface CommandCenterProps {
  refreshKey: number;
  setView: (v: AdminView) => void;
  /** Open the Roster on its Dormant filter. */
  onOpenDormant?: () => void;
  /** Exit the Admin tab back to Profile (Admin is reached from Profile). */
  onExit: () => void;
}

/**
 * The new admin landing surface — a stack of cards that surfaces state
 * across every admin domain (session, payments, birds, roster) so the
 * organizer can confirm "everything looks right" in 30 seconds.
 */
export default function CommandCenter({ refreshKey, setView, onExit, onOpenDormant }: CommandCenterProps) {
  const pageT = useTranslations('pages.admin');
  const [localRefresh, setLocalRefresh] = useState(0);
  // "This week" shows ONE card at a time: the session, or Payments.
  const [weekView, setWeekView] = useState<'session' | 'payments'>('session');
  const composedRefresh = refreshKey + localRefresh;

  /* The bench row's count: requests nobody has taken, jobs past their date.
     One read of the bench, the same arithmetic as Profile's "need you"
     (`benchSignals`). `null` while unknown — the row never says "0 waiting"
     off a dead fetch. Audit 2026-10-11, finding 04: three unclaimed requests
     and a job two days late showed nowhere on this screen. */
  const [benchCount, setBenchCount] = useState<{ waiting: number; late: number } | null>(null);
  const stringingOn = isFlagOn('NEXT_PUBLIC_FLAG_STRINGING');
  const giftCardsOn = isFlagOn('NEXT_PUBLIC_FLAG_STORE_CREDIT');
  // How this club runs (lib/clubRun.ts). Money surfaces hide only on a KNOWN
  // "off": while the club is still being read they render as they always did.
  const { run, known: runKnown } = useClubRun();
  const moneyOff = runKnown && run.money === 'off';
  const styleLabel = run.style === 'custom' ? 'Custom' : CLUB_STYLES[run.style].label;
  // Release notes are the deployment's, written by the operator alone (the
  // route refuses anyone else). Hidden until the answer says so: a row that
  // opens a screen whose every save is refused is worse than no row.
  const [operator, setOperator] = useState(false);
  useEffect(() => {
    let cancelled = false;
    sharedFetch('/api/admin')
      .then((r) => (r.ok ? r.json() : null))
      .then((d: { operator?: boolean } | null) => { if (!cancelled) setOperator(d?.operator === true); })
      .catch(() => {});
    return () => { cancelled = true; };
  }, []);
  useEffect(() => {
    if (!stringingOn) return;
    let cancelled = false;
    // The Needs-you card reads the bench in the same commit; `sharedFetch`
    // makes that one request while it is in flight (lib/sharedRead.ts).
    sharedFetch('/api/stringing/jobs')
      .then((r) => (r.ok ? r.json() : null))
      .then((d: { jobs?: BenchRow[] } | null) => {
        if (!cancelled && d && Array.isArray(d.jobs)) setBenchCount(benchSignals(d.jobs));
      })
      .catch(() => {
        /* the row still opens the bench; it just carries no count */
      });
    return () => {
      cancelled = true;
    };
  }, [stringingOn, composedRefresh]);
  const benchTrailing =
    benchCount && benchCount.waiting + benchCount.late > 0
      ? [
          benchCount.waiting > 0 ? `${benchCount.waiting} waiting` : null,
          benchCount.late > 0 ? `${benchCount.late} late` : null,
        ]
          .filter(Boolean)
          .join(' · ')
      : undefined;

  /* The two cards that used to sit in the body — Sign-in readiness above
     "This week", the e-transfer inbox between the session and Payments — are
     menu rows now (Grant, 2026-10-21: "should be moved into menu items").
     Each row carries the one number the card was there for, read the same
     way the card read it; `null` while unknown, so a dead fetch never says
     "0 locked out" or hides "2 waiting". */
  const [lockedOut, setLockedOut] = useState<number | null>(null);
  useEffect(() => {
    let cancelled = false;
    fetch(`${BASE}/api/admin/sign-in-readiness`, { cache: 'no-store' })
      .then((r) => (r.ok ? r.json() : null))
      .then((d: { cannotSignIn?: string[] } | null) => {
        if (!cancelled && d && Array.isArray(d.cannotSignIn)) setLockedOut(d.cannotSignIn.length);
      })
      .catch(() => {
        /* the row still opens the page; it just carries no count */
      });
    return () => {
      cancelled = true;
    };
  }, [composedRefresh]);
  const paymentsAutoOn = isFlagOn('NEXT_PUBLIC_FLAG_PAYMENTS_AUTO');
  const [inbox, setInbox] = useState<{ configured: boolean; waiting: number } | null>(null);
  useEffect(() => {
    if (!paymentsAutoOn) return;
    let cancelled = false;
    // The count form: the full inbox also reads every member's balance for its
    // previews, which this row never shows (2026-10-25: the slowest request on
    // a first open of Admin).
    fetch(`${BASE}/api/admin/payments?count=1`, { cache: 'no-store' })
      .then((r) => (r.ok ? r.json() : null))
      .then((d: { configured?: boolean; waiting?: number } | null) => {
        if (!cancelled && d && typeof d.configured === 'boolean' && typeof d.waiting === 'number') {
          setInbox({ configured: d.configured, waiting: d.waiting });
        }
      })
      .catch(() => {
        /* no count; the page itself reports a failed read */
      });
    return () => {
      cancelled = true;
    };
  }, [paymentsAutoOn, composedRefresh]);
  const lockedTrailing = lockedOut && lockedOut > 0 ? `${lockedOut} locked out` : undefined;
  const inboxTrailing = inbox
    ? !inbox.configured
      ? 'Set up'
      : inbox.waiting > 0
        ? `${inbox.waiting} waiting`
        : undefined
    : undefined;

  const [profileMemberId, setProfileMemberId] = useState<string | null>(null);
  const [profileMemberName, setProfileMemberName] = useState<string | null>(null);
  const [profileOpen, setProfileOpen] = useState(false);

  // Receipt state lifted to CommandCenter so both NextSession (group share)
  // and Payments (per-player nudge) can trigger the same sheet.
  const [receiptOpen, setReceiptOpen] = useState(false);
  const [receiptMode, setReceiptMode] = useState<'group' | 'individual'>('group');
  const [receiptPlayer, setReceiptPlayer] = useState<string | null>(null);
  const [receiptInput, setReceiptInput] = useState<ReceiptInput | null>(null);
  const [receiptError, setReceiptError] = useState('');

  function openPlayer(memberId: string, name?: string) {
    setProfileMemberId(memberId);
    setProfileMemberName(name ?? null);
    setProfileOpen(true);
  }

  const openReceipt = useCallback(async (opts: OpenReceiptOpts) => {
    setReceiptError('');
    setReceiptMode(opts.mode);
    setReceiptPlayer(opts.playerName ?? null);
    setReceiptOpen(true);

    // Fetch the latest data each time so the receipt reflects current state.
    try {
      const [sessionRes, playersRes, settingsRes] = await Promise.all([
        fetch(`${BASE}/api/session`, { cache: 'no-store' }),
        fetch(`${BASE}/api/players`, { cache: 'no-store' }),
        fetch(`${BASE}/api/admin/settings`, { cache: 'no-store' }),
      ]);
      const session = sessionRes.ok ? await sessionRes.json() : null;
      const players = playersRes.ok ? (await playersRes.json()) as Array<{ name: string; removed?: boolean; waitlisted?: boolean; writtenOff?: boolean; coverMode?: 'absorb' | 'resplit' }> : [];
      const settings = settingsRes.ok ? (await settingsRes.json()) as { eTransferRecipient?: { name: string; email: string; memo?: string } | null } : null;

      const recipient = session?.eTransferRecipient ?? settings?.eTransferRecipient ?? null;
      if (!recipient || !session?.datetime) {
        setReceiptError('Set an e-transfer recipient first (Admin → E-transfer recipient) before sharing.');
        setReceiptInput(null);
        return;
      }

      // `buildReceiptInput` is the single resolver (CLAUDE.md): snapshot-first
      // for a settled session (removed-after-settle players still appear with
      // what they owe), cover-aware recompute for an unsettled one. This used
      // to be a fourth hand-rolled copy that ignored a resplit cover and drew
      // a $0 receipt for a session with no cost; the resolver says so instead.
      const built = buildReceiptInput(session, players, recipient);
      if (!built.input) {
        setReceiptError(built.error ?? 'Failed to load receipt data.');
        setReceiptInput(null);
        return;
      }
      setReceiptInput(built.input);
    } catch {
      setReceiptError('Failed to load receipt data.');
      setReceiptInput(null);
    }
  }, []);

  /* The groups below "At a glance". Birds and Roster are the tiles above, not
     rows again here. The bench leads Club with its count — the one row with
     work waiting behind it (audit 2026-10-11). A group with no rows (People,
     with invites off) is left out. */
  const groups: Array<{ title: string; rows: SettingsRow[] }> = [
    {
      title: 'People',
      rows: [
        { icon: 'person_add', label: 'Invite someone', onClick: () => setView('invite') },
        // Who has no PIN, password or Google yet; the count is the work.
        { icon: 'key', label: 'Sign-in readiness', meta: lockedTrailing, accent: !!lockedTrailing, onClick: () => setView('sign-in-readiness') },
      ],
    },
    {
      title: 'Money',
      // A club that collects money outside the app has none of these to keep;
      // turning money back on is on "How your club runs".
      rows: moneyOff ? [] : [
        { icon: 'receipt_long', label: 'Ledger', onClick: () => setView('ledger') },
        // The inbox, reminders, the unpaid hold and the ledger check.
        ...(paymentsAutoOn
          ? [{ icon: 'receipt_long', label: 'E-transfers', meta: inboxTrailing, accent: !!inboxTrailing && inbox?.configured === true, onClick: () => setView('etransfers') }]
          : []),
        ...(giftCardsOn ? [{ icon: 'payments', label: 'Gift cards', onClick: () => setView('gift-cards') }] : []),
        { icon: 'payments', label: 'E-transfer recipient', onClick: () => setView('etransfer') },
      ],
    },
    {
      title: 'Club',
      rows: [
        { icon: 'tune', label: 'How your club runs', meta: runKnown ? styleLabel : undefined, onClick: () => setView('club-run') },
        ...(stringingOn
          ? [{ icon: 'sports_tennis', label: 'Stringing bench', meta: benchTrailing, accent: !!benchTrailing, onClick: () => setView('stringing') }]
          : []),
        { icon: 'campaign', label: 'Announcements', onClick: () => setView('announcements') },
        { icon: 'groups', label: 'Club name', onClick: () => setView('club-name') },
        { icon: 'calendar_today', label: 'Skip dates', onClick: () => setView('skip-dates') },
        { icon: 'schedule', label: 'Late cancellations', onClick: () => setView('late-cancel') },
        // Guests are a rule of How your club runs (docs/plans/six-feathers-guests.md).
        { icon: 'person_add', label: 'Guests', onClick: () => setView('club-run') },
      ],
    },
    {
      title: 'More',
      rows: [
        // Club totals: who plays, how fast sessions fill, who comes back.
        { icon: 'bar_chart', label: 'Metrics', onClick: () => setView('metrics') },
        ...(operator ? [{ icon: 'bolt', label: 'Release notes', onClick: () => setView('releases') }] : []),
        // Rackets members typed in by name: the models the catalog is missing.
        { icon: 'sports_tennis', label: 'Missing from the catalog', onClick: () => setView('catalog-gaps') },
      ],
    },
  ];

  return (
    <div className="space-y-5 w-full">
      {/* Admin is reached from Profile, so it's a sub-page: TopBar with a back
          affordance (no crumb — "ADMIN" over an "Admin" title is redundant). */}
      <TopBar title={pageT('title')} onBack={onExit} backLabel="Back to profile" />

      {/* Toasts float over the page (`.toast-stack` is fixed) and hold no place
          in it, so they sit outside the cascade below. */}
      <AnomalyFeed refreshKey={composedRefresh} />

      {/* LOADING CASCADE (docs/plans/loading-cascade.md): every card holds its
          place from the first frame. The usually-empty cards (requests,
          readiness) reserve no space; the cards below one wait for it, but
          only briefly (SPACELESS_WAIT_MS) — the settings list, last and
          static, is never more than that far away. A flex gap so a closed
          slot leaves none. */}
      <div className="flex flex-col gap-5">
      <RevealGroup>
      {/* AT A GLANCE FIRST (Grant, 2026-11-04: "At a glance should be at the
          very top"): the two numbers worth seeing without a tap, above
          everything, including what needs a human. */}
      <ProfileEyebrow>At a glance</ProfileEyebrow>
      <RevealSlot
        placeholder={
          <div className="cc-dgrid">
            <CardSkeleton height={CONSOLE_HEIGHTS.tile} />
            <CardSkeleton height={CONSOLE_HEIGHTS.tile} />
          </div>
        }
      >
      <AdminDashTiles
        onOpenBirds={() => setView('birds')}
        onOpenRoster={() => setView('members')}
      />
      </RevealSlot>

      {/* NEEDS YOU next (admin audit, 2026-10-12, when it led the screen).
          Someone waiting on a human (sign-in requests) and what Profile's
          "N need you" counted. Both render nothing when nothing is waiting,
          so on a quiet week the tiles hand straight to "This week". Who is
          locked out is the People row's count. */}
      <RevealSlot canBeEmpty placeholder={null}>
        <AccessRequestsCard refreshKey={composedRefresh} />
      </RevealSlot>
      {/* Holds its place: for an admin it almost always has rows (dormant
          members alone keep it open), and space-less it arrived ~1.5s into a
          cold open ABOVE "This week" and shoved it down (Grant's phone
          recording, 2026-10-28). Empty, the placeholder closes. */}
      <RevealSlot
        canBeEmpty
        placeholder={
          <div className="flex flex-col gap-2" aria-hidden="true">
            <div className="shimmer-line rounded-lg" style={{ height: CONSOLE_HEIGHTS.needsYouEyebrow, width: '22%' }} />
            <CardSkeleton height={CONSOLE_HEIGHTS.needsYouList} />
          </div>
        }
      >
        <NeedsYouCard
          refreshKey={composedRefresh}
          onOpenPayments={() => {
            setWeekView('payments');
            requestAnimationFrame(() => document.getElementById('cc-payments')?.scrollIntoView({ behavior: 'smooth', block: 'start' }));
          }}
          onOpenBirds={() => setView('birds')}
          onOpenDormant={() => (onOpenDormant ? onOpenDormant() : setView('members'))}
          onOpenBench={() => setView('stringing')}
        />
      </RevealSlot>

      {/* THIS WEEK: the session and its money, the screen's main job — ONE
          card at a time behind a Session · Payments toggle (Grant,
          2026-11-04: "to save vertical space"; a side-scrolling rail was
          tried first and stood as tall as the taller card). Both stay
          mounted, so switching reads nothing; the one not showing is
          `hidden`. With money off there is no toggle: the session, then the
          week's list without money (SessionListCard,
          docs/plans/money-off-session-list.md), because Payments was the
          only admin list of who signed up. */}
      <div className="cc-week-head">
        <ProfileEyebrow>This week</ProfileEyebrow>
        {!moneyOff && (
          <div className="segment-control flex cc-week-toggle" role="tablist" aria-label="This week">
            {(['session', 'payments'] as const).map((v) => (
              <button
                key={v}
                type="button"
                role="tab"
                aria-selected={weekView === v}
                onClick={() => setWeekView(v)}
                className={`flex-1 fs-sm rounded-full ${weekView === v ? 'segment-tab-active' : 'segment-tab-inactive'}`}
              >
                {v === 'session' ? 'Session' : 'Payments'}
              </button>
            ))}
          </div>
        )}
      </div>
      <div hidden={weekView !== 'session'}>
      <RevealSlot placeholder={<CardSkeleton height={CONSOLE_HEIGHTS.nextSession} />}>
      <NextSessionCard
        refreshKey={composedRefresh}
        onEdit={() => setView('session-details')}
        onAdvance={() => setView('advance')}
        onShareCost={() => openReceipt({ mode: 'group' })}
        onChanged={() => setLocalRefresh((n) => n + 1)}
      />
      </RevealSlot>
      </div>
      {moneyOff && (
        <RevealSlot canBeEmpty placeholder={<CardSkeleton height={CONSOLE_HEIGHTS.sessionList} />}>
          <SessionListCard refreshKey={composedRefresh} run={run} onChanged={() => setLocalRefresh((n) => n + 1)} />
        </RevealSlot>
      )}
      {!moneyOff && (
        <div hidden={weekView !== 'payments'}>
        <RevealSlot placeholder={<CardSkeleton height={CONSOLE_HEIGHTS.payments} />}>
          <div id="cc-payments" style={{ scrollMarginTop: 'var(--space-9)' }}>
            <PaymentsCard refreshKey={composedRefresh} onOpenPlayer={openPlayer} />
          </div>
        </RevealSlot>
        </div>
      )}

      {/* EVERYTHING ELSE, grouped by what it is FOR, as list rows. It was one
          nine-row list mixing the bench, weekly settings, the books, analytics
          and catalog upkeep, with the invite and gift cards as full cards
          between. A grid of tiles three to a row was tried on 2026-11-04 to
          shorten the page and reverted the same day: it drew sixteen doors
          as cards, so nothing told a thing to read from a thing to open
          (Grant: "Why are all of them cards?"), and the inner-tile material
          sat on the page ground, where DESIGN.md §9 does not allow it.
          Static, so ready at once — but slotted, so it shows only after the
          cards above it, which would otherwise push it down as they arrive. */}
      <RevealSlot ready placeholder={<CardSkeleton height={CONSOLE_HEIGHTS.settings} />}>
        <div className="flex flex-col gap-2">
          {groups.filter((g) => g.rows.length > 0).map((g) => (
            <section key={g.title} aria-label={g.title} className="flex flex-col gap-2">
              <ProfileEyebrow>{g.title}</ProfileEyebrow>
              <SettingsList rows={g.rows} />
            </section>
          ))}
        </div>
      </RevealSlot>
      </RevealGroup>
      </div>

      <PlayerProfileSheet
        open={profileOpen}
        onClose={() => setProfileOpen(false)}
        memberId={profileMemberId}
        initialName={profileMemberName ?? undefined}
      />

      <ReceiptSheet
        open={receiptOpen}
        onClose={() => setReceiptOpen(false)}
        input={receiptInput}
        error={receiptError}
        initialMode={receiptMode}
        initialPlayerName={receiptPlayer ?? undefined}
      />

      <button type="button" hidden onClick={() => setLocalRefresh((n) => n + 1)} />
    </div>
  );
}
