'use client';

import { useState, useCallback, useEffect } from 'react';
import { useTranslations } from 'next-intl';
import { benchSignals, type BenchRow } from '@/lib/useAdminNeedsYou';
import TopBar from '../../primitives/TopBar';
import AnomalyFeed from './AnomalyFeed';
import { isFlagOn } from '@/lib/flags';
import { invitesOn } from '@/lib/invitesOn';
import AccessRequestsCard from './AccessRequestsCard';
import SignInReadinessCard from './SignInReadinessCard';
import NextSessionCard from './NextSessionCard';
import PaymentsCard from './PaymentsCard';
import PaymentsInboxCard from './PaymentsInboxCard';
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

const BASE = process.env.NEXT_PUBLIC_BASE_PATH ?? '';

export interface OpenReceiptOpts {
  mode: 'group' | 'individual';
  playerName?: string;
}

interface CommandCenterProps {
  refreshKey: number;
  setView: (v: AdminView) => void;
  /** Open one member in the Roster editor. */
  onOpenMember?: (name: string) => void;
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
export default function CommandCenter({ refreshKey, setView, onExit, onOpenMember, onOpenDormant }: CommandCenterProps) {
  const pageT = useTranslations('pages.admin');
  // Members only needs the invite even with one club: a new account can only
  // be made with an invite (docs/plans/members-only.md). The one rule, shared
  // with the hook and the server (lib/invitesOn.ts). The invite has its own
  // page now; this decides whether People offers it.
  const inviteSurfaces = invitesOn();
  const [localRefresh, setLocalRefresh] = useState(0);
  const composedRefresh = refreshKey + localRefresh;

  /* The bench row's count: requests nobody has taken, jobs past their date.
     One read of the bench, the same arithmetic as Profile's "need you"
     (`benchSignals`). `null` while unknown — the row never says "0 waiting"
     off a dead fetch. Audit 2026-10-11, finding 04: three unclaimed requests
     and a job two days late showed nowhere on this screen. */
  const [benchCount, setBenchCount] = useState<{ waiting: number; late: number } | null>(null);
  const stringingOn = isFlagOn('NEXT_PUBLIC_FLAG_STRINGING');
  const giftCardsOn = isFlagOn('NEXT_PUBLIC_FLAG_STORE_CREDIT');
  useEffect(() => {
    if (!stringingOn) return;
    let cancelled = false;
    fetch(`${BASE}/api/stringing/jobs`, { cache: 'no-store' })
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
        ...(inviteSurfaces ? [{ icon: 'person_add', label: 'Invite someone', onClick: () => setView('invite') }] : []),
      ],
    },
    {
      title: 'Money',
      rows: [
        { icon: 'receipt_long', label: 'Ledger', onClick: () => setView('ledger') },
        { icon: 'restore', label: 'Past sessions', onClick: () => setView('past-sessions') },
        ...(giftCardsOn ? [{ icon: 'payments', label: 'Gift cards', onClick: () => setView('gift-cards') }] : []),
        { icon: 'payments', label: 'E-transfer recipient', onClick: () => setView('etransfer') },
      ],
    },
    {
      title: 'Club',
      rows: [
        ...(stringingOn
          ? [{ icon: 'sports_tennis', label: 'Stringing bench', meta: benchTrailing, accent: !!benchTrailing, onClick: () => setView('stringing') }]
          : []),
        { icon: 'campaign', label: 'Announcements', onClick: () => setView('announcements') },
        { icon: 'calendar_today', label: 'Skip dates', onClick: () => setView('skip-dates') },
      ],
    },
    {
      title: 'More',
      rows: [
        // Club totals: who plays, how fast sessions fill, who comes back.
        { icon: 'bar_chart', label: 'Metrics', onClick: () => setView('metrics') },
        { icon: 'bolt', label: 'Release notes', onClick: () => setView('releases') },
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
      {/* NEEDS YOU FIRST (admin audit, 2026-10-12). Someone waiting on a human
          (sign-in requests), what Profile's "N need you" counted, and members
          who'd be locked out. All three render nothing when nothing is
          waiting, so on a quiet week the screen opens on "This week". */}
      <RevealSlot canBeEmpty placeholder={null}>
        <AccessRequestsCard refreshKey={composedRefresh} />
      </RevealSlot>
      <RevealSlot canBeEmpty placeholder={null}>
        <NeedsYouCard
          refreshKey={composedRefresh}
          onOpenPayments={() => document.getElementById('cc-payments')?.scrollIntoView({ behavior: 'smooth', block: 'start' })}
          onOpenBirds={() => setView('birds')}
          onOpenDormant={() => (onOpenDormant ? onOpenDormant() : setView('members'))}
          onOpenBench={() => setView('stringing')}
        />
      </RevealSlot>
      <RevealSlot canBeEmpty placeholder={null}>
        <SignInReadinessCard refreshKey={composedRefresh} onOpenMember={onOpenMember} />
      </RevealSlot>

      {/* THIS WEEK: the session and its money, the screen's main job. The
          e-transfers inbox sits right above the paid pills it resolves into;
          a match bumps the refresh so the pills move with it. */}
      <ProfileEyebrow>This week</ProfileEyebrow>
      <RevealSlot placeholder={<CardSkeleton height={CONSOLE_HEIGHTS.nextSession} />}>
      <NextSessionCard
        refreshKey={composedRefresh}
        onEdit={() => setView('session-details')}
        onAdvance={() => setView('advance')}
        onShareCost={() => openReceipt({ mode: 'group' })}
        onChanged={() => setLocalRefresh((n) => n + 1)}
      />
      </RevealSlot>
      {/* Holds a box: with the flag on this card ALWAYS renders (a status line
          or the set-up invitation), so it is not "usually absent". */}
      <RevealSlot canBeEmpty placeholder={<CardSkeleton height={CONSOLE_HEIGHTS.inbox} />}>
        <PaymentsInboxCard refreshKey={composedRefresh} onChanged={() => setLocalRefresh((n) => n + 1)} />
      </RevealSlot>
      <RevealSlot placeholder={<CardSkeleton height={CONSOLE_HEIGHTS.payments} />}>
        <div id="cc-payments" style={{ scrollMarginTop: 'var(--space-9)' }}>
          <PaymentsCard refreshKey={composedRefresh} onOpenPlayer={openPlayer} />
        </div>
      </RevealSlot>

      {/* AT A GLANCE: the two numbers worth seeing without a tap. */}
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

      {/* EVERYTHING ELSE, grouped by what it is FOR. It was one nine-row list
          mixing the bench, weekly settings, the books, analytics and catalog
          upkeep, with the invite and gift cards as full cards between. Static,
          so ready at once — but slotted, so it shows only after the cards
          above it, which would otherwise push it down as they arrive. */}
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
