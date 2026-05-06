'use client';

import { useEffect, useState } from 'react';
import { BottomSheet, BottomSheetHeader, BottomSheetBody } from '@/components/BottomSheet';

const BASE = process.env.NEXT_PUBLIC_BASE_PATH ?? '';

interface SessionEntry {
  sessionId: string;
  date: string;
  attended: boolean;
  paid: boolean;
  costPerPerson: number;
}

interface History {
  member: { id: string; name: string };
  sessions: SessionEntry[];
  lifetime: { attended: number; totalPaid: number };
}

interface PlayerProfileSheetProps {
  open: boolean;
  onClose: () => void;
  memberId: string | null;
}

/**
 * Find the player record for a given (sessionId, memberId) and PATCH paid.
 * The history endpoint exposes session ids but not player ids, so we fetch
 * the session's roster, find the matching player, then PATCH.
 */
async function togglePaidForPastSession(sessionId: string, memberId: string, nextPaid: boolean): Promise<boolean> {
  const url = `${BASE}/api/players?sessionId=${encodeURIComponent(sessionId)}&all=true`;
  const res = await fetch(url, { cache: 'no-store' });
  if (!res.ok) return false;
  const players = (await res.json()) as Array<{ id: string; memberId?: string; name?: string }>;
  const target = players.find((p) => p.memberId === memberId);
  if (!target) return false;
  const patchRes = await fetch(`${BASE}/api/players`, {
    method: 'PATCH',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ id: target.id, paid: nextPaid, sessionId }),
  });
  return patchRes.ok;
}

function fmtDate(iso: string): string {
  if (!iso) return '—';
  try {
    return new Date(iso).toLocaleDateString(undefined, { month: 'short', day: 'numeric', year: 'numeric' });
  } catch {
    return iso.slice(0, 10);
  }
}

export default function PlayerProfileSheet({ open, onClose, memberId }: PlayerProfileSheetProps) {
  const [history, setHistory] = useState<History | null>(null);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState('');
  const [updatingSession, setUpdatingSession] = useState<string | null>(null);

  async function handleTogglePaid(entry: SessionEntry) {
    if (!memberId || updatingSession) return;
    if (!entry.attended) return; // can't pay for a session you didn't attend
    setUpdatingSession(entry.sessionId);
    const nextPaid = !entry.paid;
    // Optimistic
    setHistory((prev) => prev ? {
      ...prev,
      sessions: prev.sessions.map((s) =>
        s.sessionId === entry.sessionId ? { ...s, paid: nextPaid } : s,
      ),
      lifetime: {
        ...prev.lifetime,
        totalPaid: prev.lifetime.totalPaid + (nextPaid ? 1 : -1),
      },
    } : prev);

    const ok = await togglePaidForPastSession(entry.sessionId, memberId, nextPaid);
    if (!ok) {
      // Rollback
      setHistory((prev) => prev ? {
        ...prev,
        sessions: prev.sessions.map((s) =>
          s.sessionId === entry.sessionId ? { ...s, paid: !nextPaid } : s,
        ),
        lifetime: {
          ...prev.lifetime,
          totalPaid: prev.lifetime.totalPaid + (nextPaid ? -1 : 1),
        },
      } : prev);
    }
    setUpdatingSession(null);
  }

  useEffect(() => {
    if (!open || !memberId) {
      setHistory(null);
      return;
    }
    let cancelled = false;
    setLoading(true);
    setError('');
    (async () => {
      try {
        const res = await fetch(`${BASE}/api/members/${memberId}/history`, { cache: 'no-store' });
        if (cancelled) return;
        if (!res.ok) {
          setError(res.status === 404 ? 'Member not found.' : 'Failed to load history.');
          return;
        }
        setHistory((await res.json()) as History);
      } catch {
        if (!cancelled) setError('Network error.');
      } finally {
        if (!cancelled) setLoading(false);
      }
    })();
    return () => { cancelled = true; };
  }, [open, memberId]);

  return (
    <BottomSheet open={open} onClose={onClose} ariaLabel="Player profile" maxHeight="85vh">
      <BottomSheetHeader>
        <div className="flex items-center justify-between px-4 py-3">
          <h2 className="bpm-h3">{history?.member.name ?? 'Player'}</h2>
          <button type="button" onClick={onClose} className="text-gray-400 hover:text-gray-200" aria-label="Close">
            <span className="material-icons">close</span>
          </button>
        </div>
      </BottomSheetHeader>
      <BottomSheetBody>
        <div className="space-y-4 pb-6">
          {loading && <p className="text-sm text-gray-400">Loading…</p>}
          {error && <p className="text-sm text-red-400" role="alert">{error}</p>}

          {history && !loading && (
            <>
              <div className="grid grid-cols-2 gap-3">
                <Stat label="Sessions attended" value={history.lifetime.attended} />
                <Stat label="Times paid" value={history.lifetime.totalPaid} />
              </div>

              <div>
                <h4 className="text-xs text-gray-400 uppercase tracking-wide mb-2">Recent sessions</h4>
                {history.sessions.length === 0 ? (
                  <p className="text-sm text-gray-400">No sessions on record yet.</p>
                ) : (
                  <ul className="space-y-1" role="list">
                    {history.sessions.slice(0, 12).map((s) => (
                      <li
                        key={s.sessionId}
                        className="flex items-center justify-between gap-3 py-2 text-sm"
                      >
                        <span className="text-gray-200">{fmtDate(s.date)}</span>
                        <span className="flex items-center gap-2">
                          {!s.attended && <span className="text-xs text-gray-500">Missed</span>}
                          {s.attended && (
                            <button
                              type="button"
                              onClick={() => handleTogglePaid(s)}
                              disabled={updatingSession === s.sessionId}
                              className={`text-xs font-medium px-3 py-1.5 rounded-full ${s.paid ? 'pill-paid' : 'pill-unpaid'} disabled:opacity-50`}
                              aria-pressed={s.paid}
                              aria-label={`Mark ${s.paid ? 'unpaid' : 'paid'} for ${fmtDate(s.date)}`}
                              title="Tap to toggle paid status"
                            >
                              {updatingSession === s.sessionId ? '…' : s.paid ? 'Paid' : 'Unpaid'}
                            </button>
                          )}
                        </span>
                      </li>
                    ))}
                  </ul>
                )}
                {history.sessions.length > 12 && (
                  <p className="text-xs text-gray-400 mt-2">
                    +{history.sessions.length - 12} more older sessions
                  </p>
                )}
              </div>
            </>
          )}
        </div>
      </BottomSheetBody>
    </BottomSheet>
  );
}

function Stat({ label, value }: { label: string; value: number }) {
  return (
    <div className="rounded-lg p-3" style={{ background: 'rgba(255,255,255,0.04)' }}>
      <p className="bpm-h2">{value}</p>
      <p className="text-xs text-gray-400 mt-0.5">{label}</p>
    </div>
  );
}
