'use client';

import { useState, useEffect, useCallback } from 'react';
import type { Player, Session, Alias } from '@/lib/types';

const BASE = process.env.NEXT_PUBLIC_BASE_PATH ?? '';

interface NavigationState {
  isViewingActive: boolean;
  viewedSessionId: string | null;
  session: Session | null;
  aliases: Alias[];
}

export function usePlayerManagement(nav: NavigationState, refreshKey: number) {
  const [players, setPlayers] = useState<Player[]>([]);
  const [waitlistPlayers, setWaitlistPlayers] = useState<Player[]>([]);
  const [removedPlayers, setRemovedPlayers] = useState<Player[]>([]);
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

  const loadPlayers = useCallback(async (sessionIdOverride?: string) => {
    setLoading(true);
    try {
      const sessionParam = sessionIdOverride ? `&sessionId=${encodeURIComponent(sessionIdOverride)}` : '';
      const pRes = await fetch(`${BASE}/api/players?all=true${sessionParam}`);
      if (pRes.ok) {
        const all: Player[] = await pRes.json();
        setPlayers(all.filter(p => !p.removed && !p.waitlisted));
        setWaitlistPlayers(all.filter(p => !p.removed && !!p.waitlisted));
        setRemovedPlayers(all.filter(p => p.removed));
      }
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    loadPlayers();
  }, [loadPlayers, refreshKey]);

  async function handleAddPlayer(e: React.FormEvent) {
    e.preventDefault();
    if (!name.trim()) return;
    setAdding(true);
    setAddError('');
    try {
      const res = await fetch(`${BASE}/api/players`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ name: name.trim(), ...(!nav.isViewingActive && nav.viewedSessionId ? { sessionId: nav.viewedSessionId } : {}) }),
      });
      const data = await res.json();
      if (!res.ok) {
        setAddError(data.error ?? 'Failed to add player.');
      } else {
        setName('');
        loadPlayers(!nav.isViewingActive && nav.viewedSessionId ? nav.viewedSessionId : undefined);
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
        body: JSON.stringify({ id: player.id, paid: !player.paid, ...(!nav.isViewingActive && nav.viewedSessionId ? { sessionId: nav.viewedSessionId } : {}) }),
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
        body: JSON.stringify({ name: player.name, ...(!nav.isViewingActive && nav.viewedSessionId ? { sessionId: nav.viewedSessionId } : {}) }),
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
        body: JSON.stringify({ id: player.id, removed: false, ...(!nav.isViewingActive && nav.viewedSessionId ? { sessionId: nav.viewedSessionId } : {}) }),
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
        body: JSON.stringify({ id: player.id, waitlisted: false, ...(!nav.isViewingActive && nav.viewedSessionId ? { sessionId: nav.viewedSessionId } : {}) }),
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
        body: JSON.stringify({ purgeOne: player.id, name: player.name, ...(!nav.isViewingActive && nav.viewedSessionId ? { sessionId: nav.viewedSessionId } : {}) }),
      });
      if (res.ok) {
        setRemovedPlayers(prev => prev.filter(p => p.id !== player.id));
      }
    } catch { /* silent */ }
  }

  function handleExportCSV() {
    const aliasMap = new Map(nav.aliases.map(a => [a.appName.toLowerCase(), a.etransferName]));
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
    const dateStr = nav.session?.datetime ? nav.session.datetime.slice(0, 10) : new Date().toISOString().slice(0, 10);
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

  return {
    players, waitlistPlayers, removedPlayers,
    name, setName,
    adding, addError,
    removingId, togglingId, savedId, promotingId, promoteError,
    moreMenuOpen, setMoreMenuOpen,
    confirmingPurgeId, setConfirmingPurgeId,
    restoreError,
    confirmingClear, setConfirmingClear,
    clearMode, setClearMode,
    clearError, setClearError,
    cancelledCollapsed, setCancelledCollapsed,
    loading,
    handleAddPlayer,
    handleTogglePaid,
    handleRemove,
    handleRestore,
    handlePromote,
    handlePurgeSingle,
    handleExportCSV,
    handleClearSession,
    handlePurgeAll,
    loadPlayers,
  };
}
