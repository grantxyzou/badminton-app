'use client';

import { useEffect, useState } from 'react';
import { BottomSheet, BottomSheetHeader, BottomSheetBody } from '@/components/BottomSheet';
import { fmtFullDate as fmtDate } from '@/lib/fmt';

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

type OwedReason =
  | 'counted'
  | 'paid'
  | 'written_off'
  | 'removed'
  | 'waitlisted'
  | 'unsettled_no_cost'
  | 'settled_zero_owed'
  | 'bad_datetime'
  | 'future_or_active';

interface AuditRow {
  sessionId: string;
  date: string;
  rowName: string;
  owedAmount: number;
  counted: boolean;
  reason: OwedReason;
}

interface OwedAudit {
  names: string[];
  totalOwed: number;
  countedCount: number;
  sessionCount: number;
  sessions: AuditRow[];
}

/** Short, admin-legible label for why a session is excluded from the owed total. */
const REASON_LABEL: Record<OwedReason, string> = {
  counted: 'Counted',
  paid: 'Paid',
  written_off: 'Covered',
  removed: 'Removed',
  waitlisted: 'Waitlisted',
  unsettled_no_cost: 'No cost recorded',
  settled_zero_owed: 'Settled · $0',
  bad_datetime: 'Bad date',
  future_or_active: 'Not due yet',
};

function fmtMoney(n: number): string {
  return Number.isInteger(n) ? `$${n}` : `$${n.toFixed(2)}`;
}

