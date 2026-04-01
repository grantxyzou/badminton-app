'use client';

import { useState, useEffect, useCallback } from 'react';
import type { Player, Session } from '@/lib/types';
import { fmtDate } from '@/lib/formatters';
import ShuttleLoader from '@/components/ShuttleLoader';

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
    const minDelay = new Promise(r => setTimeout(r, 1500));
    try {
      const [pRes, sRes] = await Promise.all([
        fetch(`${BASE}/api/players`, { cache: 'no-store' }),
        fetch(`${BASE}/api/session`, { cache: 'no-store' }),
      ]);
      if (pRes.ok) setPlayers(await pRes.json());
      if (sRes.ok) setSession(await sRes.json());
      await minDelay;
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
    return <ShuttleLoader text="Loading players..." />;
  }

  const activePlayers = players.filter(p => !p.waitlisted);
  const waitlistPlayers = players.filter(p => p.waitlisted);

  if (activePlayers.length === 0 && waitlistPlayers.length === 0) {
    return (
      <div className="glass-card p-10 text-center">
        <span className="material-icons block mb-2 text-gray-500" style={{ fontSize: 36, opacity: 0.25 }}>sports_tennis</span>
        <p className="text-gray-500 text-sm">No one&apos;s signed up yet — be the first!</p>
      </div>
    );
  }

  const gameDate = session?.datetime ? fmtDate(session.datetime) : '';

  return (
    <div className="space-y-4">
      {/* Active players card */}
      <div className="glass-card overflow-hidden">
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
                  className={`flex items-center px-3 py-2.5 gap-3 rounded-xl${isMe ? ' player-highlight-green' : ''}`}
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
                          <span className="text-gray-400">Cancel your spot?</span>
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
      </div>

      {/* Waitlist card */}
      {waitlistPlayers.length > 0 && (
        <div className="glass-card overflow-hidden">
          <div className="list-header-amber px-4 pt-3 pb-2">
            WAITLIST
          </div>
            <div className="px-2 pb-2 space-y-0.5">
              {waitlistPlayers.map((player, i) => {
                const isMe =
                  !!currentUser &&
                  player.name.toLowerCase() === currentUser.toLowerCase();

                return (
                  <div
                    key={player.id}
                    className={`flex items-center px-3 py-2.5 gap-3 rounded-xl${isMe ? ' player-highlight-amber' : ''}`}
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
                            <span className="text-gray-400">Cancel your spot?</span>
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
      )}
    </div>
  );
}
