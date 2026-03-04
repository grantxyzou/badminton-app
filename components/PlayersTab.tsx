'use client';

import { useState, useEffect, useCallback } from 'react';
import type { Player } from '@/lib/types';

const STORAGE_KEY = 'badminton_username';

const SKILL_STYLE: Record<Player['skill'], string> = {
  Beginner: 'text-green-400 bg-green-400/10',
  Intermediate: 'text-blue-400 bg-blue-400/10',
  Advanced: 'text-orange-400 bg-orange-400/10',
};

export default function PlayersTab() {
  const [players, setPlayers] = useState<Player[]>([]);
  const [currentUser, setCurrentUser] = useState<string | null>(null);
  const [loading, setLoading] = useState(true);

  const loadPlayers = useCallback(async () => {
    setLoading(true);
    try {
      const res = await fetch('/api/players');
      if (res.ok) setPlayers(await res.json());
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
    const res = await fetch('/api/players', {
      method: 'DELETE',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ name: currentUser }),
    });
    if (res.ok) {
      localStorage.removeItem(STORAGE_KEY);
      setCurrentUser(null);
      loadPlayers();
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

  // Group players into courts of 4
  const games: Player[][] = [];
  for (let i = 0; i < players.length; i += 4) {
    games.push(players.slice(i, i + 4));
  }

  return (
    <div className="space-y-4">
      <p className="text-xs font-bold tracking-widest text-green-400">
        {players.length} PLAYER{players.length !== 1 ? 'S' : ''} SIGNED UP
      </p>

      {games.map((game, gi) => (
        <div key={gi} className="glass-card overflow-hidden">
          {/* Game header */}
          <div
            className="px-4 py-2 text-xs font-bold tracking-widest"
            style={{
              background: 'rgba(74, 222, 128, 0.06)',
              color: 'rgba(74, 222, 128, 0.65)',
              borderBottom: '1px solid rgba(74, 222, 128, 0.1)',
            }}
          >
            GAME {gi + 1}
          </div>

          <div className="divide-y" style={{ borderColor: 'rgba(255,255,255,0.05)' }}>
            {game.map((player, pi) => {
              const num = gi * 4 + pi + 1;
              const isMe =
                !!currentUser &&
                player.name.toLowerCase() === currentUser.toLowerCase();

              return (
                <div
                  key={player.id}
                  className="flex items-center px-4 py-3 gap-3"
                  style={isMe ? { background: 'rgba(74, 222, 128, 0.07)' } : undefined}
                >
                  <span className="text-xs text-gray-500 w-5 text-right font-mono tabular-nums">
                    {num}
                  </span>
                  <span className="flex-1 text-sm text-gray-200 font-medium">
                    {player.name}
                    {isMe && (
                      <span className="ml-1.5 text-xs text-green-400 font-normal">
                        (you)
                      </span>
                    )}
                  </span>
                  <span
                    className={`text-xs font-semibold px-2 py-0.5 rounded-full ${SKILL_STYLE[player.skill]}`}
                  >
                    {player.skill}
                  </span>
                  {isMe && (
                    <button
                      onClick={handleCancel}
                      className="text-xs text-red-400 hover:text-red-300 transition-colors ml-1"
                    >
                      Cancel
                    </button>
                  )}
                </div>
              );
            })}
          </div>
        </div>
      ))}
    </div>
  );
}
