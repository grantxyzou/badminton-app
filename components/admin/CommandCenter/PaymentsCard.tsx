'use client';

import { useEffect, useState, useCallback } from 'react';

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
  /** Tap a player name → open their profile sheet. */
  onOpenPlayer?: (memberId: string, name: string) => void;
  /** Per-row receipt icon → opens individual receipt for that player. */
  onSendIndividualReceipt?: (playerName: string) => void;
}

export default function PaymentsCard({ refreshKey = 0, onOpenPlayer, onSendIndividualReceipt }: PaymentsCardProps) {
  const [players, setPlayers] = useState<Player[]>([]);
  const [loading, setLoading] = useState(true);
  const [togglingId, setTogglingId] = useState<string | null>(null);

  const load = useCallback(async () => {
    setLoading(true);
    try {
      const res = await fetch(`${BASE}/api/players`, { cache: 'no-store' });
      if (!res.ok) {
        setPlayers([]);
        return;
      }
      const data = (await res.json()) as Player[];
      setPlayers(Array.isArray(data) ? data.filter((p) => !p.removed && !p.waitlisted) : []);
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
    setPlayers((prev) => prev.map((p) => (p.id === player.id ? { ...p, paid: next } : p)));
    try {
      const res = await fetch(`${BASE}/api/players`, {
        method: 'PATCH',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ id: player.id, paid: next }),
      });
      if (!res.ok) {
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

  return (
    <section className="glass-card p-4 space-y-3" aria-label="Payments">
      <header>
        <h3 className="bpm-h3">Payments</h3>
        <p className="text-xs text-gray-400 mt-0.5">
          {total === 0 ? 'No active players' : `${paidCount} of ${total} paid`}
        </p>
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
                {onSendIndividualReceipt && (
                  <button
                    type="button"
                    onClick={() => onSendIndividualReceipt(player.name)}
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
    </section>
  );
}
