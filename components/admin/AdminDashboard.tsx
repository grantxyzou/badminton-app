'use client';

import { useState, useEffect, useCallback } from 'react';
import { createPortal } from 'react-dom';
import type { AdminView } from './types';
import type { Session, Player, Announcement, Alias } from '@/lib/types';
import { ShimmerLoader } from '../ShuttleLoader';
import SessionContextBar from './SessionContextBar';
import VenueSummary from './VenueSummary';
import SessionDetailsEditor from './SessionDetailsEditor';
import DateTimeEditor from './DateTimeEditor';
import MembersView from './MembersView';
import BirdInventoryView from './BirdInventoryView';
import AdvanceSessionForm from './AdvanceSessionForm';

const BASE = process.env.NEXT_PUBLIC_BASE_PATH ?? '';

/* ── Helpers ── */

function fmtSessionLabel(datetime: string | undefined): string {
  if (!datetime) return '';
  const d = new Date(datetime);
  const now = new Date();
  const todayStart = new Date(now.getFullYear(), now.getMonth(), now.getDate());
  const sessionStart = new Date(d.getFullYear(), d.getMonth(), d.getDate());
  const diffDays = Math.round((sessionStart.getTime() - todayStart.getTime()) / 86_400_000);
  if (diffDays === 0) return 'TODAY';
  if (diffDays > 0 && diffDays <= 7)
    return d.toLocaleDateString(undefined, { weekday: 'long' }).toUpperCase();
  return d.toLocaleDateString(undefined, { month: 'short', day: 'numeric' }).toUpperCase();
}

function fmtSessionNav(datetime: string) {
  if (!datetime) return '\u2014';
  try {
    return new Date(datetime).toLocaleDateString(undefined, { weekday: 'short', month: 'short', day: 'numeric' });
  } catch { return datetime; }
}

/* ── Main component ── */

interface Props {
  onLogout: () => void;
}

export default function AdminDashboard({ onLogout }: Props) {
  const [view, setView] = useState<AdminView>('dashboard');
  const [refreshKey, setRefreshKey] = useState(0);

  const goBack = useCallback(() => {
    setRefreshKey(k => k + 1);
    setView('dashboard');
  }, []);

  /* ── Drill-down routing ── */
  if (view === 'session-details') return <div className="animate-slideInRight"><SessionDetailsEditor onBack={goBack} /></div>;
  if (view === 'date-time') return <div className="animate-slideInRight"><DateTimeEditor onBack={goBack} /></div>;
  if (view === 'members') return <div className="animate-slideInRight"><MembersView onBack={goBack} /></div>;
  if (view === 'birds') return <div className="animate-slideInRight"><BirdInventoryView onBack={goBack} /></div>;
  if (view === 'advance') return <div className="animate-slideInRight"><AdvanceSessionForm onBack={goBack} /></div>;

  return <Dashboard onLogout={onLogout} refreshKey={refreshKey} setView={setView} />;
}

/* ── Dashboard view ── */

interface DashboardProps {
  onLogout: () => void;
  refreshKey: number;
  setView: (v: AdminView) => void;
}

