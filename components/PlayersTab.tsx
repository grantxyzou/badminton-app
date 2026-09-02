'use client';

import { useState, useEffect, useCallback } from 'react';
import { useTranslations, useFormatter } from 'next-intl';
import type { Player, Session } from '@/lib/types';
import { getIdentity, setIdentity } from '@/lib/identity';
import CardSkeleton from '@/components/primitives/CardSkeleton';
import SkillDiscoveryCard from './home/SkillDiscoveryCard';
import type { Tab } from './HomeShell';
import ShuttleIcon from '@/components/ShuttleIcon';
import EmptyState from '@/components/primitives/EmptyState';
import PageHeader from '@/components/primitives/PageHeader';
import { BottomSheet, BottomSheetBody } from '@/components/BottomSheet';
import { useOnline, useReportFetchFailure } from '@/lib/useOnline';
import GiveKudosSheet from '@/components/stats/GiveKudosSheet';
import { isFlagOn } from '@/lib/flags';

const BASE = process.env.NEXT_PUBLIC_BASE_PATH ?? '';
const DAY_LONG = { weekday: 'long', month: 'long', day: 'numeric' } as const;

export default function PlayersTab({ onTabChange }: { onTabChange?: (tab: Tab) => void } = {}) {
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
  /* The SECOND door to kudos. The Stats card is the first; this one exists
     because the roster is where you are already looking at the names of the
     people you just played with, and 'how do I give kudos to other people?'
     was asked by someone standing on exactly this screen. */
  const [kudosFor, setKudosFor] = useState<string | null>(null);
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
        <CardSkeleton height={120} />
        <CardSkeleton height={200} />
      </div>
    );
  }

  const activePlayers = players.filter(p => !p.waitlisted);
  const kudosEnabled = isFlagOn('NEXT_PUBLIC_FLAG_KUDOS');
  /* Only someone who was on this roster can have played with anyone on it.
     Checking it here keeps the button off rows the server would refuse. */
  const iAmOnRoster =
    !!currentUser &&
    activePlayers.some((p) => p.name.toLowerCase() === currentUser.toLowerCase());
  const waitlistPlayers = players.filter(p => p.waitlisted);
  /* Which list the viewer is in decides the sheet's wording: coming off a
     waitlist is not the same event as giving up a confirmed spot, and one
     sheet serving both rows has to say which one it means. */
  const imWaitlisted =
    !!currentUser &&
    waitlistPlayers.some((p) => p.name.toLowerCase() === currentUser.toLowerCase());

  // Load failed and we have nothing to show: render an explicit error (standalone
  // centered text + ghost retry, per the error-state convention) instead of the
  // "no one signed up yet" empty state, which would lie about why the list is bare.
  if (loadError && activePlayers.length === 0 && waitlistPlayers.length === 0) {
    return (
      <div className="space-y-5">
        <PageHeader>{pageT('title')}</PageHeader>
        {/* Same padding as every other page-level fallback (48/24) and the
            convention's space-y-3 instead of a hand-rolled h-3 spacer. The
            empty-state branch below was routed through <EmptyState> for
            exactly this reason; its error-state twin was left behind. */}
        <div className="py-12 px-6 text-center space-y-3">
          <p className="fs-md text-gray-400" role="alert">{t('loadError')}</p>
          <button type="button" onClick={() => loadPlayers()} className="cc-btn cc-btn-ghost">{t('retry')}</button>
        </div>
      </div>
    );
  }

  if (activePlayers.length === 0 && waitlistPlayers.length === 0) {
    return (
      <div className="space-y-5">
        <PageHeader>{pageT('title')}</PageHeader>
        {/* Brand shuttle rather than a Material glyph — design spec reserves it
            for "anywhere the UI refers to the sport itself". Routed through
            <EmptyState> so the spacing, size and ink match every other empty
            state instead of being a hand-rolled p-10 with a spacer div. */}
        <div className="glass-card p-5">
          <EmptyState icon={<ShuttleIcon size={40} color="var(--text-muted)" />}>
            {t('empty')}
          </EmptyState>
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
                  className={`flex items-center px-3 py-3 gap-3 rounded-xl animate-fadeIn${isMe ? ' player-highlight-green' : ''}`}
                  /* Stagger entrance ~40ms/row, capped so a long list doesn't
                     crawl in. Stable key → only first mount + genuinely new
                     rows animate; poll refreshes don't replay it. */
                  style={{ animationDelay: `${Math.min(i, 8) * 40}ms` }}
                >
                  <span className="fs-sm text-gray-500 w-5 text-right font-mono tabular-nums">
                    {i + 1}
                  </span>
                  <span className="flex-1 fs-md text-gray-200 font-medium">
                    {player.name}
                    {isMe && (
                      <span className="ml-1.5 fs-sm font-normal" style={{ color: 'var(--text-muted)' }}>
                        {t('youSuffix')}
                      </span>
                    )}
                  </span>
                  {/* Not on my own row, and only for someone I actually shared
                      this roster with — which is the same rule the server
                      enforces, so the button can never open a sheet whose send
                      is refused. Neutral, not accent: Sign-Ups spends its accent
                      on signing up. */}
                  {!isMe && kudosEnabled && iAmOnRoster && (
                    <button
                      type="button"
                      onClick={() => setKudosFor(player.name)}
                      className="cc-btn cc-btn-ghost"
                      aria-label={t('kudosAction', { name: player.name })}
                      style={{ padding: 'var(--space-1) var(--space-3)', color: 'var(--text-muted)' }}
                    >
                      <span className="material-icons icon-sm" aria-hidden="true">volunteer_activism</span>
                    </button>
                  )}
                  {isMe && (
                    <div className="flex flex-col items-end gap-0.5">
                      <button
                        type="button"
                        onClick={() => setConfirmingCancel(true)}
                        disabled={!online}
                        className="fs-sm text-red-400 hover:text-red-300 transition-colors ml-1"
                      >
                        {t('cancelAction')}
                      </button>
                      {cancelError && (
                        <span className="field-error">{cancelError}</span>
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
                    className={`flex items-center px-3 py-3 gap-3 rounded-xl animate-fadeIn${isMe ? ' player-highlight-amber' : ''}`}
                    style={{ animationDelay: `${Math.min(i, 8) * 40}ms` }}
                  >
                    <span className="fs-sm text-gray-500 w-5 text-right font-mono tabular-nums">
                      {activePlayers.length + i + 1}
                    </span>
                    <span className="flex-1 fs-md text-gray-400 font-medium">
                      {player.name}
                      {isMe && (
                        <span className="ml-1.5 fs-sm font-normal" style={{ color: 'var(--text-muted)' }}>
                          {t('youSuffix')}
                        </span>
                      )}
                    </span>
                    {isMe && (
                      <div className="flex flex-col items-end gap-0.5">
                        <button
                          type="button"
                          onClick={() => setConfirmingCancel(true)}
                          disabled={!online}
                          className="fs-sm text-red-400 hover:text-red-300 transition-colors ml-1"
                        >
                          {t('leaveAction')}
                        </button>
                        {cancelError && (
                          <span className="field-error">{cancelError}</span>
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

      {/* Skill-rating discovery hook. Lives here rather than on Home because
          this IS the sign-up touchpoint -- the moment a player has just
          confirmed they're playing is when "is my game improving?" lands.
          Self-retiring: flag-on, identified, unrated and undismissed only. */}
      <SkillDiscoveryCard
        name={currentUser}
        signedUp={activePlayers.some((p) => p.name === currentUser)}
        onOpen={() => onTabChange?.('skills')}
      />

      {/* ONE sheet for both lists, rendered here rather than inside the row.
          The confirmation used to expand inside the row itself, which gave a
          three-word question and two buttons the width left over after a name
          — "Cancel your spot?" wrapped onto three lines beside a long one. A
          row is not a container for a decision.

          `confirmingCancel` was already a single component-level boolean, not
          per-row, which is what makes one sheet the honest rendering of the
          state that existed all along: only ever your own row can offer this,
          so there is only ever one confirmation in flight. */}
      <BottomSheet
        open={confirmingCancel}
        onClose={() => setConfirmingCancel(false)}
        ariaLabel={imWaitlisted ? t('leaveSheetTitle') : t('cancelConfirm')}
        width="narrow"
      >
        <BottomSheetBody>
          <div style={{ display: 'flex', flexDirection: 'column', gap: 'var(--space-4)' }}>
            <div>
              <h2 className="bpm-h3 m-0">
                {imWaitlisted ? t('leaveSheetTitle') : t('cancelConfirm')}
              </h2>
              <p className="fs-base m-0" style={{ marginTop: 'var(--space-2)', color: 'var(--text-secondary)' }}>
                {imWaitlisted ? t('leaveSheetBody') : t('cancelSheetBody')}
              </p>
            </div>
            <div style={{ display: 'flex', flexDirection: 'column', gap: 'var(--space-2)' }}>
              {/* Destructive action leads and is named for what it does —
                  "Yes" under the question "Cancel your spot?" made the
                  dismissing button read as "No, cancel it". */}
              <button
                type="button"
                onClick={handleCancel}
                disabled={!online}
                className="cc-btn cc-btn-danger cc-btn-lg"
              >
                {imWaitlisted ? t('leaveSheetConfirm') : t('cancelSheetConfirm')}
              </button>
              <button
                type="button"
                onClick={() => setConfirmingCancel(false)}
                className="cc-btn cc-btn-ghost cc-btn-lg"
              >
                {t('sheetKeep')}
              </button>
            </div>
          </div>
        </BottomSheetBody>
      </BottomSheet>

      {/* Opened on a specific person, so the sheet skips its picker entirely.
          Same sheet as Stats — one flow, two entry points. */}
      <GiveKudosSheet
        open={kudosFor !== null}
        onClose={() => setKudosFor(null)}
        recipient={kudosFor}
      />
    </div>
  );
}
