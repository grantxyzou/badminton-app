'use client';

import { useState, useCallback } from 'react';
import { useTranslations } from 'next-intl';
import TopBar from '../../primitives/TopBar';
import AnomalyFeed from './AnomalyFeed';
import NextSessionCard from './NextSessionCard';
import PaymentsCard from './PaymentsCard';
import AdminDashTiles from './AdminDashTiles';
import PlayerProfileSheet from './PlayerProfileSheet';
import ReceiptSheet from './ReceiptSheet';
import type { AdminView } from '../types';
import type { ReceiptInput } from '@/lib/receiptTemplate';
import { sessionCostTotals } from '@/lib/sessionCost';

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
      const players = playersRes.ok ? (await playersRes.json()) as Array<{ name: string; removed?: boolean; waitlisted?: boolean }> : [];
      const settings = settingsRes.ok ? (await settingsRes.json()) as { eTransferRecipient?: { name: string; email: string; memo?: string } | null } : null;

      const recipient = session?.eTransferRecipient ?? settings?.eTransferRecipient ?? null;
      if (!recipient || !session?.datetime) {
        setReceiptError('Set an e-transfer recipient first (admin settings) before sharing.');
        setReceiptInput(null);
        return;
      }

      // When the session is settled, every field comes from the frozen
      // snapshot — including playerNames, which means removed-after-settle
      // players still appear on the receipt with the amount they owe. Live
      // recompute is only used for unsettled (in-progress) sessions.
      if (session.settled) {
        setReceiptInput({
          datetime: session.datetime,
          costPerPerson: session.settled.costPerPerson,
          courts: session.courts ?? 0,
          totalCost: session.settled.totalCost,
          playerNames: session.settled.playerNames,
          recipient: { name: recipient.name, email: recipient.email },
          memoTemplate: recipient.memo,
        });
        return;
      }

      const active = players.filter((p) => !p.removed && !p.waitlisted);
      const { totalCost } = sessionCostTotals(session);
      const costPerPerson = active.length > 0 && totalCost > 0
        ? Math.round((totalCost / active.length) * 100) / 100
        : 0;

      setReceiptInput({
        datetime: session.datetime,
        costPerPerson,
        courts: session.courts ?? 0,
        totalCost,
        playerNames: active.map((p) => p.name),
        recipient: { name: recipient.name, email: recipient.email },
        memoTemplate: recipient.memo,
      });
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

      <AnomalyFeed refreshKey={composedRefresh} />
      <NextSessionCard
        refreshKey={composedRefresh}
        onEdit={() => setView('session-details')}
        onAdvance={() => setView('advance')}
        onShareCost={() => openReceipt({ mode: 'group' })}
      />
      <AdminDashTiles
        onOpenBirds={() => setView('birds')}
        onOpenRoster={() => setView('members')}
      />
      <PaymentsCard
        refreshKey={composedRefresh}
        onOpenPlayer={openPlayer}
      />

      {/* Profile-style settings list (mirrors ProfileTab's SettingsList).
          Announcements / E-transfer / Skip dates / Ledger / Release notes
          are drill-in sub-pages (AdminBackHeader) wired in AdminDashboard. */}
      <div className="glass-card-soft" style={{ padding: 0, overflow: 'hidden' }}>
        <ul style={{ listStyle: 'none', margin: 0, padding: 0 }}>
          {[
            { icon: 'campaign', label: 'Announcements', onClick: () => setView('announcements') },
            { icon: 'payments', label: 'E-transfer recipient', onClick: () => setView('etransfer') },
            { icon: 'calendar_today', label: 'Skip dates', onClick: () => setView('skip-dates') },
            { icon: 'receipt_long', label: 'Ledger', onClick: () => setView('ledger') },
            { icon: 'restore', label: 'Past sessions', onClick: () => setView('past-sessions') },
            { icon: 'bolt', label: 'Release notes', onClick: () => setView('releases') },
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
                  gap: 12,
                  padding: '14px 16px',
                  background: 'transparent',
                  border: 'none',
                  cursor: 'pointer',
                  color: 'var(--text-primary)',
                  fontSize: 15,
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
                  style={{ fontSize: 18, color: 'var(--text-secondary)' }}
                >
                  chevron_right
                </span>
              </button>
            </li>
          ))}
        </ul>
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
