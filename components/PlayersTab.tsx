'use client';

import { useState, useEffect, useCallback } from 'react';
import type { Player, Session } from '@/lib/types';

const STORAGE_KEY = 'badminton_username';
const STORAGE_KEY_TOKEN = 'badminton_deletetoken';
const BASE = process.env.NEXT_PUBLIC_BASE_PATH ?? '';

function fmtDate(iso: string) {
  if (!iso) return '';
  try {
    return new Date(iso).toLocaleDateString(undefined, {
      weekday: 'long',
      month: 'long',
      day: 'numeric',
    });
  } catch {
    return '';
  }
}

export default function PlayersTab() {
  const [players, setPlayers] = useState<Player[]>([]);
  const [session, setSession] = useState<Session | null>(null);
  const [currentUser, setCurrentUser] = useState<string | null>(null);
  const [loading, setLoading] = useState(true);
  const [cancelError, setCancelError] = useState('');

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
      loadPlayers();
    } else {
      setCancelError('Failed to cancel. Please try again.');
    }
  }

  if (loading) {
    return (
      <div className="flex items-center justify-center h-48">
        <span className="material-icons animate-spin text-green-400" style={{ fontSize: 32 }}>
          refresh
        </span>
      </div>
    );
  }

  if (players.length === 0) {
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
      <p className="text-xs font-bold tracking-widest text-green-400">
        {players.length} PLAYER{players.length !== 1 ? 'S' : ''} SIGNED UP
      </p>

      <div className="glass-card overflow-hidden">
        {/* Game date header */}
        <div
          className="px-4 pt-3 pb-2 text-xs font-bold tracking-widest"
          style={{ color: 'rgba(74, 222, 128, 0.55)' }}
        >
          {gameDate || 'UPCOMING SESSION'}
        </div>

        <div className="px-2 pb-2 space-y-0.5">
          {players.map((player, i) => {
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
                    <button
                      onClick={handleCancel}
                      className="text-xs text-red-400 hover:text-red-300 transition-colors ml-1"
                    >
                      Cancel
                    </button>
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
  );
}
