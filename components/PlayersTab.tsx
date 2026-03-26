'use client';

import { useState, useEffect, useCallback } from 'react';
import type { Player, Session } from '@/lib/types';
import { fmtDate } from '@/lib/formatters';

const STORAGE_KEY = 'badminton_username';
const STORAGE_KEY_TOKEN = 'badminton_deletetoken';
const BASE = process.env.NEXT_PUBLIC_BASE_PATH ?? '';

export default function PlayersTab() {
  const [players, setPlayers] = useState<Player[]>([]);
  const [session, setSession] = useState<Session | null>(null);
  const [currentUser, setCurrentUser] = useState<string | null>(null);
  const [loading, setLoading] = useState(true);
  const [cancelError, setCancelError] = useState('');
  const [confirmingCancel, setConfirmingCancel] = useState(false);

  const loadPlayers = useCallback(async () => {
    setLoading(true);
    try {
      const [pRes, sRes] = await Promise.all([
        fetch(`${BASE}/api/players`, { cache: 'no-store' }),
        fetch(`${BASE}/api/session`, { cache: 'no-store' }),
      ]);
      if (pRes.ok) setPlayers(await pRes.json());
      if (sRes.ok) setSession(await sRes.json());
    } catch {
      // silent
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    setCurrentUser(localStorage.getItem(STORAGE_KEY));
    loadPlayers();
  }, [loadPlayers]);

  async function handleCancel() {
    if (!currentUser) return;
    const deleteToken = localStorage.getItem(STORAGE_KEY_TOKEN);
    try {
      const res = await fetch(`${BASE}/api/players`, {
        method: 'DELETE',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ name: currentUser, deleteToken }),
      });
      if (res.ok) {
        localStorage.removeItem(STORAGE_KEY);
        localStorage.removeItem(STORAGE_KEY_TOKEN);
        setCurrentUser(null);
        setCancelError('');
        setConfirmingCancel(false);
        loadPlayers();
      } else {
        setCancelError('Failed to cancel. Please try again.');
      }
    } catch {
      setCancelError('Failed to cancel. Please try again.');
    }
  }

  if (loading) {
    return (
      <div className="flex items-center justify-center h-48" role="status" aria-label="Loading">
        <span className="material-icons animate-spin text-green-400" aria-hidden="true" style={{ fontSize: 32 }}>
          refresh
        </span>
      </div>
    );
  }

  const activePlayers = players.filter(p => !p.waitlisted);
  const waitlistPlayers = players.filter(p => p.waitlisted);

  if (activePlayers.length === 0 && waitlistPlayers.length === 0) {
    return (
      <div className="glass-card p-10 text-center text-gray-500">
        <span className="material-icons block mb-2 opacity-30" style={{ fontSize: 40 }}>
          group_off
        </span>
        No players signed up yet.
      </div>
    );
  }

  const gameDate = session?.datetime ? fmtDate(session.datetime) : '';

  return (
    <div className="space-y-4">
      {/* Active players card with court SVG */}
      <div className="glass-card overflow-hidden" style={{ position: 'relative' }}>
        {/* Court lines accent */}
        <svg
          viewBox="0 0 390 520"
          xmlns="http://www.w3.org/2000/svg"
          preserveAspectRatio="xMinYMin meet"
          style={{ position: 'absolute', top: 0, left: 0, width: '100%', zIndex: 0, pointerEvents: 'none' }}
        >
          <g stroke="rgba(89,89,89,0.68)" strokeWidth="1" fill="none">
            {/* Vertical lines */}
            <line x1="28"  y1="60" x2="28"  y2="504" />
            <line x1="53"  y1="60" x2="53"  y2="504" />
            <line x1="196" y1="60" x2="196" y2="374" />
            <line x1="337" y1="60" x2="337" y2="504" />
            <line x1="365" y1="60" x2="365" y2="504" />
            {/* Top outer boundary — rounded caps */}
            <line x1="28" y1="60" x2="365" y2="60" strokeLinecap="round" />
            {/* Service line — rounded caps */}
            <line x1="28" y1="113" x2="365" y2="113" strokeLinecap="round" />
            {/* Net */}
            <line x1="28" y1="374" x2="365" y2="374" />
            {/* Center tick marks */}
            <line x1="56" y1="94"  x2="64" y2="94"  />
            <line x1="56" y1="133" x2="64" y2="133" />
          </g>
        </svg>

        {/* Card content above court */}
        <div style={{ position: 'relative', zIndex: 1 }}>
          {/* Game date header */}
          <div className="px-4 pt-3 pb-2 section-label">
            {gameDate || 'UPCOMING SESSION'}
          </div>

          <div className="px-2 pb-2 space-y-0.5">
            {activePlayers.map((player, i) => {
              const isMe =
                !!currentUser &&
                player.name.toLowerCase() === currentUser.toLowerCase();

              return (
                <div
                  key={player.id}
                  className="flex items-center px-3 py-2.5 gap-3 rounded-xl"
                  style={isMe ? { background: 'rgba(74, 222, 128, 0.07)' } : undefined}
                >
                  <span className="text-xs text-gray-500 w-5 text-right font-mono tabular-nums">
                    {i + 1}
                  </span>
                  <span className="flex-1 text-sm text-gray-200 font-medium">
                    {player.name}
                    {isMe && (
                      <span className="ml-1.5 text-xs text-green-400 font-normal">
                        (you)
                      </span>
                    )}
                  </span>
                  {isMe && (
                    <div className="flex flex-col items-end gap-0.5">
                      {confirmingCancel ? (
                        <div className="flex items-center gap-2 text-xs">
                          <span className="text-gray-400">Cancel spot?</span>
                          <button onClick={handleCancel} className="text-red-400 hover:text-red-300 transition-colors">Yes</button>
                          <button onClick={() => setConfirmingCancel(false)} className="text-gray-400 hover:text-white transition-colors">No</button>
                        </div>
                      ) : (
                        <button
                          onClick={() => setConfirmingCancel(true)}
                          className="text-xs text-red-400 hover:text-red-300 transition-colors ml-1"
                        >
                          Cancel
                        </button>
                      )}
                      {cancelError && (
                        <span className="text-xs text-red-400">{cancelError}</span>
                      )}
                    </div>
                  )}
                </div>
              );
            })}
          </div>
        </div>{/* end card content */}
      </div>

      {/* Waitlist card — same court SVG, flipped vertically to form the other half */}
      {waitlistPlayers.length > 0 && (
        <div className="glass-card overflow-hidden" style={{ position: 'relative' }}>
          {/* Court lines — mirrored to continue the court from the card above */}
          <svg
            viewBox="0 0 390 520"
            xmlns="http://www.w3.org/2000/svg"
            preserveAspectRatio="xMinYMin meet"
            style={{
              position: 'absolute', top: 0, left: 0, width: '100%',
              zIndex: 0, pointerEvents: 'none',
              transform: 'scaleY(-1)',
            }}
          >
            <g stroke="rgba(89,89,89,0.68)" strokeWidth="1" fill="none">
              <line x1="28"  y1="60" x2="28"  y2="504" />
              <line x1="53"  y1="60" x2="53"  y2="504" />
              <line x1="196" y1="60" x2="196" y2="374" />
              <line x1="337" y1="60" x2="337" y2="504" />
              <line x1="365" y1="60" x2="365" y2="504" />
              <line x1="28" y1="60" x2="365" y2="60" strokeLinecap="round" />
              <line x1="28" y1="113" x2="365" y2="113" strokeLinecap="round" />
              <line x1="28" y1="374" x2="365" y2="374" />
              <line x1="56" y1="94"  x2="64" y2="94"  />
              <line x1="56" y1="133" x2="64" y2="133" />
            </g>
          </svg>

          <div style={{ position: 'relative', zIndex: 1 }}>
            <div
              className="px-4 pt-3 pb-2 text-xs font-bold tracking-widest"
              style={{ color: 'rgba(251, 191, 36, 0.65)' }}
            >
              WAITLISTED
            </div>
            <div className="px-2 pb-2 space-y-0.5">
              {waitlistPlayers.map((player, i) => {
                const isMe =
                  !!currentUser &&
                  player.name.toLowerCase() === currentUser.toLowerCase();

                return (
                  <div
                    key={player.id}
                    className="flex items-center px-3 py-2.5 gap-3 rounded-xl"
                    style={isMe ? { background: 'rgba(251, 191, 36, 0.07)' } : undefined}
                  >
                    <span className="text-xs text-gray-500 w-5 text-right font-mono tabular-nums">
                      {activePlayers.length + i + 1}
                    </span>
                    <span className="flex-1 text-sm text-gray-400 font-medium">
                      {player.name}
                      {isMe && (
                        <span className="ml-1.5 text-xs text-amber-400 font-normal">
                          (you)
                        </span>
                      )}
                    </span>
                    {isMe && (
                      <div className="flex flex-col items-end gap-0.5">
                        {confirmingCancel ? (
                          <div className="flex items-center gap-2 text-xs">
                            <span className="text-gray-400">Leave waitlist?</span>
                            <button onClick={handleCancel} className="text-red-400 hover:text-red-300 transition-colors">Yes</button>
                            <button onClick={() => setConfirmingCancel(false)} className="text-gray-400 hover:text-white transition-colors">No</button>
                          </div>
                        ) : (
                          <button
                            onClick={() => setConfirmingCancel(true)}
                            className="text-xs text-red-400 hover:text-red-300 transition-colors ml-1"
                          >
                            Leave
                          </button>
                        )}
                        {cancelError && (
                          <span className="text-xs text-red-400">{cancelError}</span>
                        )}
                      </div>
                    )}
                  </div>
                );
              })}
            </div>
          </div>
        </div>
      )}
    </div>
  );
}
