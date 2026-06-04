'use client';

import { useState, useEffect, useCallback } from 'react';
import { useTranslations, useFormatter } from 'next-intl';
import type { Player, Session } from '@/lib/types';
import { getIdentity, setIdentity } from '@/lib/identity';
import ShuttleLoader from '@/components/ShuttleLoader';
import ShuttleIcon from '@/components/ShuttleIcon';
import PageHeader from '@/components/primitives/PageHeader';
import ConfirmInline from '@/components/primitives/ConfirmInline';
import { useOnline, useReportFetchFailure } from '@/lib/useOnline';

const BASE = process.env.NEXT_PUBLIC_BASE_PATH ?? '';
const DAY_LONG = { weekday: 'long', month: 'long', day: 'numeric' } as const;

export default function PlayersTab() {
  const pageT = useTranslations('pages.signup');
  const t = useTranslations('players');
  const online = useOnline();
  const format = useFormatter();
  const [players, setPlayers] = useState<Player[]>([]);
  const [session, setSession] = useState<Session | null>(null);
  const [currentUser, setCurrentUser] = useState<string | null>(null);
  const [loading, setLoading] = useState(true);
  const [loadError, setLoadError] = useState(false);
  const [cancelError, setCancelError] = useState('');
  const [confirmingCancel, setConfirmingCancel] = useState(false);
  const reportFetchFailure = useReportFetchFailure();

  const loadPlayers = useCallback(async () => {
    setLoading(true);
    setLoadError(false);
    try {
      const [pRes, sRes] = await Promise.all([
        fetch(`${BASE}/api/players`, { cache: 'no-store' }),
        fetch(`${BASE}/api/session`, { cache: 'no-store' }),
      ]);
      // A failed load must NOT silently render as an empty roster — track the
      // error so the UI can say "couldn't load" instead (CLAUDE.md).
      if (!pRes.ok || !sRes.ok) setLoadError(true);
      if (pRes.ok) setPlayers(await pRes.json());
      if (sRes.ok) setSession(await sRes.json());
    } catch {
      setLoadError(true);
      reportFetchFailure();
    } finally {
      setLoading(false);
    }
  }, [reportFetchFailure]);

  useEffect(() => {
    const id = getIdentity();
    if (id) setCurrentUser(id.name);
    loadPlayers();
  }, [loadPlayers]);

  async function handleCancel() {
    if (!currentUser) return;
    if (!online) return; // legible-fail: banner explains; don't fire a doomed DELETE
    const id = getIdentity();
    try {
      const res = await fetch(`${BASE}/api/players`, {
        method: 'DELETE',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ name: currentUser, deleteToken: id?.token }),
      });
      if (res.ok) {
        // Cancelling a session spot is NOT signing out — per the auth
        // taxonomy in CLAUDE.md, "Sign in" and "Sign up" are distinct
        // operations and so are "Sign out" and "Cancel spot". The user
        // remains identified (name + sessionId stay in localStorage) so
        // they can re-sign-up with one tap or stay PIN-authenticated.
        // The deleteToken is wiped because the server already consumed
        // it — leaving it would mean a stale token in localStorage that
        // can't authorize anything.
        if (id) {
          setIdentity({ ...id, token: '' });
        }
        setCurrentUser(null);
        setCancelError('');
        setConfirmingCancel(false);
        loadPlayers();
      } else {
        setCancelError(t('cancelFailure'));
      }
    } catch {
      setCancelError(t('cancelFailure'));
    }
  }

  if (loading) {
    return (
      <div className="space-y-5">
        <PageHeader>{pageT('title')}</PageHeader>
        <ShuttleLoader text={t('loading')} />
      </div>
    );
  }

  const activePlayers = players.filter(p => !p.waitlisted);
  const waitlistPlayers = players.filter(p => p.waitlisted);

  // Load failed and we have nothing to show: render an explicit error (standalone
  // centered text + ghost retry, per the error-state convention) instead of the
  // "no one signed up yet" empty state, which would lie about why the list is bare.
  if (loadError && activePlayers.length === 0 && waitlistPlayers.length === 0) {
    return (
      <div className="space-y-5">
        <PageHeader>{pageT('title')}</PageHeader>
        <div className="p-10 text-center">
          <p className="text-sm text-gray-400" role="alert">{t('loadError')}</p>
          <div className="h-3" />
          <button type="button" onClick={() => loadPlayers()} className="cc-btn cc-btn-ghost">{t('retry')}</button>
        </div>
      </div>
    );
  }

  if (activePlayers.length === 0 && waitlistPlayers.length === 0) {
    return (
      <div className="space-y-5">
        <PageHeader>{pageT('title')}</PageHeader>
        <div className="glass-card p-10 text-center">
          {/* Brand shuttle for empty state — design spec reserves this glyph
              for "anywhere the UI refers to the sport itself." Replaces
              Material's sports_tennis racquet. */}
          <ShuttleIcon size={36} color="var(--text-muted)" ariaLabel="No players yet" />
          <div className="h-2" />
          <p className="text-gray-500 text-sm">{t('empty')}</p>
        </div>
      </div>
    );
  }

  const gameDate = session?.datetime ? format.dateTime(new Date(session.datetime), DAY_LONG) : '';

  return (
    <div className="space-y-5">
      <PageHeader>{pageT('title')}</PageHeader>
      <div className="space-y-4">
      {/* Active players card */}
      <div className="glass-card overflow-hidden">
        <div className="px-4 pt-3 pb-2 section-label">
          {gameDate || t('upcomingSession')}
        </div>

        <div className="px-2 pb-2 space-y-0.5">
            {activePlayers.map((player, i) => {
              const isMe =
                !!currentUser &&
                player.name.toLowerCase() === currentUser.toLowerCase();

              return (
                <div
                  key={player.id}
                  className={`flex items-center px-3 py-2.5 gap-3 rounded-xl animate-fadeIn${isMe ? ' player-highlight-green' : ''}`}
                  /* Stagger entrance ~40ms/row, capped so a long list doesn't
                     crawl in. Stable key → only first mount + genuinely new
                     rows animate; poll refreshes don't replay it. */
                  style={{ animationDelay: `${Math.min(i, 8) * 40}ms` }}
                >
                  <span className="text-xs text-gray-500 w-5 text-right font-mono tabular-nums">
                    {i + 1}
                  </span>
                  <span className="flex-1 text-sm text-gray-200 font-medium">
                    {player.name}
                    {isMe && (
                      <span className="ml-1.5 text-xs font-normal" style={{ color: 'var(--text-muted)' }}>
                        {t('youSuffix')}
                      </span>
                    )}
                  </span>
                  {isMe && (
                    <div className="flex flex-col items-end gap-0.5">
                      {confirmingCancel ? (
                        <ConfirmInline
                          message={t('cancelConfirm')}
                          yesLabel={t('confirmYes')}
                          noLabel={t('confirmNo')}
                          onYes={handleCancel}
                          onNo={() => setConfirmingCancel(false)}
                        />
                      ) : (
                        <button
                          type="button"
                          onClick={() => setConfirmingCancel(true)}
                          disabled={!online}
                          className="text-xs text-red-400 hover:text-red-300 transition-colors ml-1"
                        >
                          {t('cancelAction')}
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
            {t('waitlistHeader')}
          </div>
            <div className="px-2 pb-2 space-y-0.5">
              {waitlistPlayers.map((player, i) => {
                const isMe =
                  !!currentUser &&
                  player.name.toLowerCase() === currentUser.toLowerCase();

                return (
                  <div
                    key={player.id}
                    className={`flex items-center px-3 py-2.5 gap-3 rounded-xl animate-fadeIn${isMe ? ' player-highlight-amber' : ''}`}
                    style={{ animationDelay: `${Math.min(i, 8) * 40}ms` }}
                  >
                    <span className="text-xs text-gray-500 w-5 text-right font-mono tabular-nums">
                      {activePlayers.length + i + 1}
                    </span>
                    <span className="flex-1 text-sm text-gray-400 font-medium">
                      {player.name}
                      {isMe && (
                        <span className="ml-1.5 text-xs font-normal" style={{ color: 'var(--text-muted)' }}>
                          {t('youSuffix')}
                        </span>
                      )}
                    </span>
                    {isMe && (
                      <div className="flex flex-col items-end gap-0.5">
                        {confirmingCancel ? (
                          <ConfirmInline
                            message={t('cancelConfirm')}
                            yesLabel={t('confirmYes')}
                            noLabel={t('confirmNo')}
                            onYes={handleCancel}
                            onNo={() => setConfirmingCancel(false)}
                          />
                        ) : (
                          <button
                            type="button"
                            onClick={() => setConfirmingCancel(true)}
                            disabled={!online}
                            className="text-xs text-red-400 hover:text-red-300 transition-colors ml-1"
                          >
                            {t('leaveAction')}
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
