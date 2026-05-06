'use client';

import { useEffect, useState, useCallback, useMemo } from 'react';
import { BottomSheet, BottomSheetHeader, BottomSheetBody } from '@/components/BottomSheet';
import ResetAccessSheet from '../ResetAccessSheet';

const BASE = process.env.NEXT_PUBLIC_BASE_PATH ?? '';

interface Player {
  id: string;
  name: string;
  paid?: boolean;
  selfReportedPaid?: boolean;
  removed?: boolean;
  removedAt?: string;
  cancelledBySelf?: boolean;
  waitlisted?: boolean;
  memberId?: string;
}

interface SessionLite {
  id: string;
  datetime?: string;
  maxPlayers?: number;
}

interface PaymentsCardProps {
  refreshKey?: number;
  onOpenPlayer?: (memberId: string, name: string) => void;
  onSendIndividualReceipt?: (playerName: string) => void;
}

function fmtSessionLabel(iso: string | undefined): string {
  if (!iso) return '—';
  try {
    return new Date(iso).toLocaleDateString(undefined, { weekday: 'short', month: 'short', day: 'numeric' });
  } catch {
    return iso.slice(0, 10);
  }
}

export default function PaymentsCard({ refreshKey = 0, onOpenPlayer, onSendIndividualReceipt }: PaymentsCardProps) {
  const [sessions, setSessions] = useState<SessionLite[]>([]);
  const [activeSessionId, setActiveSessionId] = useState<string | null>(null);
  const [viewedSessionId, setViewedSessionId] = useState<string | null>(null);
  const [allPlayers, setAllPlayers] = useState<Player[]>([]);
  const [loading, setLoading] = useState(true);
  const [togglingId, setTogglingId] = useState<string | null>(null);

  // Add player
  const [addName, setAddName] = useState('');
  const [addError, setAddError] = useState('');
  const [adding, setAdding] = useState(false);

  // Per-row pending action
  const [busyId, setBusyId] = useState<string | null>(null);
  const [removedCollapsed, setRemovedCollapsed] = useState(true);

  // Action sheet state — per-row actions
  const [actionTarget, setActionTarget] = useState<Player | null>(null);
  const [actionError, setActionError] = useState('');

  // Reset-access display
  const [resetSheet, setResetSheet] = useState<{ open: boolean; playerName: string; code: string; expiresAt: number }>({
    open: false, playerName: '', code: '', expiresAt: 0,
  });

  const isCurrentSession = activeSessionId === viewedSessionId;
  const viewedSession = sessions.find((s) => s.id === viewedSessionId);

  const load = useCallback(async () => {
    setLoading(true);
    try {
      const [sessionRes, sessionsRes] = await Promise.all([
        fetch(`${BASE}/api/session`, { cache: 'no-store' }),
        fetch(`${BASE}/api/sessions`, { cache: 'no-store' }),
      ]);
      const current = sessionRes.ok ? await sessionRes.json() as SessionLite : null;
      const archived = sessionsRes.ok ? await sessionsRes.json() as SessionLite[] : [];

      const all = current ? [current, ...archived.filter((s) => s.id !== current.id)] : archived;
      const sorted = all
        .filter((s) => !!s.id)
        .sort((a, b) => (a.id < b.id ? 1 : -1));
      setSessions(sorted);
      setActiveSessionId(current?.id ?? null);
      setViewedSessionId((prev) => prev ?? current?.id ?? sorted[0]?.id ?? null);
    } catch (err) {
      // Network error / server down — render empty state rather than
      // surfacing as an unhandled rejection.
      console.warn('PaymentsCard load failed:', err);
      setSessions([]);
      setActiveSessionId(null);
    } finally {
      setLoading(false);
    }
  }, []);

  // Fetch players for the viewed session.
  const loadPlayers = useCallback(async (sessionId: string) => {
    try {
      const res = await fetch(`${BASE}/api/players?sessionId=${encodeURIComponent(sessionId)}&all=true`, { cache: 'no-store' });
      if (!res.ok) {
        setAllPlayers([]);
        return;
      }
      const data = (await res.json()) as Player[];
      setAllPlayers(Array.isArray(data) ? data : []);
    } catch (err) {
      console.warn('PaymentsCard loadPlayers failed:', err);
      setAllPlayers([]);
    }
  }, []);

  useEffect(() => { void load(); }, [load, refreshKey]);
  useEffect(() => {
    if (!viewedSessionId) return;
    void loadPlayers(viewedSessionId);
  }, [viewedSessionId, loadPlayers, refreshKey]);

  const lists = useMemo(() => {
    const active = allPlayers.filter((p) => !p.removed && !p.waitlisted);
    const waitlisted = allPlayers.filter((p) => !p.removed && p.waitlisted);
    const removed = allPlayers.filter((p) => p.removed);
    removed.sort((a, b) => {
      const at = a.removedAt ? new Date(a.removedAt).getTime() : 0;
      const bt = b.removedAt ? new Date(b.removedAt).getTime() : 0;
      return bt - at;
    });
    return { active, waitlisted, removed };
  }, [allPlayers]);

  const paidCount = lists.active.filter((p) => p.paid === true).length;
  const total = lists.active.length;

  const navIndex = useMemo(() => sessions.findIndex((s) => s.id === viewedSessionId), [sessions, viewedSessionId]);
  const canPrev = navIndex >= 0 && navIndex < sessions.length - 1;
  const canNext = navIndex > 0;

  function navSession(dir: 'prev' | 'next') {
    if (navIndex < 0) return;
    const target = dir === 'prev' ? sessions[navIndex + 1] : sessions[navIndex - 1];
    if (target) setViewedSessionId(target.id);
  }

  /* ── Actions ── */

  async function togglePaid(player: Player) {
    if (togglingId) return;
    setTogglingId(player.id);
    const next = !player.paid;
    setAllPlayers((prev) => prev.map((p) => (p.id === player.id ? { ...p, paid: next } : p)));
    try {
      const res = await fetch(`${BASE}/api/players`, {
        method: 'PATCH',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ id: player.id, paid: next, ...(isCurrentSession ? {} : { sessionId: viewedSessionId }) }),
      });
      if (!res.ok) {
        setAllPlayers((prev) => prev.map((p) => (p.id === player.id ? { ...p, paid: !next } : p)));
      }
    } catch {
      setAllPlayers((prev) => prev.map((p) => (p.id === player.id ? { ...p, paid: !next } : p)));
    } finally {
      setTogglingId(null);
    }
  }

  async function handleAdd(e: React.FormEvent) {
    e.preventDefault();
    const name = addName.trim();
    if (!name) return;
    setAdding(true);
    setAddError('');
    try {
      const res = await fetch(`${BASE}/api/players`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ name }),
      });
      if (!res.ok) {
        const data = await res.json().catch(() => ({}));
        setAddError(data.error ?? 'Failed to add.');
        return;
      }
      setAddName('');
      if (viewedSessionId) await loadPlayers(viewedSessionId);
    } catch {
      setAddError('Network error.');
    } finally {
      setAdding(false);
    }
  }

  async function handlePromote(player: Player) {
    if (busyId) return;
    setBusyId(player.id);
    try {
      const res = await fetch(`${BASE}/api/players`, {
        method: 'PATCH',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ id: player.id, waitlisted: false }),
      });
      if (!res.ok) {
        const data = await res.json().catch(() => ({}));
        alert(data.error ?? 'Failed to promote.');
        return;
      }
      if (viewedSessionId) await loadPlayers(viewedSessionId);
    } finally {
      setBusyId(null);
    }
  }

  async function handleRestore(player: Player) {
    if (busyId) return;
    setBusyId(player.id);
    try {
      const res = await fetch(`${BASE}/api/players`, {
        method: 'PATCH',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ id: player.id, removed: false, ...(isCurrentSession ? {} : { sessionId: viewedSessionId }) }),
      });
      if (!res.ok) {
        const data = await res.json().catch(() => ({}));
        alert(data.error ?? 'Failed to restore.');
        return;
      }
      if (viewedSessionId) await loadPlayers(viewedSessionId);
    } finally {
      setBusyId(null);
    }
  }

  /* ── Per-row sheet actions ── */

  async function actionRemove() {
    if (!actionTarget) return;
    if (!confirm(`Remove ${actionTarget.name} from this session?`)) return;
    setActionError('');
    try {
      const res = await fetch(`${BASE}/api/players`, {
        method: 'DELETE',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ name: actionTarget.name, ...(isCurrentSession ? {} : { sessionId: viewedSessionId }) }),
      });
      if (!res.ok) {
        const data = await res.json().catch(() => ({}));
        setActionError(data.error ?? 'Failed to remove.');
        return;
      }
      setActionTarget(null);
      if (viewedSessionId) await loadPlayers(viewedSessionId);
    } catch {
      setActionError('Network error.');
    }
  }

  async function actionResetAccess() {
    if (!actionTarget) return;
    if (!confirm(`Generate a recovery code for ${actionTarget.name}?\n\nThe code expires in 15 minutes.`)) return;
    setActionError('');
    try {
      const res = await fetch(`${BASE}/api/players/reset-access`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ playerId: actionTarget.id }),
      });
      if (!res.ok) {
        setActionError(`Failed to generate code (${res.status})`);
        return;
      }
      const body = await res.json();
      const targetName = actionTarget.name;
      setActionTarget(null);
      setResetSheet({ open: true, playerName: targetName, code: body.code, expiresAt: body.expiresAt });
    } catch {
      setActionError('Network error.');
    }
  }

  async function actionClearPin() {
    if (!actionTarget) return;
    if (!actionTarget.memberId) {
      setActionError('No linked member — cannot clear PIN.');
      return;
    }
    if (!confirm(`Clear ${actionTarget.name}'s PIN?\n\nThey'll be able to set a new one without the old one.`)) return;
    setActionError('');
    try {
      const res = await fetch(`${BASE}/api/members`, {
        method: 'PATCH',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ id: actionTarget.memberId, clearPin: true }),
      });
      if (!res.ok) {
        const data = await res.json().catch(() => ({}));
        setActionError(data.error ?? 'Failed to clear PIN.');
        return;
      }
      setActionTarget(null);
      alert(`PIN cleared for ${actionTarget.name}. They can set a new one when they next sign in.`);
    } catch {
      setActionError('Network error.');
    }
  }

  if (loading) return null;

  return (
    <section className="glass-card p-4 space-y-3" aria-label="Payments">
      {/* Session navigator */}
      {sessions.length > 1 && (
        <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', padding: '4px 2px', borderBottom: '1px solid rgba(255,255,255,0.06)', paddingBottom: 10 }}>
          <button
            type="button"
            onClick={() => navSession('prev')}
            disabled={!canPrev}
            aria-label="Previous session"
            style={{ background: 'transparent', border: 0, cursor: 'pointer', color: canPrev ? 'var(--text-primary)' : 'rgba(255,255,255,0.18)', padding: 4 }}
          >
            <span className="material-icons" style={{ fontSize: 22 }}>chevron_left</span>
          </button>
          <div style={{ textAlign: 'center' }}>
            <p style={{ fontSize: 13, fontWeight: 600, margin: 0 }}>{fmtSessionLabel(viewedSession?.datetime)}</p>
            <p style={{ fontSize: 11, margin: '2px 0 0', color: isCurrentSession ? 'var(--accent)' : 'var(--text-muted)' }}>
              {isCurrentSession ? 'Current session' : 'Past session'}
            </p>
          </div>
          <button
            type="button"
            onClick={() => navSession('next')}
            disabled={!canNext}
            aria-label="Next session"
            style={{ background: 'transparent', border: 0, cursor: 'pointer', color: canNext ? 'var(--text-primary)' : 'rgba(255,255,255,0.18)', padding: 4 }}
          >
            <span className="material-icons" style={{ fontSize: 22 }}>chevron_right</span>
          </button>
        </div>
      )}

      {/* Header */}
      <header>
        <h3 className="bpm-h3">Payments</h3>
        <p className="text-xs text-gray-400 mt-0.5">
          {total === 0 ? 'No active players' : `${paidCount} of ${total} paid`}
        </p>
      </header>

      {/* Active list */}
      {total > 0 && (
        <ul className="space-y-1" role="list">
          {lists.active.map((player) => (
            <li key={player.id} className="flex items-center justify-between gap-3 py-2">
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
                    <span className="material-icons text-base align-middle">receipt_long</span>
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
                <button
                  type="button"
                  onClick={() => { setActionTarget(player); setActionError(''); }}
                  className="text-xs text-gray-400 hover:text-gray-200 px-1 py-1"
                  aria-label={`More actions for ${player.name}`}
                  title="More"
                >
                  <span className="material-icons text-base align-middle">more_vert</span>
                </button>
              </div>
            </li>
          ))}
        </ul>
      )}

      {/* Add player (current session only) */}
      {isCurrentSession && (
        <form onSubmit={handleAdd} className="flex gap-2 pt-2" style={{ borderTop: '1px solid rgba(255,255,255,0.06)', marginTop: 4, paddingTop: 12 }}>
          <input
            type="text"
            value={addName}
            onChange={(e) => { setAddName(e.target.value); setAddError(''); }}
            placeholder="Add player by name"
            maxLength={50}
            style={{ flex: 1, fontSize: 13, padding: '8px 10px', background: 'rgba(255,255,255,0.04)', border: '1px solid rgba(255,255,255,0.12)', borderRadius: 8, color: 'var(--text-primary)' }}
          />
          <button
            type="submit"
            disabled={adding || !addName.trim()}
            className="cc-btn cc-btn-primary"
            style={{ minWidth: 64 }}
          >
            {adding ? '…' : 'Add'}
          </button>
        </form>
      )}
      {addError && <p role="alert" className="text-xs text-red-400">{addError}</p>}

      {/* Waitlist */}
      {lists.waitlisted.length > 0 && (
        <div style={{ marginTop: 4 }}>
          <p style={{ fontSize: 11, fontWeight: 700, letterSpacing: '0.16em', textTransform: 'uppercase', color: 'var(--amber)', margin: '14px 2px 6px' }}>
            {lists.waitlisted.length} waitlisted
          </p>
          <ul role="list" style={{ display: 'flex', flexDirection: 'column' }}>
            {lists.waitlisted.map((p) => (
              <li key={p.id} style={{ display: 'flex', alignItems: 'center', gap: 10, padding: '8px 0', borderBottom: '1px solid rgba(255,255,255,0.04)', fontSize: 13.5 }}>
                <span style={{ flex: 1, color: 'var(--text-secondary)' }}>{p.name}</span>
                {isCurrentSession && (
                  <button
                    type="button"
                    onClick={() => handlePromote(p)}
                    disabled={busyId === p.id}
                    className="cc-btn cc-btn-secondary"
                    style={{ fontSize: 11, padding: '4px 10px' }}
                  >
                    {busyId === p.id ? '…' : 'Promote'}
                  </button>
                )}
              </li>
            ))}
          </ul>
        </div>
      )}

      {/* Removed (collapsible) */}
      {lists.removed.length > 0 && (
        <div style={{ marginTop: 4 }}>
          <button
            type="button"
            onClick={() => setRemovedCollapsed((v) => !v)}
            style={{ background: 'transparent', border: 0, cursor: 'pointer', display: 'flex', alignItems: 'center', justifyContent: 'space-between', width: '100%', padding: '8px 2px', color: 'var(--text-secondary)' }}
            aria-expanded={!removedCollapsed}
          >
            <span style={{ fontSize: 11, fontWeight: 700, letterSpacing: '0.16em', textTransform: 'uppercase', color: 'var(--text-muted)' }}>
              {lists.removed.length} removed
            </span>
            <span className="material-icons" style={{ fontSize: 18, color: 'var(--text-muted)' }}>
              {removedCollapsed ? 'expand_more' : 'expand_less'}
            </span>
          </button>
          {!removedCollapsed && (
            <ul role="list">
              {lists.removed.map((p) => (
                <li key={p.id} style={{ display: 'flex', alignItems: 'center', gap: 10, padding: '8px 0', borderBottom: '1px solid rgba(255,255,255,0.04)', fontSize: 13.5 }}>
                  <span style={{ flex: 1, color: 'var(--text-muted)', textDecoration: 'line-through' }}>{p.name}</span>
                  {p.removedAt && (
                    <span style={{ fontSize: 10, color: 'var(--ink-faint)', fontFamily: 'var(--font-mono, "JetBrains Mono")' }}>
                      {p.cancelledBySelf ? 'cancelled' : 'removed'} {fmtSessionLabel(p.removedAt)}
                    </span>
                  )}
                  {isCurrentSession && (
                    <button
                      type="button"
                      onClick={() => handleRestore(p)}
                      disabled={busyId === p.id}
                      className="cc-btn cc-btn-secondary"
                      style={{ fontSize: 11, padding: '4px 10px' }}
                    >
                      {busyId === p.id ? '…' : 'Restore'}
                    </button>
                  )}
                </li>
              ))}
            </ul>
          )}
        </div>
      )}

      {/* Per-row action sheet */}
      <BottomSheet
        open={actionTarget !== null}
        onClose={() => { setActionTarget(null); setActionError(''); }}
        ariaLabel="Player actions"
        maxHeight="50vh"
        className="max-w-sm mx-auto"
      >
        <BottomSheetHeader className="flex items-center justify-between p-4">
          <span style={{ fontSize: 16, fontWeight: 600 }}>{actionTarget?.name ?? 'Player'}</span>
          <button
            type="button"
            onClick={() => { setActionTarget(null); setActionError(''); }}
            aria-label="Close"
            style={{ background: 'transparent', border: 'none', cursor: 'pointer', minWidth: 44, minHeight: 44, display: 'flex', alignItems: 'center', justifyContent: 'center' }}
          >
            <span className="material-icons" style={{ fontSize: 20 }}>close</span>
          </button>
        </BottomSheetHeader>
        <BottomSheetBody className="p-5 pb-8">
          <div style={{ display: 'flex', flexDirection: 'column', gap: 8 }}>
            {actionError && (
              <p role="alert" style={{ fontSize: 13, color: 'var(--color-red, #ef4444)', margin: 0 }}>
                {actionError}
              </p>
            )}
            {isCurrentSession && (
              <ActionRow icon="person_remove" label="Remove from session" onClick={actionRemove} />
            )}
            <ActionRow icon="key" label="Generate recovery code" onClick={actionResetAccess} />
            <ActionRow
              icon="lock_clock"
              label="Clear PIN"
              hint={actionTarget?.memberId ? undefined : 'No linked member'}
              disabled={!actionTarget?.memberId}
              onClick={actionClearPin}
              destructive
            />
          </div>
        </BottomSheetBody>
      </BottomSheet>

      {resetSheet.open && (
        <ResetAccessSheet
          open={resetSheet.open}
          onClose={() => setResetSheet((s) => ({ ...s, open: false }))}
          playerName={resetSheet.playerName}
          code={resetSheet.code}
          expiresAt={resetSheet.expiresAt}
        />
      )}
    </section>
  );
}

