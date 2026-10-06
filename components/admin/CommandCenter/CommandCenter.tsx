'use client';

import { useState, useCallback } from 'react';
import { useTranslations } from 'next-intl';
import TopBar from '../../primitives/TopBar';
import AnomalyFeed from './AnomalyFeed';
import InviteCard from './InviteCard';
import { isFlagOn } from '@/lib/flags';
import { invitesOn } from '@/lib/invitesOn';
import { useCurrentGroup } from '@/lib/useCurrentGroup';
import AccessRequestsCard from './AccessRequestsCard';
import SignInReadinessCard from './SignInReadinessCard';
import NextSessionCard from './NextSessionCard';
import PaymentsCard from './PaymentsCard';
import PaymentsInboxCard from './PaymentsInboxCard';
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
  /** Exit the Admin tab back to Profile (Admin is reached from Profile). */
  onExit: () => void;
}

/**
 * The new admin landing surface — a stack of cards that surfaces state
 * across every admin domain (session, payments, birds, roster) so the
 * organizer can confirm "everything looks right" in 30 seconds.
 */
export default function CommandCenter({ refreshKey, setView, onExit }: CommandCenterProps) {
  const pageT = useTranslations('pages.admin');
  // Members only needs the invite card even with one club: a new account can
  // only be made with an invite (docs/plans/members-only.md). The one rule,
  // shared with the hook and the server (lib/invitesOn.ts).
  const inviteSurfaces = invitesOn();
  // Names the club in the share sheet. `null` with the flag off, which is also
  // when `InviteCard` renders nothing.
  const { group } = useCurrentGroup();
  const groupName = group?.name;
  const [localRefresh, setLocalRefresh] = useState(0);
  const composedRefresh = refreshKey + localRefresh;

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
        setReceiptError('Set an e-transfer recipient first (admin settings) before sharing.');
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

  return (
    <div className="space-y-5 w-full">
      {/* Admin is reached from Profile, so it's a sub-page: TopBar with a back
          affordance (no crumb — "ADMIN" over an "Admin" title is redundant). */}
      <TopBar title={pageT('title')} onBack={onExit} backLabel="Back to profile" />

      {/* Toasts float over the page (`.toast-stack` is fixed) and hold no place
          in it, so they sit outside the cascade below. */}
      <AnomalyFeed refreshKey={composedRefresh} />

      {/* LOADING CASCADE (docs/plans/loading-cascade.md): every card holds its
          place and shows in this order, however the eight reads answer. The
          usually-empty cards (requests, inbox, readiness) reserve no space but
          keep their order — so the settings list, last, cannot be pushed down
          by one of them arriving. A flex gap so a closed slot leaves none. */}
      <div className="flex flex-col gap-5">
      <RevealGroup>
      {/* Above the session card: somebody locked out is waiting on a human,
          and it renders nothing at all when nobody is. */}
      <RevealSlot canBeEmpty placeholder={null}>
        <AccessRequestsCard refreshKey={composedRefresh} />
      </RevealSlot>
      <RevealSlot placeholder={<CardSkeleton height={CONSOLE_HEIGHTS.nextSession} />}>
      <NextSessionCard
        refreshKey={composedRefresh}
        onEdit={() => setView('session-details')}
        onAdvance={() => setView('advance')}
        onShareCost={() => openReceipt({ mode: 'group' })}
        onChanged={() => setLocalRefresh((n) => n + 1)}
      />
      </RevealSlot>
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
      {/* E-transfers waiting for a person sit right above the paid pills they
          resolve into; a match bumps the refresh so the pills move with it. */}
      <RevealSlot canBeEmpty placeholder={null}>
        <PaymentsInboxCard refreshKey={composedRefresh} onChanged={() => setLocalRefresh((n) => n + 1)} />
      </RevealSlot>
      <RevealSlot placeholder={<CardSkeleton height={CONSOLE_HEIGHTS.payments} />}>
      <PaymentsCard
        refreshKey={composedRefresh}
        onOpenPlayer={openPlayer}
      />
      </RevealSlot>

      {/* BELOW the week's work, not above it. Growing the club matters, but an
          organiser opens this screen to run Thursday — the invite is the thing
          you come looking for, not the thing you are interrupted by. Renders
          nothing with the flag off (the endpoint 404s) or for a non-admin. */}
      <RevealSlot canBeEmpty placeholder={<CardSkeleton height={CONSOLE_HEIGHTS.invite} />}>
        <InviteCard enabled={inviteSurfaces} groupName={groupName} />
      </RevealSlot>

      {/* Members only (docs/plans/members-only.md): who would be locked out.
          BELOW the week's work, beside the invite, for the invite card's own
          reason — it is a checklist worked through over weeks before the flip,
          not something to be interrupted by every Thursday. Access requests,
          which are someone waiting, stay at the top. */}
      <RevealSlot canBeEmpty placeholder={null}>
        <SignInReadinessCard refreshKey={composedRefresh} />
      </RevealSlot>

      {/* Profile-style settings list (mirrors ProfileTab's SettingsList).
          Announcements / E-transfer / Skip dates / Ledger / Release notes
          are drill-in sub-pages (AdminBackHeader) wired in AdminDashboard.
          Static, so ready at once — but slotted, so it shows only after the
          cards above it, which would otherwise push it down as they arrive. */}
      <RevealSlot ready placeholder={<CardSkeleton height={CONSOLE_HEIGHTS.settings} />}>
      <div className="glass-card is-flush" style={{ overflow: 'hidden' }}>
        <ul style={{ listStyle: 'none', margin: '0', padding: '0' }}>
          {[
            { icon: 'campaign', label: 'Announcements', onClick: () => setView('announcements') },
            { icon: 'payments', label: 'E-transfer recipient', onClick: () => setView('etransfer') },
            { icon: 'calendar_today', label: 'Skip dates', onClick: () => setView('skip-dates') },
            { icon: 'receipt_long', label: 'Ledger', onClick: () => setView('ledger') },
            { icon: 'restore', label: 'Past sessions', onClick: () => setView('past-sessions') },
            { icon: 'bolt', label: 'Release notes', onClick: () => setView('releases') },
            // Rackets members typed in by name: the models the catalog is missing.
            { icon: 'sports_tennis', label: 'Missing from the catalog', onClick: () => setView('catalog-gaps') },
            // The stringing bench. It was first added to a btn-ghost row in the
            // pre-Command-Center AdminDashboard layout, which nobody could see
            // (see AdminBenchEntry.test.tsx). That layout is gone now.
            ...(isFlagOn('NEXT_PUBLIC_FLAG_STRINGING')
              ? [{ icon: 'sports_tennis', label: 'Stringing bench', onClick: () => setView('stringing') }]
              : []),
          ].map((row, idx) => (
            <li
              key={row.label}
              style={{ borderTop: idx === 0 ? 'none' : '1px solid var(--divider)' }}
            >
              <button
                type="button"
                onClick={row.onClick}
                style={{
                  width: '100%',
                  display: 'flex',
                  alignItems: 'center',
                  gap: 'var(--space-4)',
                  padding: 'var(--space-4) var(--space-5)',
                  background: 'transparent',
                  border: 'none',
                  cursor: 'pointer',
                  color: 'var(--text-primary)',
                  fontSize: 'var(--fs-lg)',
                  textAlign: 'left',
                }}
              >
                <span
                  className="material-icons"
                  aria-hidden="true"
                  style={{ fontSize: 'var(--fs-stat)', color: 'var(--text-secondary)' }}
                >
                  {row.icon}
                </span>
                <span style={{ flex: 1 }}>{row.label}</span>
                <span
                  className="material-icons"
                  aria-hidden="true"
                  style={{ fontSize: 'var(--icon-md)', color: 'var(--text-secondary)' }}
                >
                  chevron_right
                </span>
              </button>
            </li>
          ))}
        </ul>
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
