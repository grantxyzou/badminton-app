'use client';

import { useEffect, useState, useCallback } from 'react';
import ReceiptSheet from './ReceiptSheet';
import type { ReceiptInput } from '@/lib/receiptTemplate';
import { normalizeBirdUsages, totalBirdCost } from '@/lib/birdUsages';

const BASE = process.env.NEXT_PUBLIC_BASE_PATH ?? '';

interface Player {
  id: string;
  name: string;
  paid?: boolean;
  selfReportedPaid?: boolean;
  removed?: boolean;
  waitlisted?: boolean;
  memberId?: string;
}

interface PaymentsCardProps {
  refreshKey?: number;
  /** Tap a player name → open their profile sheet. Provided by CommandCenter. */
  onOpenPlayer?: (memberId: string, name: string) => void;
}

interface SessionForReceipt {
  datetime?: string;
  courts?: number;
  costPerCourt?: number;
  eTransferRecipient?: { name: string; email: string; memo?: string };
  birdUsage?: unknown;
  birdUsages?: unknown;
}

interface MemberSettings {
  eTransferRecipient?: { name: string; email: string; memo?: string };
}

export default function PaymentsCard({ refreshKey = 0, onOpenPlayer }: PaymentsCardProps) {
  const [players, setPlayers] = useState<Player[]>([]);
  const [session, setSession] = useState<SessionForReceipt | null>(null);
  const [memberSettings, setMemberSettings] = useState<MemberSettings | null>(null);
  const [loading, setLoading] = useState(true);
  const [togglingId, setTogglingId] = useState<string | null>(null);
  const [receiptOpen, setReceiptOpen] = useState(false);
  const [receiptInitialPlayer, setReceiptInitialPlayer] = useState<string | null>(null);
  const [receiptMode, setReceiptMode] = useState<'group' | 'individual'>('group');

  const load = useCallback(async () => {
    setLoading(true);
    try {
      const [playersRes, sessionRes, meRes] = await Promise.all([
        fetch(`${BASE}/api/players`, { cache: 'no-store' }),
        fetch(`${BASE}/api/session`, { cache: 'no-store' }),
        // members/me only returns role/hasPin by name; we need the full member doc
        // for eTransferRecipient. Fetch all admins via /api/members and pick the
        // first admin (ours). Inexpensive at the BPM scale.
        fetch(`${BASE}/api/members`, { cache: 'no-store' }),
      ]);
      const data = playersRes.ok ? ((await playersRes.json()) as Player[]) : [];
      setPlayers(Array.isArray(data) ? data.filter((p) => !p.removed && !p.waitlisted) : []);
      setSession(sessionRes.ok ? ((await sessionRes.json()) as SessionForReceipt) : null);
      const members = meRes.ok ? ((await meRes.json()) as Array<{ role?: string; eTransferRecipient?: MemberSettings['eTransferRecipient'] }>) : [];
      const admin = Array.isArray(members) ? members.find((m) => m.role === 'admin') : null;
      setMemberSettings(admin ?? null);
    } catch {
      setPlayers([]);
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => { void load(); }, [load, refreshKey]);

  async function togglePaid(player: Player) {
    if (togglingId) return;
    setTogglingId(player.id);
    const next = !player.paid;
    // Optimistic
    setPlayers((prev) => prev.map((p) => (p.id === player.id ? { ...p, paid: next } : p)));
    try {
      const res = await fetch(`${BASE}/api/players`, {
        method: 'PATCH',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ id: player.id, paid: next }),
      });
      if (!res.ok) {
        // Roll back
        setPlayers((prev) => prev.map((p) => (p.id === player.id ? { ...p, paid: !next } : p)));
      }
    } catch {
      setPlayers((prev) => prev.map((p) => (p.id === player.id ? { ...p, paid: !next } : p)));
    } finally {
      setTogglingId(null);
    }
  }

  if (loading) return null;

  const paidCount = players.filter((p) => p.paid === true).length;
  const total = players.length;

  // Build receipt input from current state.
  const recipient = session?.eTransferRecipient ?? memberSettings?.eTransferRecipient ?? null;
  const courtTotal = (session?.costPerCourt ?? 0) * (session?.courts ?? 0);
  // Cast through unknown — SessionForReceipt is a structural subset of Session
  // (only the fields we care about); normalizeBirdUsages tolerates the shape.
  const birdTotal = totalBirdCost(normalizeBirdUsages((session ?? {}) as unknown as Parameters<typeof normalizeBirdUsages>[0]));
  const totalCost = courtTotal + birdTotal;
  const costPerPerson = total > 0 && totalCost > 0 ? Math.round((totalCost / total) * 100) / 100 : 0;
  const receiptInput: ReceiptInput | null = recipient && session?.datetime ? {
    datetime: session.datetime,
    costPerPerson,
    courts: session.courts ?? 0,
    totalCost,
    playerNames: players.map((p) => p.name),
    recipient: { name: recipient.name, email: recipient.email },
    memoTemplate: recipient.memo,
  } : null;

  const canExportReceipt = receiptInput !== null;

  return (
    <section className="glass-card p-4 space-y-3" aria-label="Payments">
      <header className="flex items-center justify-between gap-3">
        <div>
          <h3 className="bpm-h3">Payments</h3>
          <p className="text-xs text-gray-400 mt-0.5">
            {total === 0 ? 'No active players' : `${paidCount} of ${total} paid`}
          </p>
        </div>
        {total > 0 && (
          <button
            type="button"
            disabled={!canExportReceipt}
            className="cc-btn cc-btn-secondary"
            title={canExportReceipt ? 'Open receipt sheet' : 'Set an e-transfer recipient first (admin settings)'}
            onClick={() => {
              setReceiptMode('group');
              setReceiptInitialPlayer(null);
              setReceiptOpen(true);
            }}
          >
            Generate receipt
          </button>
        )}
      </header>

      {total > 0 && (
        <ul className="space-y-1" role="list">
          {players.map((player) => (
            <li
              key={player.id}
              className="flex items-center justify-between gap-3 py-2"
            >
              <span className="text-sm flex items-center gap-2 flex-1 min-w-0">
                {onOpenPlayer && player.memberId ? (
                  <button
                    type="button"
                    onClick={() => onOpenPlayer(player.memberId!, player.name)}
                    className="text-left hover:underline truncate"
                  >
                    {player.name}
                  </button>
                ) : (
                  <span className="truncate">{player.name}</span>
                )}
                {player.selfReportedPaid && !player.paid && (
                  <span className="text-xs flex-shrink-0" style={{ color: '#fcd34d' }}>self-reported</span>
                )}
              </span>
              <div className="flex items-center gap-1 flex-shrink-0">
                {canExportReceipt && (
                  <button
                    type="button"
                    onClick={() => {
                      setReceiptMode('individual');
                      setReceiptInitialPlayer(player.name);
                      setReceiptOpen(true);
                    }}
                    className="text-xs text-gray-400 hover:text-gray-200 px-2 py-1"
                    aria-label={`Send receipt to ${player.name}`}
                    title="Send individual receipt"
                  >
                    <span className="material-icons text-base align-middle">receipt</span>
                  </button>
                )}
                <button
                  type="button"
                  onClick={() => togglePaid(player)}
                  disabled={togglingId === player.id}
                  className={`text-xs font-medium px-3 py-1.5 rounded-full transition-colors ${player.paid ? 'pill-paid' : 'pill-unpaid'} disabled:opacity-50`}
                  aria-pressed={player.paid === true}
                >
                  {togglingId === player.id ? '…' : player.paid ? 'Paid' : 'Pending'}
                </button>
              </div>
            </li>
          ))}
        </ul>
      )}

      <ReceiptSheet
        open={receiptOpen}
        onClose={() => setReceiptOpen(false)}
        input={receiptInput}
        initialMode={receiptMode}
        initialPlayerName={receiptInitialPlayer ?? undefined}
      />
    </section>
  );
}
