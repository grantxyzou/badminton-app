'use client';

import { useState, useEffect, useCallback } from 'react';
import { useTranslations } from 'next-intl';
import type { Player, Session } from '@/lib/types';
import { fmtDate } from '@/lib/formatters';
import { getIdentity, clearIdentity } from '@/lib/identity';
import ShuttleLoader from '@/components/ShuttleLoader';

const BASE = process.env.NEXT_PUBLIC_BASE_PATH ?? '';

export default function PlayersTab() {
  const pageT = useTranslations('pages.signup');
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
    const id = getIdentity();
    if (id) setCurrentUser(id.name);
    loadPlayers();
  }, [loadPlayers]);

  async function handleCancel() {
    if (!currentUser) return;
    const id = getIdentity();
    try {
      const res = await fetch(`${BASE}/api/players`, {
        method: 'DELETE',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ name: currentUser, deleteToken: id?.token }),
      });
      if (res.ok) {
        clearIdentity();
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
      <div className="space-y-5">
        <h1 className="text-3xl font-bold text-gray-200 leading-tight px-2">
          {pageT('title')}
        </h1>
        <ShuttleLoader text="Loading players..." />
      </div>
    );
  }

  const activePlayers = players.filter(p => !p.waitlisted);
  const waitlistPlayers = players.filter(p => p.waitlisted);

  if (activePlayers.length === 0 && waitlistPlayers.length === 0) {
    return (
      <div className="space-y-5">
        <h1 className="text-3xl font-bold text-gray-200 leading-tight px-2">
          {pageT('title')}
        </h1>
        <div className="glass-card p-10 text-center">
          <span className="material-icons block mb-2 text-gray-500" style={{ fontSize: 36, opacity: 0.25 }}>sports_tennis</span>
          <p className="text-gray-500 text-sm">No one&apos;s signed up yet — be the first!</p>
        </div>
      </div>
    );
  }

  const gameDate = session?.datetime ? fmtDate(session.datetime) : '';

  return (
    <div className="space-y-5">
      <h1 className="text-3xl font-bold text-gray-200 leading-tight px-2">
        {pageT('title')}
      </h1>
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
                          <button onClick={handleCancel} className="text-red-400 hover:text-red-300 transition-colors px-2 py-1" style={{ minHeight: 32 }}>Yes</button>
                          <button onClick={() => setConfirmingCancel(false)} className="text-gray-400 hover:text-white transition-colors px-2 py-1" style={{ minHeight: 32 }}>No</button>
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
    </div>
  );
}
