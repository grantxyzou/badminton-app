'use client';

import { useState, useEffect, useCallback } from 'react';
import type { Session, Alias } from '@/lib/types';

const BASE = process.env.NEXT_PUBLIC_BASE_PATH ?? '';

export function useSessionNavigation(
  refreshKey: number,
  onNavigate?: (sessionIdOverride?: string) => void,
) {
  const [session, setSession] = useState<Session | null>(null);
  const [allSessions, setAllSessions] = useState<Session[]>([]);
  const [viewedSessionId, setViewedSessionId] = useState<string | null>(null);
  const [activeSessionId, setActiveSessionId] = useState<string | null>(null);
  const [aliases, setAliases] = useState<Alias[]>([]);
  const [loading, setLoading] = useState(true);

  const isViewingActive = !viewedSessionId || viewedSessionId === activeSessionId;
  const viewedIndex = allSessions.findIndex(s => s.id === (viewedSessionId ?? activeSessionId));
  const canGoPrev = viewedIndex < allSessions.length - 1;
  const canGoNext = viewedIndex > 0;
  const viewedSession = allSessions.find(s => s.id === (viewedSessionId ?? activeSessionId));

  const loadSession = useCallback(async (sessionIdOverride?: string) => {
    setLoading(true);
    try {
      const [sRes, aRes, sessionsRes] = await Promise.all([
        fetch(`${BASE}/api/session`),
        fetch(`${BASE}/api/aliases`, { cache: 'no-store' }),
        fetch(`${BASE}/api/sessions`, { cache: 'no-store' }),
      ]);
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

  useEffect(() => {
    loadSession();
  }, [loadSession, refreshKey]);

  function navigateSession(direction: 'prev' | 'next') {
    const idx = viewedIndex;
    const newIdx = direction === 'prev' ? idx + 1 : idx - 1;
    if (newIdx >= 0 && newIdx < allSessions.length) {
      const newSession = allSessions[newIdx];
      setViewedSessionId(newSession.id);
      setSession(newSession); // keep session in sync with viewed session
      const override = newSession.id === activeSessionId ? undefined : newSession.id;
      onNavigate?.(override);
    }
  }

  return {
    session,
    allSessions,
    viewedSessionId,
    activeSessionId,
    isViewingActive,
    viewedIndex,
    canGoPrev,
    canGoNext,
    viewedSession,
    navigateSession,
    loadSession,
    aliases,
    loading,
  };
}
