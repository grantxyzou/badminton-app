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
}

interface PaymentsCardProps {
  refreshKey?: number;
}

export default function PaymentsCard({ refreshKey = 0 }: PaymentsCardProps) {
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
      // Active players only — receipts go to people who actually played.
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
            className="text-xs px-3 py-1.5 rounded-full"
            style={{
              background: 'rgba(255, 255, 255, 0.06)',
              border: '1px solid rgba(255, 255, 255, 0.12)',
            }}
            onClick={() => {
              // Group receipt sheet ships in plan 2C.
              alert('Group receipt export — coming in plan 2C');
            }}
          >
            Generate group receipt
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
              <span className="text-sm">
                {player.name}
                {player.selfReportedPaid && !player.paid && (
                  <span className="ml-2 text-xs" style={{ color: '#fcd34d' }}>self-reported</span>
                )}
              </span>
              <button
                type="button"
                onClick={() => togglePaid(player)}
                disabled={togglingId === player.id}
                className={`text-xs font-medium px-3 py-1.5 rounded-full transition-colors ${player.paid ? 'pill-paid' : 'pill-unpaid'} disabled:opacity-50`}
                aria-pressed={player.paid === true}
              >
                {togglingId === player.id ? '…' : player.paid ? 'Paid' : 'Pending'}
              </button>
            </li>
          ))}
        </ul>
      )}
    </section>
  );
}