function ActionRow({
  icon,
  label,
  hint,
  onClick,
  disabled,
  destructive,
}: {
  icon: string;
  label: string;
  hint?: string;
  onClick: () => void;
  disabled?: boolean;
  destructive?: boolean;
}) {
  return (
    <button
      type="button"
      onClick={onClick}
      disabled={disabled}
      style={{
        display: 'flex',
        alignItems: 'center',
        gap: 12,
        padding: '12px 14px',
        borderRadius: 12,
        background: 'rgba(255,255,255,0.04)',
        border: '1px solid rgba(255,255,255,0.10)',
        cursor: disabled ? 'not-allowed' : 'pointer',
        textAlign: 'left',
        opacity: disabled ? 0.5 : 1,
        color: 'var(--text-primary)',
      }}
    >
      <span
        className="material-icons"
        style={{ fontSize: 20, color: destructive ? 'var(--red-soft)' : 'var(--text-secondary)' }}
      >
        {icon}
      </span>
      <span style={{ display: 'flex', flexDirection: 'column', flex: 1, minWidth: 0 }}>
        <span style={{ fontSize: 13.5, fontWeight: 500, color: destructive ? 'var(--red-soft)' : 'var(--text-primary)' }}>
          {label}
        </span>
        {hint && (
          <span style={{ fontSize: 11, color: 'var(--text-muted)', marginTop: 2 }}>{hint}</span>
        )}
      </span>
    </button>
  );
}
