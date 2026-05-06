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

function fmtDate(iso: string): string {
  if (!iso) return '—';
  try {
    return new Date(iso).toLocaleDateString(undefined, { month: 'short', day: 'numeric', year: 'numeric' });
  } catch {
    return iso.slice(0, 10);
  }
}

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

export default function PlayerProfileSheet({ open, onClose, memberId }: PlayerProfileSheetProps) {
  const [history, setHistory] = useState<History | null>(null);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState('');
  const [updatingSession, setUpdatingSession] = useState<string | null>(null);

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

  async function handleTogglePaid(entry: SessionEntry) {
    if (!memberId || updatingSession) return;
    if (!entry.attended) return;
    setUpdatingSession(entry.sessionId);
    const nextPaid = !entry.paid;

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

  return (
    <BottomSheet open={open} onClose={onClose} ariaLabel="Player profile" maxHeight="85vh" className="max-w-lg mx-auto">
      <BottomSheetHeader className="flex items-center justify-between p-4">
        <span style={{ fontSize: 16, fontWeight: 600 }}>{history?.member.name ?? 'Player'}</span>
        <button
          type="button"
          onClick={onClose}
          aria-label="Close"
          style={{
            background: 'transparent',
            border: 'none',
            cursor: 'pointer',
            minWidth: 44,
            minHeight: 44,
            display: 'flex',
            alignItems: 'center',
            justifyContent: 'center',
          }}
        >
          <span className="material-icons" style={{ fontSize: 20 }}>close</span>
        </button>
      </BottomSheetHeader>

      <BottomSheetBody className="p-5 pb-8">
        <div style={{ display: 'flex', flexDirection: 'column', gap: 16 }}>
          {loading && <p style={{ fontSize: 14, color: 'var(--text-muted)', margin: 0 }}>Loading…</p>}
          {error && (
            <p role="alert" style={{ fontSize: 13, color: 'var(--color-red, #ef4444)', margin: 0 }}>
              {error}
            </p>
          )}

          {history && !loading && (
            <>
              <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 12 }}>
                <Stat label="Sessions attended" value={history.lifetime.attended} />
                <Stat label="Times paid" value={history.lifetime.totalPaid} />
              </div>

              <section style={{ display: 'flex', flexDirection: 'column', gap: 8 }}>
                <h4 style={{
                  fontSize: 11,
                  letterSpacing: '0.06em',
                  textTransform: 'uppercase',
                  color: 'var(--text-muted)',
                  margin: 0,
                  fontWeight: 600,
                }}>
                  Recent sessions
                </h4>
                {history.sessions.length === 0 ? (
                  <p style={{ fontSize: 14, color: 'var(--text-muted)', margin: 0 }}>
                    No sessions on record yet.
                  </p>
                ) : (
                  <ul role="list" style={{ display: 'flex', flexDirection: 'column', gap: 0, listStyle: 'none', margin: 0, padding: 0 }}>
                    {history.sessions.slice(0, 12).map((s, i, arr) => (
                      <li
                        key={s.sessionId}
                        style={{
                          display: 'flex',
                          alignItems: 'center',
                          justifyContent: 'space-between',
                          gap: 12,
                          padding: '12px 0',
                          borderBottom: i < arr.length - 1 ? '1px solid var(--border-subtle, rgba(255,255,255,0.06))' : 'none',
                          fontSize: 14,
                        }}
                      >
                        <span style={{ color: 'var(--text-primary)' }}>{fmtDate(s.date)}</span>
                        <span style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
                          {!s.attended && (
                            <span style={{ fontSize: 12, color: 'var(--text-muted)' }}>Missed</span>
                          )}
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
                  <p style={{ fontSize: 12, color: 'var(--text-muted)', margin: '4px 0 0 0' }}>
                    +{history.sessions.length - 12} more older sessions
                  </p>
                )}
              </section>
            </>
          )}
        </div>
      </BottomSheetBody>
    </BottomSheet>
  );
}

function Stat({ label, value }: { label: string; value: number }) {
  return (
    <div
      style={{
        padding: 12,
        borderRadius: 12,
        background: 'var(--input-bg)',
        border: '1px solid var(--border-subtle, rgba(255,255,255,0.06))',
      }}
    >
      <p style={{ fontSize: 28, fontWeight: 600, lineHeight: 1.1, margin: 0, color: 'var(--text-primary)' }}>{value}</p>
      <p style={{ fontSize: 12, color: 'var(--text-muted)', margin: '4px 0 0 0' }}>{label}</p>
    </div>
  );
}
