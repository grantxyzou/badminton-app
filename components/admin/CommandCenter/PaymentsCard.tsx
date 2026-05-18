'use client';

import { useEffect, useState, useCallback, useMemo } from 'react';
import { BottomSheet, BottomSheetHeader, BottomSheetBody } from '@/components/BottomSheet';
import ResetAccessSheet from '../ResetAccessSheet';
import CoverSheet from '../CoverSheet';
import { fmtSessionLabel } from '@/lib/fmt';
import { isFlagOn } from '@/lib/flags';
import type { SettledSnapshot } from '@/lib/types';

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
  /** Stamped at settle time. Frozen — survives retro edits to court/bird costs. */
  owedAmount?: number;
  writtenOff?: boolean;
}

interface SessionLite {
  id: string;
  datetime?: string;
  maxPlayers?: number;
  /** Present when the session was settled. PaymentsCard reads costPerPerson off this. */
  settled?: SettledSnapshot;
}

interface PaymentsCardProps {
  refreshKey?: number;
  onOpenPlayer?: (memberId: string, name: string) => void;
  onSendIndividualReceipt?: (playerName: string) => void;
}

export default function PaymentsCard({ refreshKey = 0, onOpenPlayer, onSendIndividualReceipt }: PaymentsCardProps) {
  const [sessions, setSessions] = useState<SessionLite[]>([]);
  const [activeSessionId, setActiveSessionId] = useState<string | null>(null);
  const [viewedSessionId, setViewedSessionId] = useState<string | null>(null);
  const [allPlayers, setAllPlayers] = useState<Player[]>([]);
  const [loading, setLoading] = useState(true);
  const [loadError, setLoadError] = useState(false);
  const [togglingId, setTogglingId] = useState<string | null>(null);
  const [toggleError, setToggleError] = useState<string | null>(null);

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
  const [coverTarget, setCoverTarget] = useState<Player | null>(null);
  const ledgerFlagOn = isFlagOn('NEXT_PUBLIC_FLAG_LEDGER');

  // Reset-access display
  const [resetSheet, setResetSheet] = useState<{ open: boolean; playerName: string; code: string; expiresAt: number }>({
    open: false, playerName: '', code: '', expiresAt: 0,
  });

  const isCurrentSession = activeSessionId === viewedSessionId;
  const viewedSession = sessions.find((s) => s.id === viewedSessionId);
  const settleFlagOn = isFlagOn('NEXT_PUBLIC_FLAG_SETTLE');
  const isViewedSettled = settleFlagOn && !!viewedSession?.settled;

  const load = useCallback(async () => {
    setLoading(true);
    setLoadError(false);
    try {
      const [sessionRes, sessionsRes] = await Promise.all([
        fetch(`${BASE}/api/session`, { cache: 'no-store' }),
        fetch(`${BASE}/api/sessions`, { cache: 'no-store' }),
      ]);
      // If either critical fetch failed, mark load error so we don't render
      // confident "0 of 0 paid" / empty list as if it were truth.
      if (!sessionRes.ok || !sessionsRes.ok) {
        setLoadError(true);
        setSessions([]);
        setActiveSessionId(null);
        return;
      }
      const current = await sessionRes.json() as SessionLite;
      const archived = await sessionsRes.json() as SessionLite[];

      const all = current ? [current, ...archived.filter((s) => s.id !== current.id)] : archived;
      const sorted = all
        .filter((s) => !!s.id)
        .sort((a, b) => (a.id < b.id ? 1 : -1));
      setSessions(sorted);
      setActiveSessionId(current?.id ?? null);
      setViewedSessionId((prev) => prev ?? current?.id ?? sorted[0]?.id ?? null);
    } catch (err) {
      console.warn('PaymentsCard load failed:', err);
      setLoadError(true);
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

  // Auto-dismiss the paid-toggle error after 4.5s. Without this, the banner
  // sticks around until the next toggle attempt, which can read as
  // "still failing" after a successful retry. Closes #62.
  useEffect(() => {
    if (!toggleError) return;
    const t = setTimeout(() => setToggleError(null), 4500);
    return () => clearTimeout(t);
  }, [toggleError]);
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

  const total = lists.active.length;

  /* ── Actions ── */

  async function togglePaid(player: Player) {
    if (togglingId) return;
    setTogglingId(player.id);
    setToggleError(null);
    const next = !player.paid;
    setAllPlayers((prev) => prev.map((p) => (p.id === player.id ? { ...p, paid: next } : p)));
    try {
      const res = await fetch(`${BASE}/api/players`, {
        method: 'PATCH',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ id: player.id, paid: next, ...(isCurrentSession ? {} : { sessionId: viewedSessionId }) }),
      });
      if (!res.ok) {
        // Roll back + surface so admin doesn't think they misclicked.
        setAllPlayers((prev) => prev.map((p) => (p.id === player.id ? { ...p, paid: !next } : p)));
        const data = await res.json().catch(() => ({}));
        setToggleError(`Couldn't update ${player.name}: ${data.error ?? `HTTP ${res.status}`}`);
      }
    } catch {
      setAllPlayers((prev) => prev.map((p) => (p.id === player.id ? { ...p, paid: !next } : p)));
      setToggleError(`Couldn't update ${player.name}: network error`);
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
      {/* Session selector — horizontal chips replace the old prev/next
          chevrons AND the standalone RecentSessionsStrip card (merged here).
          Built from the already-loaded `sessions` list (newest-first by id),
          so every past session stays reachable with no extra fetch. The
          "Payments / X of Y paid" header was removed by design — per-row
          Paid/Pending pills already carry that signal. */}
      {sessions.length > 0 && (
        <div
          role="tablist"
          aria-label="Session"
          className="cc-no-scrollbar flex gap-2 overflow-x-auto -mx-1 px-1 pb-1"
        >
          {sessions.map((s) => {
            const selected = s.id === viewedSessionId;
            const isActive = s.id === activeSessionId;
            const sent = settleFlagOn && !!s.settled;
            return (
              <button
                key={s.id}
                type="button"
                role="tab"
                aria-selected={selected ? 'true' : 'false'}
                onClick={() => setViewedSessionId(s.id)}
                className="cc-session-chip flex-shrink-0"
              >
                <span style={{ fontSize: 13, fontWeight: 600, display: 'block' }}>
                  {fmtSessionLabel(s.datetime)}
                </span>
                <span style={{ fontSize: 10.5, display: 'block', marginTop: 2, opacity: 0.7 }}>
                  {isActive ? 'Current' : sent ? 'Sent' : 'Past'}
                </span>
              </button>
            );
          })}
        </div>
      )}

      {/* Load-error affordance preserved from the removed header (the
          lying-empty-state rule forbids dropping it). */}
      {loadError && (
        <p role="alert" className="text-xs" style={{ color: 'var(--color-red, #ef4444)', margin: 0 }}>
          Couldn&apos;t load — refresh to retry
        </p>
      )}

      {isViewedSettled && (
        <div className="flex justify-end">
          <span
            className="text-xs px-2 py-1 rounded-full flex-shrink-0"
            style={{
              background: 'rgba(168, 85, 247, 0.15)',
              color: '#d8b4fe',
              border: '1px solid rgba(168, 85, 247, 0.3)',
            }}
            title={`Bill sent — $${viewedSession?.settled?.costPerPerson} each · ${viewedSession?.settled?.playerCount} of us`}
          >
            Sent · ${viewedSession?.settled?.costPerPerson}
          </span>
        </div>
      )}

      {/* Empty state — kept distinct from loadError (lying-empty-state
          rule). The "X of Y paid" count was removed by design; this is
          the no-roster case, not the count. */}
      {!loadError && total === 0 && (
        <p className="text-xs" style={{ color: 'var(--text-muted)', margin: 0 }}>
          No active players
        </p>
      )}

      {toggleError && (
        <p
          role="alert"
          style={{
            fontSize: 12,
            color: 'var(--color-red, #ef4444)',
            margin: 0,
            padding: '8px 12px',
            background: 'rgba(239,68,68,0.06)',
            border: '1px solid rgba(239,68,68,0.2)',
            borderRadius: 8,
          }}
        >
          {toggleError}
        </p>
      )}

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
                {settleFlagOn && typeof player.owedAmount === 'number' && (
                  <span
                    className="text-xs font-medium px-2"
                    style={{
                      color: '#d8b4fe',
                      fontFamily: 'var(--font-mono), ui-monospace, monospace',
                    }}
                    title="What they owe — frozen when the bill went out."
                  >
                    ${player.owedAmount}
                  </span>
                )}
                <button
                  type="button"
                  onClick={() => togglePaid(player)}
                  disabled={togglingId === player.id}
                  className={`text-xs font-medium px-3 py-1.5 rounded-full transition-colors inline-flex items-center gap-1 ${player.paid ? 'pill-paid' : 'pill-unpaid'} disabled:opacity-50`}
                  aria-pressed={player.paid === true}
                >
                  {togglingId === player.id ? (
                    '…'
                  ) : player.paid ? (
                    <>
                      <span className="material-icons" style={{ fontSize: 14 }} aria-hidden="true">
                        check_circle
                      </span>
                      Paid
                    </>
                  ) : (
                    'Pending'
                  )}
                </button>
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

      {/* Add player (current session only). No hard divider — visual
          break is the form's own layout. Input inherits the canonical
          form styles from globals.css (which include focus ring + light
          mode); we only set flex on the wrapper. */}
      {isCurrentSession && (
        <form onSubmit={handleAdd} style={{ display: 'flex', gap: 8, paddingTop: 8 }}>
          <input
            type="text"
            value={addName}
            onChange={(e) => { setAddName(e.target.value); setAddError(''); }}
            placeholder="Add player by name"
            maxLength={50}
            style={{ flex: 1 }}
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
            {ledgerFlagOn && typeof actionTarget?.owedAmount === 'number' && actionTarget.owedAmount > 0 && !actionTarget.writtenOff && (
              <ActionRow
                icon="paid"
                label={`Cover their $${actionTarget.owedAmount}`}
                onClick={() => {
                  setCoverTarget(actionTarget);
                  setActionTarget(null);
                }}
              />
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

      {coverTarget && (
        <CoverSheet
          open
          mode="cover-only"
          playerId={coverTarget.id}
          playerName={coverTarget.name}
          amount={coverTarget.owedAmount ?? 0}
          sessionId={viewedSessionId ?? ''}
          sessionLabel={fmtSessionLabel(viewedSession?.datetime)}
          onClose={() => setCoverTarget(null)}
          onCovered={() => {
            setCoverTarget(null);
            void load();
          }}
        />
      )}
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
