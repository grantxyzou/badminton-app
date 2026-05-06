'use client';

import { useState, useCallback } from 'react';
import { useTranslations } from 'next-intl';
import PageHeader from '../../primitives/PageHeader';
import AnomalyFeed from './AnomalyFeed';
import NextSessionCard from './NextSessionCard';
import PaymentsCard from './PaymentsCard';
import AdminDashTiles from './AdminDashTiles';
import RecentSessionsStrip from './RecentSessionsStrip';
import AnnouncementsCard from './AnnouncementsCard';
import PlayerProfileSheet from './PlayerProfileSheet';
import SkipDatesEditor from './SkipDatesEditor';
import ETransferRecipientEditor from './ETransferRecipientEditor';
import ReceiptSheet from './ReceiptSheet';
import type { AdminView } from '../types';
import type { ReceiptInput } from '@/lib/receiptTemplate';
import { normalizeBirdUsages, totalBirdCost } from '@/lib/birdUsages';

const BASE = process.env.NEXT_PUBLIC_BASE_PATH ?? '';

export interface OpenReceiptOpts {
  mode: 'group' | 'individual';
  playerName?: string;
}

interface CommandCenterProps {
  refreshKey: number;
  setView: (v: AdminView) => void;
}

/**
 * The new admin landing surface — a stack of cards that surfaces state
 * across every admin domain (session, payments, birds, roster) so the
 * organizer can confirm "everything looks right" in 30 seconds.
 */
export default function CommandCenter({ refreshKey, setView }: CommandCenterProps) {
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
      const active = players.filter((p) => !p.removed && !p.waitlisted);
      const courtTotal = (session.costPerCourt ?? 0) * (session.courts ?? 0);
      const birdTotal = totalBirdCost(normalizeBirdUsages(session));
      const totalCost = courtTotal + birdTotal;
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
      <PageHeader>{pageT('title')}</PageHeader>

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
      <AnnouncementsCard refreshKey={composedRefresh} />
      <PaymentsCard
        refreshKey={composedRefresh}
        onOpenPlayer={openPlayer}
        onSendIndividualReceipt={(name) => openReceipt({ mode: 'individual', playerName: name })}
      />
      <RecentSessionsStrip />
      <ETransferRecipientEditor />
      <SkipDatesEditor />

      <div className="flex justify-center pt-2">
        <button
          type="button"
          onClick={() => setView('releases')}
          className="text-xs text-gray-400 hover:text-gray-200 underline-offset-2 hover:underline"
        >
          Release notes →
        </button>
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
