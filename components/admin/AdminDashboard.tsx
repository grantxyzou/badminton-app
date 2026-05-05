'use client';

import { useState, useEffect, useRef, useCallback } from 'react';
import { createPortal } from 'react-dom';
import { useTranslations } from 'next-intl';
import type { AdminView } from './types';
import { ShimmerLoader } from '../ShuttleLoader';
import SessionContextBar from './SessionContextBar';
import VenueSummary from './VenueSummary';
import SessionDetailsEditor from './SessionDetailsEditor';
import DateTimeEditor from './DateTimeEditor';
import MembersView from './MembersView';
import BirdInventoryView from './BirdInventoryView';
import AdvanceSessionForm from './AdvanceSessionForm';
import ReleasesView from './ReleasesView';
import { useAnnouncements } from './hooks/useAnnouncements';
import AnnouncementComposer from './AnnouncementComposer';
import { renderMarkdown } from '@/lib/miniMarkdown';
import { useSessionNavigation } from './hooks/useSessionNavigation';
import { usePlayerManagement } from './hooks/usePlayerManagement';
import ResetAccessSheet from './ResetAccessSheet';
import PageHeader from '../primitives/PageHeader';

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

export default function AdminDashboard() {
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
  if (view === 'releases') return <div className="animate-slideInRight"><ReleasesView onBack={goBack} /></div>;

  return <Dashboard refreshKey={refreshKey} setView={setView} />;
}

/* ── Dashboard view ── */

interface DashboardProps {
  refreshKey: number;
  setView: (v: AdminView) => void;
}