function Dashboard({ onLogout, refreshKey, setView }: DashboardProps) {
  /* ── Session state ── */
  const [session, setSession] = useState<Session | null>(null);

  /* ── Player state ── */
  const [players, setPlayers] = useState<Player[]>([]);
  const [waitlistPlayers, setWaitlistPlayers] = useState<Player[]>([]);
  const [removedPlayers, setRemovedPlayers] = useState<Player[]>([]);
  const [aliases, setAliases] = useState<Alias[]>([]);
  const [loading, setLoading] = useState(true);
  const [name, setName] = useState('');
  const [adding, setAdding] = useState(false);
  const [addError, setAddError] = useState('');
  const [removingId, setRemovingId] = useState<string | null>(null);
  const [togglingId, setTogglingId] = useState<string | null>(null);
  const [savedId, setSavedId] = useState<string | null>(null);
  const [moreMenuOpen, setMoreMenuOpen] = useState(false);
  const [confirmingPurgeId, setConfirmingPurgeId] = useState<string | null>(null);
  const [restoreError, setRestoreError] = useState('');
  const [confirmingClear, setConfirmingClear] = useState(false);
  const [clearMode, setClearMode] = useState<'soft' | 'hard'>('soft');
  const [clearError, setClearError] = useState('');
  const [cancelledCollapsed, setCancelledCollapsed] = useState(false);
  const [promotingId, setPromotingId] = useState<string | null>(null);
  const [promoteError, setPromoteError] = useState('');

  /* ── Session history navigation ── */
  const [allSessions, setAllSessions] = useState<Session[]>([]);
  const [viewedSessionId, setViewedSessionId] = useState<string | null>(null);
  const [activeSessionId, setActiveSessionId] = useState<string | null>(null);

  const isViewingActive = !viewedSessionId || viewedSessionId === activeSessionId;
  const viewedIndex = allSessions.findIndex(s => s.id === (viewedSessionId ?? activeSessionId));
  const canGoPrev = viewedIndex < allSessions.length - 1;
  const canGoNext = viewedIndex > 0;
  const viewedSession = allSessions.find(s => s.id === (viewedSessionId ?? activeSessionId));

  /* ── Announcement state ── */
  const [announcements, setAnnouncements] = useState<Announcement[]>([]);
  const [draft, setDraft] = useState('');
  const [polished, setPolished] = useState('');
  const [polishing, setPolishing] = useState(false);
  const [posting, setPosting] = useState(false);
  const [postError, setPostError] = useState('');
  const [deletePostError, setDeletePostError] = useState('');
  const [editingAnnoId, setEditingAnnoId] = useState<string | null>(null);
  const [editAnnoText, setEditAnnoText] = useState('');
  const [editAnnoError, setEditAnnoError] = useState('');
  const [savingAnno, setSavingAnno] = useState(false);

  /* ── Data loading ── */

  const loadPlayers = useCallback(async (sessionIdOverride?: string) => {
    setLoading(true);
    try {
      const sessionParam = sessionIdOverride ? `&sessionId=${encodeURIComponent(sessionIdOverride)}` : '';
      const [pRes, sRes, aRes, sessionsRes] = await Promise.all([
        fetch(`${BASE}/api/players?all=true${sessionParam}`),
        fetch(`${BASE}/api/session`),
        fetch(`${BASE}/api/aliases`, { cache: 'no-store' }),
        fetch(`${BASE}/api/sessions`, { cache: 'no-store' }),
      ]);
      if (pRes.ok) {
        const all: Player[] = await pRes.json();
        setPlayers(all.filter(p => !p.removed && !p.waitlisted));
        setWaitlistPlayers(all.filter(p => !p.removed && !!p.waitlisted));
        setRemovedPlayers(all.filter(p => p.removed));
      }
      if (sRes.ok) {
        const activeSession: Session = await sRes.json();
        setSession(activeSession);
        if (!sessionIdOverride) setActiveSessionId(activeSession.id);
      }
      if (aRes.ok) setAliases(await aRes.json());
      if (sessionsRes.ok) {
        const sessions: Session[] = await sessionsRes.json();
        setAllSessions(sessions.sort((a, b) => b.datetime.localeCompare(a.datetime)));
      }
    } finally {
      setLoading(false);
    }
  }, []);

  const loadAnnouncements = useCallback(async () => {
    const res = await fetch(`${BASE}/api/announcements`);
    if (res.ok) setAnnouncements(await res.json());
  }, []);

  useEffect(() => {
    loadPlayers();
    loadAnnouncements();
  }, [loadPlayers, loadAnnouncements, refreshKey]);

  /* ── Session navigation ── */

  function navigateSession(direction: 'prev' | 'next') {
    const idx = viewedIndex;
    const newIdx = direction === 'prev' ? idx + 1 : idx - 1;
    if (newIdx >= 0 && newIdx < allSessions.length) {
      const newSession = allSessions[newIdx];
      setViewedSessionId(newSession.id);
      loadPlayers(newSession.id === activeSessionId ? undefined : newSession.id);
    }
  }

  /* ── Player handlers ── */

  async function handleAddPlayer(e: React.FormEvent) {
    e.preventDefault();
    if (!name.trim()) return;
    setAdding(true);
    setAddError('');
    try {
      const res = await fetch(`${BASE}/api/players`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ name: name.trim(), ...(!isViewingActive && viewedSessionId ? { sessionId: viewedSessionId } : {}) }),
      });
      const data = await res.json();
      if (!res.ok) {
        setAddError(data.error ?? 'Failed to add player.');
      } else {
        setName('');
        loadPlayers(!isViewingActive && viewedSessionId ? viewedSessionId : undefined);
      }
    } catch {
      setAddError('Network error.');
    } finally {
      setAdding(false);
    }
  }

  async function handleTogglePaid(player: Player) {
    setTogglingId(player.id);
    try {
      const res = await fetch(`${BASE}/api/players`, {
        method: 'PATCH',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ id: player.id, paid: !player.paid, ...(!isViewingActive && viewedSessionId ? { sessionId: viewedSessionId } : {}) }),
      });
      if (res.ok) {
        setPlayers(prev => prev.map(p => p.id === player.id ? { ...p, paid: !player.paid } : p));
        setSavedId(player.id);
        setTimeout(() => setSavedId(null), 1200);
      }
    } finally {
      setTogglingId(null);
    }
  }

  async function handleRemove(player: Player) {
    setRemovingId(player.id);
    try {
      const res = await fetch(`${BASE}/api/players`, {
        method: 'DELETE',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ name: player.name, ...(!isViewingActive && viewedSessionId ? { sessionId: viewedSessionId } : {}) }),
      });
      if (res.ok) {
        setPlayers(prev => prev.filter(p => p.id !== player.id));
        setWaitlistPlayers(prev => prev.filter(p => p.id !== player.id));
        setRemovedPlayers(prev => [...prev, { ...player, removed: true }]);
      } else {
        setAddError('Failed to remove player. Please try again.');
      }
    } finally {
      setRemovingId(null);
    }
  }

  async function handleRestore(player: Player) {
    setRestoreError('');
    try {
      const res = await fetch(`${BASE}/api/players`, {
        method: 'PATCH',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ id: player.id, removed: false, ...(!isViewingActive && viewedSessionId ? { sessionId: viewedSessionId } : {}) }),
      });
      if (res.ok) {
        setRemovedPlayers(prev => prev.filter(p => p.id !== player.id));
        loadPlayers();
      } else {
        const data = await res.json().catch(() => ({}));
        setRestoreError(data.error === 'Session is full' ? 'Session is full \u2014 cannot restore.' : 'Failed to restore. Please try again.');
      }
    } catch {
      setRestoreError('Failed to restore. Please try again.');
    }
  }

  async function handlePromote(player: Player) {
    setPromoteError('');
    setPromotingId(player.id);
    try {
      const res = await fetch(`${BASE}/api/players`, {
        method: 'PATCH',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ id: player.id, waitlisted: false, ...(!isViewingActive && viewedSessionId ? { sessionId: viewedSessionId } : {}) }),
      });
      if (res.ok) {
        loadPlayers();
      } else {
        const data = await res.json().catch(() => ({}));
        setPromoteError(data.error === 'Session is full' ? 'Session is full \u2014 cannot promote.' : 'Failed to promote. Please try again.');
      }
    } catch {
      setPromoteError('Failed to promote. Please try again.');
    } finally {
      setPromotingId(null);
    }
  }

  async function handlePurgeSingle(player: Player) {
    try {
      const res = await fetch(`${BASE}/api/players`, {
        method: 'DELETE',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ purgeOne: player.id, name: player.name, ...(!isViewingActive && viewedSessionId ? { sessionId: viewedSessionId } : {}) }),
      });
      if (res.ok) {
        setRemovedPlayers(prev => prev.filter(p => p.id !== player.id));
      }
    } catch { /* silent */ }
  }

  function handleExportCSV() {
    const aliasMap = new Map(aliases.map(a => [a.appName.toLowerCase(), a.etransferName]));
    const allForExport = [
      ...players.map(p => ({ ...p, onWaitlist: false })),
      ...waitlistPlayers.map(p => ({ ...p, onWaitlist: true })),
    ];
    const rows = [
      ['#', 'Name', 'E-Transfer Name', 'Waitlisted', 'Signed Up', 'Paid'],
      ...allForExport.map((p, i) => [
        String(i + 1),
        p.name,
        aliasMap.get(p.name.toLowerCase()) ?? '',
        p.onWaitlist ? 'Yes' : 'No',
        new Date(p.timestamp).toLocaleString(),
        p.paid ? 'Yes' : 'No',
      ]),
    ];
    const csv = rows.map(r => r.map(c => `"${c.replace(/"/g, '""')}"`).join(',')).join('\n');
    const a = document.createElement('a');
    a.href = URL.createObjectURL(new Blob([csv], { type: 'text/csv' }));
    const dateStr = session?.datetime ? session.datetime.slice(0, 10) : new Date().toISOString().slice(0, 10);
    a.download = `players-${dateStr}.csv`;
    a.click();
  }

  async function handleClearSession() {
    setClearError('');
    try {
      const res = await fetch(`${BASE}/api/players`, {
        method: 'DELETE',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ clearAll: true }),
      });
      if (res.ok) {
        setConfirmingClear(false);
        loadPlayers();
      } else {
        setClearError('Failed to clear. Please try again.');
      }
    } catch {
      setClearError('Failed to clear. Please try again.');
    }
  }

  async function handlePurgeAll() {
    setClearError('');
    try {
      const res = await fetch(`${BASE}/api/players`, {
        method: 'DELETE',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ purgeAll: true }),
      });
      if (res.ok) {
        setConfirmingClear(false);
        loadPlayers();
      } else {
        setClearError('Failed to purge. Please try again.');
      }
    } catch {
      setClearError('Failed to purge. Please try again.');
    }
  }

  /* ── Announcement handlers ── */

  async function handlePolish() {
    if (!draft.trim()) return;
    setPolishing(true);
    setPolished('');
    setPostError('');
    try {
      const res = await fetch(`${BASE}/api/claude`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          prompt: `Polish this badminton club announcement. Keep it concise, friendly, and clear. Return only the improved text with no explanation:\n\n${draft}`,
        }),
      });
      const data = await res.json();
      if (!res.ok) {
        setPostError(data.error ?? 'AI polish failed. Please try again.');
      } else {
        setPolished(data.text ?? '');
      }
    } catch {
      setPostError('Network error. Please try again.');
    } finally {
      setPolishing(false);
    }
  }

  async function handlePost(text: string) {
    if (!text.trim()) return;
    setPosting(true);
    try {
      const res = await fetch(`${BASE}/api/announcements`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ text }),
      });
      if (res.ok) {
        setDraft('');
        setPolished('');
        setPostError('');
        loadAnnouncements();
      } else {
        const data = await res.json().catch(() => ({}));
        setPostError(data.error ?? 'Failed to post. Please try again.');
      }
    } finally {
      setPosting(false);
    }
  }

  async function handleDeleteAnnouncement(id: string) {
    setDeletePostError('');
    try {
      const res = await fetch(`${BASE}/api/announcements`, {
        method: 'DELETE',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ id }),
      });
      if (res.ok) {
        loadAnnouncements();
      } else {
        setDeletePostError('Failed to delete. Please try again.');
      }
    } catch {
      setDeletePostError('Failed to delete. Please try again.');
    }
  }

  function startEditAnno(a: Announcement) {
    setEditingAnnoId(a.id);
    setEditAnnoText(a.text);
    setEditAnnoError('');
  }

  async function handleSaveAnno(id: string) {
    setSavingAnno(true);
    setEditAnnoError('');
    try {
      const res = await fetch(`${BASE}/api/announcements`, {
        method: 'PATCH',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ id, text: editAnnoText }),
      });
      if (res.ok) {
        setEditingAnnoId(null);
        loadAnnouncements();
      } else {
        const d = await res.json().catch(() => ({}));
        setEditAnnoError(d.error ?? 'Failed to save');
      }
    } catch {
      setEditAnnoError('Network error');
    } finally {
      setSavingAnno(false);
    }
  }

  /* ── Render ── */

  return (
    <div className="space-y-4 w-full">
      {/* Header */}
      <div className="flex items-center justify-between px-1">
        <h2 className="font-semibold text-green-400">Admin</h2>
        <button
          onClick={onLogout}
          className="text-xs text-gray-400 hover:text-white transition-colors flex items-center gap-1"
        >
          <span className="material-icons" style={{ fontSize: 16 }}>logout</span>
          Sign out
        </button>
      </div>

      {/* Session context */}
      <SessionContextBar session={session} onEditDates={() => setView('date-time')} />
      <VenueSummary session={session} onEdit={() => setView('session-details')} />

      {/* ── Players card ── */}
      <div className="space-y-3">
        {/* Session navigator */}
        {allSessions.length > 1 && (
          <div className="glass-card p-4 flex items-center justify-between">
            <button
              type="button"
              onClick={() => navigateSession('prev')}
              disabled={!canGoPrev}
              className="text-white disabled:opacity-20 transition-opacity p-1"
              aria-label="Previous session"
            >
              <span className="material-icons" style={{ fontSize: 24 }}>chevron_left</span>
            </button>
            <div className="text-center">
              <p className="text-sm font-semibold text-white">
                {viewedSession ? fmtSessionNav(viewedSession.datetime) : '\u2014'}
              </p>
              {isViewingActive ? (
                <p className="text-xs text-green-400 font-medium">Current session</p>
              ) : (
                <p className="text-xs text-gray-400">Past session</p>
              )}
            </div>
            <button
              type="button"
              onClick={() => navigateSession('next')}
              disabled={!canGoNext}
              className="text-white disabled:opacity-20 transition-opacity p-1"
              aria-label="Next session"
            >
              <span className="material-icons" style={{ fontSize: 24 }}>chevron_right</span>
            </button>
          </div>
        )}

        {/* Add player form */}
        <form onSubmit={handleAddPlayer} className="glass-card p-5 space-y-3">
          <h3 className="section-label">ADD PLAYER</h3>
          <div className="flex gap-2">
            <input
              type="text"
              placeholder="Player name"
              aria-label="Player name"
              aria-describedby={addError ? 'add-error' : undefined}
              value={name}
              onChange={e => setName(e.target.value)}
              maxLength={50}
            />
            <button type="submit" disabled={adding || !name.trim()} className="btn-primary" style={{ whiteSpace: 'nowrap' }}>
              {adding ? '\u2026' : 'Add'}
            </button>
          </div>
          {addError && <p id="add-error" role="alert" className="text-red-400 text-xs">{addError}</p>}
        </form>

        {/* Player list */}
        <div className="glass-card overflow-hidden">
          {loading ? (
            <div className="px-4"><ShimmerLoader lines={4} /></div>
          ) : players.length === 0 ? (
            <p className="text-center text-gray-500 text-sm p-8">No players signed up yet.</p>
          ) : (
            <div>
              <div className="list-header-green flex items-center justify-between">
                <span>
                  {players.length} PLAYER{players.length !== 1 ? 'S' : ''}
                </span>
                <div className="flex items-center gap-2">
                  <button
                    onClick={handleExportCSV}
                    className="text-xs font-normal hover:text-green-300 transition-colors flex items-center gap-1"
                  >
                    <span className="material-icons" style={{ fontSize: 13 }}>download</span>
                    Export CSV
                  </button>
                  <div className="relative">
                    <button
                      onClick={() => setMoreMenuOpen(o => !o)}
                      className="hover:text-green-300 transition-colors p-0.5"
                      aria-label="More actions"
                    >
                      <span className="material-icons" style={{ fontSize: 18 }}>more_vert</span>
                    </button>
                    {moreMenuOpen && (
                      <>
                        <div onClick={() => setMoreMenuOpen(false)} style={{ position: 'fixed', inset: 0, zIndex: 50 }} />
                        <div className="absolute right-0 top-full mt-1 z-50 w-52 rounded-xl overflow-hidden border border-white/10" style={{ background: 'var(--dropdown-bg)', backdropFilter: 'blur(12px)' }}>
                          <button
                            onClick={() => { setMoreMenuOpen(false); setClearMode('soft'); setClearError(''); setConfirmingClear(true); }}
                            className="w-full text-left px-4 py-3 text-sm text-gray-300 hover:bg-white/10 transition-colors flex items-center gap-3"
                          >
                            <span className="material-icons text-gray-500" style={{ fontSize: 18 }}>delete_sweep</span>
                            Clear Session
                          </button>
                          <button
                            onClick={() => { setMoreMenuOpen(false); setClearMode('hard'); setClearError(''); setConfirmingClear(true); }}
                            className="w-full text-left px-4 py-3 text-sm text-red-400 hover:bg-white/10 transition-colors flex items-center gap-3"
                          >
                            <span className="material-icons" style={{ fontSize: 18 }}>delete_forever</span>
                            Purge All Records
                          </button>
                        </div>
                      </>
                    )}
                  </div>
                </div>
              </div>
              <div className="divide-y" style={{ borderColor: 'var(--divider)' }}>
                {players.map((player, i) => (
                  <div key={player.id} className="flex items-center px-4 py-3 gap-3">
                    <span className="text-xs text-gray-500 w-5 text-right font-mono tabular-nums">{i + 1}</span>
                    <span className="flex-1 text-sm text-gray-200 font-medium">{player.name}</span>
                    {player.selfReportedPaid && !player.paid && (
                      <span className="text-[9px] font-medium px-1.5 py-0.5 rounded-full" style={{ background: 'rgba(251,191,36,0.15)', color: '#fbbf24' }}>
                        reported
                      </span>
                    )}
                    <button
                      onClick={() => handleTogglePaid(player)}
                      disabled={togglingId === player.id}
                      className={`text-xs font-medium transition-colors px-2 py-0.5 rounded-full ${player.paid ? 'pill-paid' : 'pill-unpaid'}`}
                    >
                      {savedId === player.id ? '\u2713' : togglingId === player.id ? '\u2026' : player.paid ? 'Paid' : 'Pending'}
                    </button>
                    <button
                      onClick={() => handleRemove(player)}
                      disabled={removingId === player.id}
                      className="text-xs text-gray-500 hover:text-amber-400 transition-colors p-1 flex items-center gap-1"
                      title={`Remove ${player.name}`}
                    >
                      <span className="material-icons" style={{ fontSize: 16 }}>person_remove</span>
                      <span className="hidden sm:inline">Remove</span>
                    </button>
                  </div>
                ))}
              </div>
            </div>
          )}
        </div>

        {/* Waitlisted players */}
        {promoteError && (
          <p role="alert" className="text-xs text-red-400 px-1">{promoteError}</p>
        )}
        {waitlistPlayers.length > 0 && (
          <div className="glass-card overflow-hidden">
            <div className="list-header-amber">
              {waitlistPlayers.length} WAITLISTED
            </div>
            <div className="divide-y" style={{ borderColor: 'var(--divider)' }}>
              {waitlistPlayers.map((player, i) => (
                <div key={player.id} className="flex items-center px-4 py-3 gap-3">
                  <span className="text-xs text-gray-500 w-5 text-right font-mono tabular-nums">{players.length + i + 1}</span>
                  <span className="flex-1 text-sm text-gray-300 font-medium">{player.name}</span>
                  <button
                    onClick={() => handlePromote(player)}
                    disabled={promotingId === player.id}
                    className="text-xs text-amber-400 hover:text-amber-300 transition-colors py-2 px-1"
                  >
                    {promotingId === player.id ? '\u2026' : 'Promote'}
                  </button>
                  <button
                    onClick={() => handleRemove(player)}
                    disabled={removingId === player.id}
                    className="text-xs text-gray-500 hover:text-red-400 transition-colors p-1 flex items-center gap-1"
                    title={`Remove ${player.name}`}
                  >
                    <span className="material-icons" style={{ fontSize: 16 }}>person_remove</span>
                    <span className="hidden sm:inline">Remove</span>
                  </button>
                </div>
              ))}
            </div>
          </div>
        )}

        {/* Removed players */}
        {restoreError && (
          <p role="alert" className="text-xs text-red-400 px-1">{restoreError}</p>
        )}
        {removedPlayers.length > 0 && (
          <div className="glass-card overflow-hidden">
            <div
              className="list-header-amber flex items-center justify-between"
              style={cancelledCollapsed ? { borderBottom: 'none' } : undefined}
            >
              <span>
                {removedPlayers.length} REMOVED
                {session?.datetime ? <span style={{ fontWeight: 400, opacity: 0.6 }}> &middot; {fmtSessionLabel(session.datetime)}</span> : null}
              </span>
              <button
                type="button"
                onClick={() => setCancelledCollapsed(c => !c)}
                aria-label={cancelledCollapsed ? 'Expand cancelled list' : 'Collapse cancelled list'}
                className="bg-transparent border-0 cursor-pointer text-amber-400/65 p-0 flex items-center"
              >
                <span className="material-icons icon-md">
                  {cancelledCollapsed ? 'expand_more' : 'expand_less'}
                </span>
              </button>
            </div>
            {!cancelledCollapsed && (
            <div className="divide-y" style={{ borderColor: 'var(--divider)' }}>
              {[...removedPlayers]
                .sort((a, b) => {
                  const at = a.removedAt ? new Date(a.removedAt).getTime() : 0;
                  const bt = b.removedAt ? new Date(b.removedAt).getTime() : 0;
                  return bt - at;
                })
                .map((player, i) => (
                <div key={player.id} className="flex items-center px-4 py-3 gap-3">
                  <span className="text-xs text-gray-500 w-5 text-right font-mono tabular-nums">{i + 1}</span>
                  <div className="flex-1 min-w-0">
                    <span className="text-sm text-gray-500 font-medium line-through">{player.name}</span>
                    {player.removedAt && (
                      <p className="text-xs text-gray-500 mt-0.5">
                        {player.cancelledBySelf ? 'Cancelled' : 'Removed'} &middot; {new Date(player.removedAt).toLocaleString(undefined, {
                          month: 'short', day: 'numeric',
                          hour: '2-digit', minute: '2-digit',
                        })}
                      </p>
                    )}
                  </div>
                  <button
                    onClick={() => handleRestore(player)}
                    className="text-xs text-amber-400 hover:text-amber-300 transition-colors p-1 flex items-center gap-1"
                    title={`Restore ${player.name}`}
                  >
                    <span className="material-icons" style={{ fontSize: 16 }}>restore</span>
                    <span className="hidden sm:inline">Restore</span>
                  </button>
                  {confirmingPurgeId === player.id ? (
                    <div className="flex items-center gap-2 text-xs">
                      <span className="text-gray-400">Delete?</span>
                      <button onClick={() => { handlePurgeSingle(player); setConfirmingPurgeId(null); }} className="text-red-400 hover:text-red-300 transition-colors">Yes</button>
                      <button onClick={() => setConfirmingPurgeId(null)} className="text-gray-400 hover:text-white transition-colors">No</button>
                    </div>
                  ) : (
                    <button
                      onClick={() => setConfirmingPurgeId(player.id)}
                      className="text-xs text-gray-500 hover:text-red-400 transition-colors p-1 flex items-center gap-1"
                      title={`Permanently delete ${player.name}`}
                    >
                      <span className="material-icons" style={{ fontSize: 16 }}>delete_forever</span>
                      <span className="hidden sm:inline">Delete</span>
                    </button>
                  )}
                </div>
              ))}
            </div>
            )}
          </div>
        )}
      </div>

      {/* ── Announcements card ── */}
      <div className="space-y-4">
        {/* Compose */}
        <div className="glass-card p-5 space-y-3">
          <h3 className="section-label">ANNOUNCEMENTS</h3>
          <textarea
            rows={3}
            placeholder="Type your announcement\u2026"
            aria-label="Announcement text"
            value={draft}
            onChange={(e) => setDraft(e.target.value)}
            maxLength={500}
          />
          <p className="text-right text-xs text-gray-500">{draft.length}/500</p>
          <button
            onClick={handlePolish}
            disabled={polishing || !draft.trim()}
            className="btn-ghost w-full"
          >
            <span className="material-icons icon-sm">auto_fix_high</span>
            {polishing ? 'Improving\u2026' : 'Improve with AI'}
          </button>

          {/* AI result */}
          {polished && (
            <div className="inner-card-green p-3 space-y-2">
              <p className="text-xs font-semibold text-green-400">AI Result</p>
              <p className="text-sm text-gray-200 leading-relaxed">{polished}</p>
              <button
                onClick={() => handlePost(polished)}
                disabled={posting}
                className="btn-primary w-full text-sm"
              >
                {posting ? 'Posting\u2026' : 'Post to Home'}
              </button>
            </div>
          )}

          {/* Post draft directly if not polished */}
          {!polished && draft.trim() && (
            <button
              onClick={() => handlePost(draft)}
              disabled={posting}
              className="btn-primary w-full"
            >
              {posting ? 'Posting\u2026' : 'Post to Home'}
            </button>
          )}
          {postError && <p className="text-red-400 text-xs">{postError}</p>}
        </div>

        {/* Posted announcements */}
        {announcements.length > 0 && (
          <div className="glass-card p-5 space-y-3">
            <h3 className="section-label-muted">ACTIVE ANNOUNCEMENTS</h3>
            <div className="space-y-2">
              {deletePostError && <p className="text-xs text-red-400 mb-1">{deletePostError}</p>}
              {announcements.map((a) =>
                editingAnnoId === a.id ? (
                  <div key={a.id} className="inner-card p-3 space-y-2">
                    <textarea
                      rows={3}
                      value={editAnnoText}
                      onChange={(e) => setEditAnnoText(e.target.value)}
                      maxLength={500}
                      className="w-full text-sm"
                    />
                    <p className="text-right text-xs text-gray-500">{editAnnoText.length}/500</p>
                    {editAnnoError && <p className="text-red-400 text-xs">{editAnnoError}</p>}
                    <div className="flex gap-2">
                      <button
                        onClick={() => handleSaveAnno(a.id)}
                        disabled={savingAnno || !editAnnoText.trim()}
                        className="btn-primary text-xs px-3 py-1.5"
                      >
                        {savingAnno ? 'Saving\u2026' : 'Save'}
                      </button>
                      <button onClick={() => setEditingAnnoId(null)} className="btn-ghost text-xs px-3 py-1.5">
                        Cancel
                      </button>
                    </div>
                  </div>
                ) : (
                  <div key={a.id} className="inner-card p-3">
                    <div className="flex items-start justify-between gap-2">
                      <p className="text-sm text-gray-200 flex-1">{a.text}</p>
                      <div className="flex gap-3 shrink-0">
                        <button
                          onClick={() => startEditAnno(a)}
                          className="text-xs text-blue-400 hover:text-blue-300 transition-colors"
                        >
                          Edit
                        </button>
                        <button
                          onClick={() => handleDeleteAnnouncement(a.id)}
                          className="text-xs text-red-400 hover:text-red-300 transition-colors"
                        >
                          Delete
                        </button>
                      </div>
                    </div>
                    <p className="text-xs text-gray-500 mt-1 flex items-center gap-1.5">
                      <span>
                        {new Date(a.time).toLocaleString(undefined, {
                          month: 'short',
                          day: 'numeric',
                          hour: '2-digit',
                          minute: '2-digit',
                        })}
                      </span>
                      {a.editedAt && (
                        <span className="text-gray-600">&middot; edited</span>
                      )}
                    </p>
                  </div>
                )
              )}
            </div>
          </div>
        )}
      </div>

      {/* Quick-access buttons */}
      <div className="flex gap-3">
        <button onClick={() => setView('members')} className="btn-ghost flex-1">
          <span className="material-icons icon-sm">group</span>
          Members
        </button>
        <button onClick={() => setView('birds')} className="btn-ghost flex-1">
          <span className="material-icons icon-sm">inventory_2</span>
          Birds
        </button>
      </div>

      {/* Next Week */}
      <button
        onClick={() => setView('advance')}
        className="btn-primary w-full"
      >
        Next Week &rarr;
      </button>

      {/* Clear session confirmation portal */}
      {confirmingClear && typeof document !== 'undefined' && createPortal(
        <>
          <div
            onClick={() => { setConfirmingClear(false); setClearError(''); }}
            style={{ position: 'fixed', inset: 0, background: 'var(--overlay-bg)', backdropFilter: 'blur(4px)', zIndex: 100 }}
          />
          <div style={{ position: 'fixed', bottom: 0, left: 0, right: 0, zIndex: 101, padding: '0 16px', paddingBottom: 'calc(env(safe-area-inset-bottom, 0px) + 100px)' }}>
            <div className="glass-card p-5 space-y-3 max-w-lg mx-auto">
              <div className="text-center space-y-1.5">
                <p className="font-semibold text-white">
                  {clearMode === 'soft' ? 'Clear session for new week?' : 'Permanently delete all records?'}
                </p>
                <p className="text-sm text-gray-400">
                  {clearMode === 'soft' ? (
                    <>All <span className="text-white font-semibold">{players.length}</span> player{players.length !== 1 ? 's' : ''} will be moved to Cancelled. Data stays in the database.</>
                  ) : (
                    <><span className="text-white font-semibold">{players.length + waitlistPlayers.length + removedPlayers.length}</span> record{(players.length + waitlistPlayers.length + removedPlayers.length) !== 1 ? 's' : ''} will be permanently deleted &mdash; active, waitlisted, and cancelled. <span className="text-red-400">This cannot be undone.</span></>
                  )}
                </p>
              </div>
              {clearMode === 'soft' && (
                <button
                  onClick={() => { handleExportCSV(); }}
                  className="btn-ghost w-full flex items-center justify-center gap-2"
                >
                  <span className="material-icons icon-sm" aria-hidden="true">download</span>
                  Export CSV first
                </button>
              )}
              <button
                onClick={clearMode === 'soft' ? handleClearSession : handlePurgeAll}
                className="btn-primary w-full"
                style={clearMode === 'soft'
                  ? { background: 'rgba(239,68,68,0.18)', color: '#f87171', border: '1px solid rgba(239,68,68,0.25)' }
                  : { background: 'rgba(239,68,68,0.30)', color: '#fca5a5', border: '1px solid rgba(239,68,68,0.45)' }
                }
              >
                {clearMode === 'soft'
                  ? 'Clear Session'
                  : 'Delete Everything'
                }
              </button>
              <button
                onClick={() => { setConfirmingClear(false); setClearError(''); }}
                className="w-full text-sm text-gray-400 hover:text-white transition-colors py-2"
              >
                Cancel
              </button>
              {clearError && <p role="alert" className="text-xs text-red-400 text-center">{clearError}</p>}
            </div>
          </div>
        </>,
        document.body
      )}
    </div>
  );
}