interface PlayerProfileSheetProps {
  open: boolean;
  onClose: () => void;
  memberId: string | null;
  /** Name from the row that opened the sheet — shown in the header
   *  immediately so the title doesn't show 'Player' until the history
   *  fetch resolves. */
  initialName?: string;
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

export default function PlayerProfileSheet({ open, onClose, memberId, initialName }: PlayerProfileSheetProps) {
  const [history, setHistory] = useState<History | null>(null);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState('');
  const [updatingSession, setUpdatingSession] = useState<string | null>(null);
  const [audit, setAudit] = useState<OwedAudit | null>(null);
  const [auditError, setAuditError] = useState(false);

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

  // Owed breakdown — explains exactly what the player's "what you owe" card shows
  // and why each excluded session is excluded. Same classifier as the card.
  useEffect(() => {
    if (!open || !memberId) {
      setAudit(null);
      setAuditError(false);
      return;
    }
    let cancelled = false;
    (async () => {
      try {
        const res = await fetch(`${BASE}/api/admin/owed-audit?memberId=${encodeURIComponent(memberId)}`, { cache: 'no-store' });
        if (cancelled) return;
        if (!res.ok) { setAuditError(true); return; }
        const data = (await res.json()) as OwedAudit;
        // Defensive: a malformed payload must surface as a load error, never a
        // crash mid-render (CLAUDE.md legible-fail).
        if (!data || typeof data.totalOwed !== 'number' || !Array.isArray(data.sessions)) {
          setAuditError(true);
          return;
        }
        setAudit(data);
        setAuditError(false);
      } catch {
        if (!cancelled) setAuditError(true);
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
    <BottomSheet open={open} onClose={onClose} ariaLabel="Player profile" maxHeight="85vh" className="max-w-sm mx-auto">
      <BottomSheetHeader className="flex items-center justify-between p-4">
        <span style={{ fontSize: 'var(--fs-lg)', fontWeight: 600 }}>
          {history?.member.name ?? initialName ?? 'Player'}
        </span>
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
          <span className="material-icons" style={{ fontSize: 'var(--fs-stat)' }}>close</span>
        </button>
      </BottomSheetHeader>

      <BottomSheetBody className="p-5 pb-8">
        <div style={{ display: 'flex', flexDirection: 'column', gap: 16 }}>
          {loading && <p style={{ fontSize: 'var(--fs-md)', color: 'var(--text-muted)', margin: 0 }}>Loading…</p>}
          {error && (
            <p role="alert" style={{ fontSize: 'var(--fs-base)', color: 'var(--color-red)', margin: 0 }}>
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
                <p style={{
                  fontSize: 'var(--fs-xs)',
                  letterSpacing: '0.06em',
                  textTransform: 'uppercase',
                  color: 'var(--text-muted)',
                  margin: 0,
                  fontWeight: 600,
                }}>
                  Recent sessions
                </p>
                {history.sessions.length === 0 ? (
                  <p style={{ fontSize: 'var(--fs-md)', color: 'var(--text-muted)', margin: 0 }}>
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
                          borderBottom: i < arr.length - 1 ? '1px solid var(--border-subtle))' : 'none',
                          fontSize: 'var(--fs-md)',
                        }}
                      >
                        <span style={{ color: 'var(--text-primary)' }}>{fmtDate(s.date)}</span>
                        <span style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
                          {!s.attended && (
                            <span style={{ fontSize: 'var(--fs-sm)', color: 'var(--text-muted)' }}>Missed</span>
                          )}
                          {s.attended && (
                            <button
                              type="button"
                              onClick={() => handleTogglePaid(s)}
                              disabled={updatingSession === s.sessionId}
                              className={`fs-sm font-medium px-3 py-1.5 rounded-full ${s.paid ? 'pill-paid' : 'pill-unpaid'} disabled:opacity-50`}
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
                  <p style={{ fontSize: 'var(--fs-sm)', color: 'var(--text-muted)', margin: '4px 0 0 0' }}>
                    +{history.sessions.length - 12} more older sessions
                  </p>
                )}
              </section>

              <section style={{ display: 'flex', flexDirection: 'column', gap: 8 }}>
                <div style={{ display: 'flex', alignItems: 'baseline', justifyContent: 'space-between', gap: 8 }}>
                  <p style={{
                    fontSize: 'var(--fs-xs)',
                    letterSpacing: '0.06em',
                    textTransform: 'uppercase',
                    color: 'var(--text-muted)',
                    margin: 0,
                    fontWeight: 600,
                  }}>
                    Owed breakdown
                  </p>
                  {audit && (
                    <span style={{ fontFamily: 'var(--font-mono)', fontSize: 'var(--fs-md)', fontWeight: 700, color: 'var(--text-primary)' }}>
                      {fmtMoney(audit.totalOwed)}
                    </span>
                  )}
                </div>

                {auditError ? (
                  <p role="alert" style={{ fontSize: 'var(--fs-base)', color: 'var(--color-red)', margin: 0 }}>
                    Couldn’t load owed breakdown.
                  </p>
                ) : !audit ? (
                  <p style={{ fontSize: 'var(--fs-base)', color: 'var(--text-muted)', margin: 0 }}>Loading…</p>
                ) : audit.sessions.length === 0 ? (
                  <p style={{ fontSize: 'var(--fs-md)', color: 'var(--text-muted)', margin: 0 }}>No billable sessions on record.</p>
                ) : (
                  <>
                    {audit.names.length > 1 && (
                      <p style={{ fontSize: 'var(--fs-sm)', color: 'var(--text-muted)', margin: 0 }}>
                        Linked names: {audit.names.join(', ')}
                      </p>
                    )}
                    <ul role="list" style={{ display: 'flex', flexDirection: 'column', gap: 0, listStyle: 'none', margin: 0, padding: 0 }}>
                      {audit.sessions.map((s, i, arr) => (
                        <li
                          key={s.sessionId}
                          style={{
                            display: 'flex',
                            alignItems: 'center',
                            justifyContent: 'space-between',
                            gap: 12,
                            padding: '10px 0',
                            borderBottom: i < arr.length - 1 ? '1px solid var(--border-subtle))' : 'none',
                            fontSize: 'var(--fs-md)',
                          }}
                        >
                          <span style={{ color: s.counted ? 'var(--text-primary)' : 'var(--text-muted)' }}>
                            {s.date ? fmtDate(s.date) : s.sessionId}
                          </span>
                          {s.counted ? (
                            <span style={{ fontFamily: 'var(--font-mono)', color: 'var(--text-primary)', whiteSpace: 'nowrap' }}>
                              {fmtMoney(s.owedAmount)}
                            </span>
                          ) : (
                            <span style={{ fontSize: 'var(--fs-sm)', color: 'var(--text-muted)', whiteSpace: 'nowrap' }}>
                              {REASON_LABEL[s.reason]}
                            </span>
                          )}
                        </li>
                      ))}
                    </ul>
                  </>
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
        borderRadius: 'var(--radius-lg)',
        background: 'var(--input-bg)',
        border: '1px solid var(--border-subtle))',
      }}
    >
      <p style={{ fontSize: 28, fontWeight: 600, lineHeight: 1.1, margin: 0, color: 'var(--text-primary)' }}>{value}</p>
      <p style={{ fontSize: 'var(--fs-sm)', color: 'var(--text-muted)', margin: '4px 0 0 0' }}>{label}</p>
    </div>
  );
}