function Dashboard({ refreshKey, setView }: DashboardProps) {
  const pageT = useTranslations('pages.admin');
  const anno = useAnnouncements(refreshKey);

  // Player management needs navigation state, navigation needs loadPlayers
  const playerLoadRef = useRef<((id?: string) => Promise<void>) | null>(null);

  const nav = useSessionNavigation(refreshKey, (id) => playerLoadRef.current?.(id));
  const pm = usePlayerManagement(nav, refreshKey);

  // Wire up the ref after both hooks are created
  useEffect(() => { playerLoadRef.current = pm.loadPlayers; }, [pm.loadPlayers]);

  // A2 recovery: admin issues a 6-digit reset-access code per player.
  // Always available now that the recovery flag has been retired.
  const [resetSheet, setResetSheet] = useState<{
    open: boolean; playerName: string; code: string; expiresAt: number;
  }>({ open: false, playerName: '', code: '', expiresAt: 0 });

  async function handleResetAccess(player: { id: string; name: string }) {
    if (!confirm(`Generate a recovery code for ${player.name}?\n\nThey'll be able to use it to restore their access on a new device. The code expires in 15 minutes.`)) return;
    const res = await fetch(`${BASE}/api/players/reset-access`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ playerId: player.id }),
    });
    if (!res.ok) {
      alert(`Failed to generate code (${res.status})`);
      return;
    }
    const body = await res.json();
    setResetSheet({ open: true, playerName: player.name, code: body.code, expiresAt: body.expiresAt });
  }

  /* ── Render ── */

  return (
    <div className="space-y-5 w-full">
      <PageHeader>{pageT('title')}</PageHeader>

      {/* Session context */}
      <SessionContextBar session={nav.session} onEditDates={() => setView('date-time')} />
      <VenueSummary session={nav.session} onEdit={() => setView('session-details')} />

      {/* ── Announcements card (grouped with session-wide controls) ── */}
      <div className="space-y-4">
        {/* Compose */}
        <div className="glass-card p-5 space-y-3">
          <h3 className="section-label">ANNOUNCEMENTS</h3>
          <AnnouncementComposer draft={anno.draft} setDraft={anno.setDraft} />
          <button
            onClick={anno.handlePolish}
            disabled={anno.polishing || !anno.draft.trim()}
            className="btn-ghost w-full"
          >
            <span className="material-icons icon-sm">auto_fix_high</span>
            {anno.polishing ? 'Improving\u2026' : 'Improve with AI'}
          </button>

          {/* AI result */}
          {anno.polished && (
            <div className="inner-card-green p-3 space-y-2">
              <p className="text-xs font-semibold text-green-400">AI Result</p>
              <p className="text-sm text-gray-200 leading-relaxed">{anno.polished}</p>
              <button
                onClick={() => anno.handlePost(anno.polished)}
                disabled={anno.posting}
                className="btn-primary w-full text-sm"
              >
                {anno.posting ? 'Posting\u2026' : 'Post to Home'}
              </button>
            </div>
          )}

          {/* Post draft directly if not polished */}
          {!anno.polished && anno.draft.trim() && (
            <button
              onClick={() => anno.handlePost(anno.draft)}
              disabled={anno.posting}
              className="btn-primary w-full"
            >
              {anno.posting ? 'Posting\u2026' : 'Post to Home'}
            </button>
          )}
          {anno.postError && <p className="text-red-400 text-xs">{anno.postError}</p>}
        </div>

        {/* Posted announcements */}
        {anno.announcements.length > 0 && (
          <div className="glass-card p-5 space-y-3">
            <h3 className="section-label-muted">ACTIVE ANNOUNCEMENTS</h3>
            <div className="space-y-2">
              {anno.deletePostError && <p className="text-xs text-red-400 mb-1">{anno.deletePostError}</p>}
              {anno.announcements.map((a) =>
                anno.editingAnnoId === a.id ? (
                  <div key={a.id} className="glass-card-soft p-3 space-y-2">
                    <textarea
                      name="announcementEdit"
                      rows={4}
                      value={anno.editAnnoText}
                      onChange={(e) => anno.setEditAnnoText(e.target.value)}
                      maxLength={800}
                      className="w-full text-sm"
                    />
                    <p className="text-right text-xs text-gray-500">{anno.editAnnoText.length}/800</p>
                    {anno.editAnnoError && <p className="text-red-400 text-xs">{anno.editAnnoError}</p>}
                    <div className="flex gap-2">
                      <button
                        onClick={() => anno.handleSaveAnno(a.id)}
                        disabled={anno.savingAnno || !anno.editAnnoText.trim()}
                        className="btn-primary text-xs px-3 py-1.5"
                      >
                        {anno.savingAnno ? 'Saving\u2026' : 'Save'}
                      </button>
                      <button onClick={() => anno.cancelEditAnno()} className="btn-ghost text-xs px-3 py-1.5">
                        Cancel
                      </button>
                    </div>
                  </div>
                ) : (
                  <div key={a.id} className="glass-card-soft p-3">
                    <div className="flex items-start justify-between gap-2">
                      <div className="announcement-body text-sm text-gray-200 flex-1">{renderMarkdown(a.text)}</div>
                      <div className="flex gap-3 shrink-0">
                        <button
                          onClick={() => anno.startEditAnno(a)}
                          className="text-xs text-blue-400 hover:text-blue-300 transition-colors"
                        >
                          Edit
                        </button>
                        <button
                          onClick={() => anno.handleDeleteAnnouncement(a.id)}
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

      {/* ── Players card ── */}
      <div className="space-y-3">
        {/* Session navigator */}
        {nav.allSessions.length > 1 && (
          <div className="glass-card p-4 flex items-center justify-between">
            <button
              type="button"
              onClick={() => nav.navigateSession('prev')}
              disabled={!nav.canGoPrev}
              className="text-white disabled:opacity-20 transition-opacity p-1"
              aria-label="Previous session"
            >
              <span className="material-icons" style={{ fontSize: 24 }}>chevron_left</span>
            </button>
            <div className="text-center">
              <p className="text-sm font-semibold text-white">
                {nav.viewedSession ? fmtSessionNav(nav.viewedSession.datetime) : '\u2014'}
              </p>
              {nav.isViewingActive ? (
                <p className="text-xs text-green-400 font-medium">Current session</p>
              ) : (
                <p className="text-xs text-gray-400">Past session</p>
              )}
            </div>
            <button
              type="button"
              onClick={() => nav.navigateSession('next')}
              disabled={!nav.canGoNext}
              className="text-white disabled:opacity-20 transition-opacity p-1"
              aria-label="Next session"
            >
              <span className="material-icons" style={{ fontSize: 24 }}>chevron_right</span>
            </button>
          </div>
        )}

        {/* Player list */}
        <div className="glass-card overflow-hidden">
          {pm.loading ? (
            <div className="px-4"><ShimmerLoader lines={4} /></div>
          ) : pm.players.length === 0 ? (
            <p className="text-center text-gray-500 text-sm p-8">No players signed up yet.</p>
          ) : (
            <div>
              <div className="list-header-green flex items-center justify-between">
                <span>
                  {pm.players.length} PLAYER{pm.players.length !== 1 ? 'S' : ''}
                </span>
                <div className="flex items-center gap-2">
                  <button
                    onClick={pm.handleExportCSV}
                    className="text-xs font-normal hover:text-green-300 transition-colors flex items-center gap-1"
                  >
                    <span className="material-icons" style={{ fontSize: 13 }}>download</span>
                    Export CSV
                  </button>
                  <div className="relative">
                    <button
                      onClick={() => pm.setMoreMenuOpen(o => !o)}
                      className="hover:text-green-300 transition-colors p-0.5"
                      aria-label="More actions"
                    >
                      <span className="material-icons" style={{ fontSize: 18 }}>more_vert</span>
                    </button>
                    {pm.moreMenuOpen && (
                      <>
                        <div onClick={() => pm.setMoreMenuOpen(false)} style={{ position: 'fixed', inset: 0, zIndex: 50 }} />
                        <div className="absolute right-0 top-full mt-1 z-50 w-52 rounded-xl overflow-hidden border border-white/10" style={{ background: 'var(--dropdown-bg)', backdropFilter: 'blur(12px)' }}>
                          <button
                            onClick={() => { pm.setMoreMenuOpen(false); pm.setClearMode('soft'); pm.setClearError(''); pm.setConfirmingClear(true); }}
                            className="w-full text-left px-4 py-3 text-sm text-gray-300 hover:bg-white/10 transition-colors flex items-center gap-3"
                          >
                            <span className="material-icons text-gray-500" style={{ fontSize: 18 }}>delete_sweep</span>
                            Clear Session
                          </button>
                          <button
                            onClick={() => { pm.setMoreMenuOpen(false); pm.setClearMode('hard'); pm.setClearError(''); pm.setConfirmingClear(true); }}
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
                {pm.players.map((player, i) => (
                  <div key={player.id} className="flex items-center px-4 py-3 gap-3">
                    <span className="text-xs text-gray-500 w-5 text-right font-mono tabular-nums">{i + 1}</span>
                    <span className="flex-1 text-sm text-gray-200 font-medium">{player.name}</span>
                    {player.selfReportedPaid && !player.paid && (
                      <span className="text-[9px] font-medium px-1.5 py-0.5 rounded-full" style={{ background: 'rgba(251,191,36,0.15)', color: '#fbbf24' }}>
                        reported
                      </span>
                    )}
                    <button
                      onClick={() => pm.handleTogglePaid(player)}
                      disabled={pm.togglingId === player.id}
                      className={`text-xs font-medium transition-colors px-3 py-1.5 rounded-full ${player.paid ? 'pill-paid' : 'pill-unpaid'}`}
                      style={{ minHeight: 32 }}
                    >
                      {pm.savedId === player.id ? '\u2713' : pm.togglingId === player.id ? '\u2026' : player.paid ? 'Paid' : 'Pending'}
                    </button>
                    <button
                      onClick={() => handleResetAccess(player)}
                      className="text-xs text-gray-500 hover:text-blue-400 transition-colors flex items-center gap-1 px-2"
                      title={`Reset access for ${player.name}`}
                      aria-label={`Reset access for ${player.name}`}
                      style={{ minHeight: 44, minWidth: 44, justifyContent: 'center' }}
                    >
                      <span className="material-icons" style={{ fontSize: 18 }}>key</span>
                      <span className="hidden sm:inline">Reset</span>
                    </button>
                    <button
                      onClick={() => pm.handleRemove(player)}
                      disabled={pm.removingId === player.id}
                      className="text-xs text-gray-500 hover:text-amber-400 transition-colors flex items-center gap-1 px-2"
                      title={`Remove ${player.name}`}
                      aria-label={`Remove ${player.name}`}
                      style={{ minHeight: 44, minWidth: 44, justifyContent: 'center' }}
                    >
                      <span className="material-icons" style={{ fontSize: 18 }}>person_remove</span>
                      <span className="hidden sm:inline">Remove</span>
                    </button>
                  </div>
                ))}
              </div>
            </div>
          )}
        </div>

        {/* Add player form — below the list so the submit button sits in
            the thumb zone after scrolling past the active roster. */}
        <form onSubmit={pm.handleAddPlayer} className="glass-card p-5 space-y-3">
          <h3 className="section-label">ADD PLAYER</h3>
          <div className="flex gap-2">
            <input
              id="admin-add-player-name"
              name="playerName"
              type="text"
              placeholder="Player name"
              aria-label="Player name"
              aria-describedby={pm.addError ? 'add-error' : undefined}
              value={pm.name}
              onChange={e => pm.setName(e.target.value)}
              maxLength={50}
              autoComplete="off"
            />
            <button type="submit" disabled={pm.adding || !pm.name.trim()} className="btn-primary" style={{ whiteSpace: 'nowrap' }}>
              {pm.adding ? '\u2026' : 'Add'}
            </button>
          </div>
          {pm.addError && <p id="add-error" role="alert" className="text-red-400 text-xs">{pm.addError}</p>}
        </form>

        {/* Waitlisted players */}
        {pm.promoteError && (
          <p role="alert" className="text-xs text-red-400 px-1">{pm.promoteError}</p>
        )}
        {pm.waitlistPlayers.length > 0 && (
          <div className="glass-card overflow-hidden">
            <div className="list-header-amber">
              {pm.waitlistPlayers.length} WAITLISTED
            </div>
            <div className="divide-y" style={{ borderColor: 'var(--divider)' }}>
              {pm.waitlistPlayers.map((player, i) => (
                <div key={player.id} className="flex items-center px-4 py-3 gap-3">
                  <span className="text-xs text-gray-500 w-5 text-right font-mono tabular-nums">{pm.players.length + i + 1}</span>
                  <span className="flex-1 text-sm text-gray-300 font-medium">{player.name}</span>
                  <button
                    onClick={() => pm.handlePromote(player)}
                    disabled={pm.promotingId === player.id}
                    className="text-xs text-amber-400 hover:text-amber-300 transition-colors py-2 px-1"
                  >
                    {pm.promotingId === player.id ? '\u2026' : 'Promote'}
                  </button>
                  <button
                    onClick={() => pm.handleRemove(player)}
                    disabled={pm.removingId === player.id}
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
        {pm.restoreError && (
          <p role="alert" className="text-xs text-red-400 px-1">{pm.restoreError}</p>
        )}
        {pm.removedPlayers.length > 0 && (
          <div className="glass-card overflow-hidden">
            <div
              className="list-header-amber flex items-center justify-between"
              style={pm.cancelledCollapsed ? { borderBottom: 'none' } : undefined}
            >
              <span>
                {pm.removedPlayers.length} REMOVED
                {nav.session?.datetime ? <span style={{ fontWeight: 400, opacity: 0.6 }}> &middot; {fmtSessionLabel(nav.session.datetime)}</span> : null}
              </span>
              <button
                type="button"
                onClick={() => pm.setCancelledCollapsed(c => !c)}
                aria-label={pm.cancelledCollapsed ? 'Expand cancelled list' : 'Collapse cancelled list'}
                className="bg-transparent border-0 cursor-pointer text-amber-400/65 p-0 flex items-center"
              >
                <span className="material-icons icon-md">
                  {pm.cancelledCollapsed ? 'expand_more' : 'expand_less'}
                </span>
              </button>
            </div>
            {!pm.cancelledCollapsed && (
            <div className="divide-y" style={{ borderColor: 'var(--divider)' }}>
              {[...pm.removedPlayers]
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
                    onClick={() => pm.handleRestore(player)}
                    className="text-xs text-amber-400 hover:text-amber-300 transition-colors p-1 flex items-center gap-1"
                    title={`Restore ${player.name}`}
                  >
                    <span className="material-icons" style={{ fontSize: 16 }}>restore</span>
                    <span className="hidden sm:inline">Restore</span>
                  </button>
                  {pm.confirmingPurgeId === player.id ? (
                    <div className="flex items-center gap-2 text-xs">
                      <span className="text-gray-400">Delete?</span>
                      <button onClick={() => { pm.handlePurgeSingle(player); pm.setConfirmingPurgeId(null); }} className="text-red-400 hover:text-red-300 transition-colors">Yes</button>
                      <button onClick={() => pm.setConfirmingPurgeId(null)} className="text-gray-400 hover:text-white transition-colors">No</button>
                    </div>
                  ) : (
                    <button
                      onClick={() => pm.setConfirmingPurgeId(player.id)}
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
        <button onClick={() => setView('releases')} className="btn-ghost flex-1">
          <span className="material-icons icon-sm">campaign</span>
          Releases
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
      {pm.confirmingClear && typeof document !== 'undefined' && createPortal(
        <>
          <div
            onClick={() => { pm.setConfirmingClear(false); pm.setClearError(''); }}
            style={{ position: 'fixed', inset: 0, background: 'var(--overlay-bg)', backdropFilter: 'blur(4px)', zIndex: 100 }}
            aria-hidden="true"
          />
          <div
            role="dialog"
            aria-modal="true"
            aria-labelledby="clear-dialog-title"
            style={{ position: 'fixed', bottom: 0, left: 0, right: 0, zIndex: 101, padding: '0 16px', paddingBottom: 'calc(env(safe-area-inset-bottom, 0px) + 100px)' }}
          >
            <div className="glass-card p-5 space-y-3 max-w-lg mx-auto">
              <div className="text-center space-y-1.5">
                <p id="clear-dialog-title" className="font-semibold text-white">
                  {pm.clearMode === 'soft' ? 'Clear session for new week?' : 'Permanently delete all records?'}
                </p>
                <p className="text-sm text-gray-400">
                  {pm.clearMode === 'soft' ? (
                    <>All <span className="text-white font-semibold">{pm.players.length}</span> player{pm.players.length !== 1 ? 's' : ''} will be moved to Cancelled. Data stays in the database.</>
                  ) : (
                    <><span className="text-white font-semibold">{pm.players.length + pm.waitlistPlayers.length + pm.removedPlayers.length}</span> record{(pm.players.length + pm.waitlistPlayers.length + pm.removedPlayers.length) !== 1 ? 's' : ''} will be permanently deleted &mdash; active, waitlisted, and cancelled. <span className="text-red-400">This cannot be undone.</span></>
                  )}
                </p>
              </div>
              {pm.clearMode === 'soft' && (
                <button
                  onClick={() => { pm.handleExportCSV(); }}
                  className="btn-ghost w-full flex items-center justify-center gap-2"
                >
                  <span className="material-icons icon-sm" aria-hidden="true">download</span>
                  Export CSV first
                </button>
              )}
              <button
                onClick={pm.clearMode === 'soft' ? pm.handleClearSession : pm.handlePurgeAll}
                className="btn-primary w-full"
                style={pm.clearMode === 'soft'
                  ? { background: 'rgba(239,68,68,0.18)', color: '#f87171', border: '1px solid rgba(239,68,68,0.25)' }
                  : { background: 'rgba(239,68,68,0.30)', color: '#fca5a5', border: '1px solid rgba(239,68,68,0.45)' }
                }
              >
                {pm.clearMode === 'soft'
                  ? 'Clear Session'
                  : 'Delete Everything'
                }
              </button>
              <button
                onClick={() => { pm.setConfirmingClear(false); pm.setClearError(''); }}
                className="w-full text-sm text-gray-400 hover:text-white transition-colors py-2"
              >
                Cancel
              </button>
              {pm.clearError && <p role="alert" className="text-xs text-red-400 text-center">{pm.clearError}</p>}
            </div>
          </div>
        </>,
        document.body
      )}

      <ResetAccessSheet
        open={resetSheet.open}
        onClose={() => setResetSheet((r) => ({ ...r, open: false }))}
        playerName={resetSheet.playerName}
        code={resetSheet.code}
        expiresAt={resetSheet.expiresAt}
      />
    </div>
  );
}
