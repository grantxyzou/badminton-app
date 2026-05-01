'use client';

import { useState, useEffect, useCallback } from 'react';
import { useTranslations, useFormatter } from 'next-intl';
import type { Session, Player, Announcement, Release } from '@/lib/types';
import type { DevOverrides } from '@/components/DevPanel';
import { normalizeBirdUsages, totalBirdCost } from '@/lib/birdUsages';
import { getIdentity, setIdentity, clearIdentity } from '@/lib/identity';
import ShuttleLoader from '@/components/ShuttleLoader';
import CostCard from '@/components/CostCard';
import PrevPaymentReminder from '@/components/PrevPaymentReminder';
import ReleaseNotesTrigger from './ReleaseNotesTrigger';
import ReleaseNotesSheet from './ReleaseNotesSheet';
import WelcomeCard from './WelcomeCard';
import StatusBanner from '@/components/primitives/StatusBanner';
import RecoverySheet from './RecoverySheet';
import { renderMarkdown } from '@/lib/miniMarkdown';

const BASE = process.env.NEXT_PUBLIC_BASE_PATH ?? '';

const DAY_LONG = { weekday: 'long', month: 'long', day: 'numeric' } as const;
const TIME_SHORT = { hour: '2-digit', minute: '2-digit' } as const;

export default function HomeTab({ onTabChange, onTitleTap, devOverrides }: { onTabChange?: (tab: 'home' | 'players' | 'admin') => void; onTitleTap?: () => void; devOverrides?: DevOverrides }) {
  const t = useTranslations('home');
  const tStates = useTranslations('home.states');
  const format = useFormatter();
  const [session, setSession] = useState<Session | null>(null);
  const [players, setPlayers] = useState<Player[]>([]);
  const [announcement, setAnnouncement] = useState<Announcement | null>(null);
  const [currentUser, setCurrentUser] = useState<string | null>(null);
  const [name, setName] = useState('');
  const [isSubmitting, setIsSubmitting] = useState(false);
  const [error, setError] = useState('');
  const [loading, setLoading] = useState(true);
  const [showSuggestions, setShowSuggestions] = useState(false);
  const [memberNames, setMemberNames] = useState<string[]>([]);
  const [hasIdentity, setHasIdentity] = useState(false);
  // Sign up = session signup only (auth taxonomy split). PIN is no longer
  // collected here — it's an opt-in identity primitive, set via Profile →
  // Create account / Set PIN. Returning players who already have a PIN can
  // tap "Already a player? Sign in →" to authenticate via RecoverySheet.
  const [onboardingDismissed, setOnboardingDismissed] = useState(() => {
    if (typeof window === 'undefined') return true;
    return localStorage.getItem('badminton_onboarding_dismissed') === 'true';
  });
  const [releases, setReleases] = useState<Release[]>([]);
  const [releaseSheetOpen, setReleaseSheetOpen] = useState(false);
  const [signInOpen, setSignInOpen] = useState(false);

  const maxPlayers = parseInt(process.env.NEXT_PUBLIC_MAX_PLAYERS ?? '12');

  const loadData = useCallback(async () => {
    setLoading(true);
    try {
      const [sRes, pRes, aRes, mRes, rRes] = await Promise.all([
        fetch(`${BASE}/api/session`, { cache: 'no-store' }),
        fetch(`${BASE}/api/players`, { cache: 'no-store' }),
        fetch(`${BASE}/api/announcements`, { cache: 'no-store' }),
        fetch(`${BASE}/api/members`, { cache: 'no-store' }).catch(() => null),
        fetch(`${BASE}/api/releases`, { cache: 'no-store' }).catch(() => null),
      ]);
      if (sRes.ok) {
        const s: Session = await sRes.json();
        setSession(s);
        // Clear stale identity from a previous session
        const id = getIdentity();
        if (id && id.sessionId && id.sessionId !== s.id) {
          clearIdentity();
          setCurrentUser(null);
          setHasIdentity(false);
        }
      }
      if (pRes.ok) setPlayers(await pRes.json());
      if (aRes.ok) {
        const list: Announcement[] = await aRes.json();
        setAnnouncement(list.length > 0 ? list[0] : null);
      }
      if (mRes?.ok) {
        const memberList: { name: string; active: boolean }[] = await mRes.json();
        setMemberNames(memberList.filter(m => m.active).map(m => m.name));
      }
      if (rRes && rRes.ok) setReleases(await rRes.json());
    } catch (e) {
      console.error('Load error:', e);
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    const id = getIdentity();
    setHasIdentity(id !== null);
    if (id) setCurrentUser(id.name);
    loadData();
  }, [loadData]);

  useEffect(() => {
    if (hasIdentity && !onboardingDismissed) {
      localStorage.setItem('badminton_onboarding_dismissed', 'true');
      setOnboardingDismissed(true);
    }
  }, [hasIdentity, onboardingDismissed]);

  const activePlayers = players.filter(p => !p.waitlisted);
  const waitlistPlayers = players.filter(p => p.waitlisted);

  const isSignedUp = currentUser
    ? activePlayers.some((p) => p.name.toLowerCase() === currentUser.toLowerCase())
    : false;

  const isWaitlisted = currentUser
    ? waitlistPlayers.some((p) => p.name.toLowerCase() === currentUser.toLowerCase())
    : false;

  const isFull = activePlayers.length >= (session?.maxPlayers ?? maxPlayers);
  const suggestions = name.trim().length > 0
    ? memberNames.filter(n => n.toLowerCase().includes(name.toLowerCase().trim()))
    : [];
  const spotsTotal = session?.maxPlayers ?? maxPlayers;
  const isDeadlinePast = session ? new Date() > new Date(session.deadline) : false;
  const isSessionFinished = session?.endDatetime ? new Date() > new Date(session.endDatetime) : false;
  const isSignupClosed = session ? session.signupOpen === false : false;

  const isDeadlineApproaching = session?.deadline
    ? (() => { const diff = new Date(session.deadline).getTime() - Date.now(); return diff > 0 && diff <= 24 * 60 * 60 * 1000; })()
    : false;

  const waitlistPosition = isWaitlisted && currentUser
    ? waitlistPlayers.findIndex(p => p.name.toLowerCase() === currentUser.toLowerCase()) + 1
    : 0;

  // Payment calculations — dev overrides let the DevPanel control these values
  const dv = devOverrides;
  const effectiveSession = dv && session ? {
    ...session,
    ...(dv.showCostBreakdown !== undefined ? { showCostBreakdown: dv.showCostBreakdown } : {}),
    ...(dv.costPerCourt !== undefined ? { costPerCourt: dv.costPerCourt ?? 0 } : {}),
    ...(dv.courts !== undefined ? { courts: dv.courts } : {}),
    ...(dv.prevCostPerPerson !== undefined ? { prevCostPerPerson: dv.prevCostPerPerson ?? undefined } : {}),
    ...(dv.prevCostPerPerson !== undefined && !session.prevSessionDate ? { prevSessionDate: new Date(Date.now() - 7 * 86400000).toISOString() } : {}),
  } : session;
  const effectivePlayerCount = dv?.activePlayerCount ?? activePlayers.length;

  const currentPlayerRecord = currentUser
    ? players.find(p => p.name.toLowerCase() === currentUser.toLowerCase())
    : null;

  const courtTotal = effectiveSession?.costPerCourt && effectiveSession.courts
    ? effectiveSession.costPerCourt * effectiveSession.courts : 0;
  const birdTotal = effectiveSession?.showCostBreakdown
    ? totalBirdCost(normalizeBirdUsages(effectiveSession))
    : 0;
  const totalCost = courtTotal + birdTotal;
  const perPersonCost = totalCost > 0 && effectivePlayerCount > 0
    ? totalCost / effectivePlayerCount : null;
  const etransferEmail = process.env.NEXT_PUBLIC_ETRANSFER_EMAIL || null;

  // Dev overrides for announcement visibility and signed-up state
  const effectiveAnnouncement = dv?.hasAnnouncement === false ? null
    : dv?.hasAnnouncement === true && !announcement ? { id: 'dev', text: 'Dev mode announcement — testing cost visibility.', time: new Date().toISOString(), sessionId: '' } as Announcement
    : announcement;
  const effectiveIsSignedUp = dv?.isSignedUp !== undefined ? dv.isSignedUp : isSignedUp;

  // Stable identities so memoized children (WelcomeCard / ReleaseNotesTrigger)
  // don't re-render when HomeTab's frequently-changing state ticks (e.g. name
  // input keystrokes). Setters from useState are already stable.
  const dismissOnboarding = useCallback(() => {
    localStorage.setItem('badminton_onboarding_dismissed', 'true');
    setOnboardingDismissed(true);
  }, []);
  const openReleaseSheet = useCallback(() => setReleaseSheetOpen(true), []);

  async function handleSignUp(e: React.FormEvent) {
    e.preventDefault();
    if (!name.trim()) { setError(t('signup.nameRequired')); return; }
    setIsSubmitting(true);
    setError('');
    try {
      const res = await fetch(`${BASE}/api/players`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ name: name.trim() }),
      });
      const data = await res.json();
      if (!res.ok) {
        if (data.error === 'invite_list_not_found') {
          setError(t('signup.inviteError', { name: name.trim() }));
        } else if (data.error === 'pin_required') {
          // Member is PIN-protected — open Sign In sheet instead of letting
          // an anonymous request claim their session slot.
          setSignInOpen(true);
          setError('');
        } else {
          setError(data.error ?? t('signup.genericFailure'));
        }
        if (res.status === 409) loadData();
      } else {
        // Batch C M2: refuse to write identity without a real sessionId.
        // The previous `session?.id ?? ''` defaulted to empty string and
        // silently corrupted identity for every downstream fetch (the
        // RecoveryPinSheet PATCH lookup, attendance card resolution, etc.)
        // until a manual logout cleared it.
        if (!session?.id) {
          setError(t('signup.networkError'));
          return;
        }
        setIdentity({ name: name.trim(), token: data.deleteToken ?? '', sessionId: session.id });
        setCurrentUser(name.trim());
        setHasIdentity(true);
        await loadData();
      }
    } catch {
      setError(t('signup.networkError'));
    } finally {
      setIsSubmitting(false);
    }
  }

  async function handleJoinWaitlist(e: React.FormEvent) {
    e.preventDefault();
    if (!name.trim()) { setError(t('signup.nameRequired')); return; }
    setIsSubmitting(true);
    setError('');
    try {
      const res = await fetch(`${BASE}/api/players`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ name: name.trim(), waitlist: true }),
      });
      const data = await res.json();
      if (!res.ok) {
        if (data.error === 'invite_list_not_found') {
          setError(t('signup.inviteError', { name: name.trim() }));
        } else if (data.error === 'pin_required') {
          setSignInOpen(true);
          setError('');
        } else {
          setError(data.error ?? t('signup.waitlistFailure'));
        }
      } else {
        // Batch C M2: same empty-sessionId guard as handleSignUp.
        if (!session?.id) {
          setError(t('signup.networkError'));
          return;
        }
        setIdentity({ name: name.trim(), token: data.deleteToken ?? '', sessionId: session.id });
        setCurrentUser(name.trim());
        setHasIdentity(true);
        await loadData();
      }
    } catch {
      setError(t('signup.networkError'));
    } finally {
      setIsSubmitting(false);
    }
  }

  if (loading) {
    return <ShuttleLoader text={t('loading')} />;
  }

  const mapsUrl = session?.locationAddress
    ? `https://maps.google.com/?q=${encodeURIComponent(session.locationAddress)}`
    : null;

  return (
    <div className="space-y-5">
      {!hasIdentity && !onboardingDismissed && (
        <WelcomeCard onDismiss={dismissOnboarding} />
      )}

      {/* Page title + release trigger — grouped so no space-y-5 gap sits
          between them; the version stamp sits tight under the title. */}
      <div>
        {/* Wordmark uses the same `bpm-h1` token as PageHeader but stays
            inline because of the easter-egg `onTitleTap` handler. The
            font-family + letter-spacing are now sourced from the class
            instead of duplicated inline. */}
        <h1
          className="bpm-h1 leading-tight px-2"
          onClick={onTitleTap}
          style={{ cursor: 'default', userSelect: 'none' }}
        >
          BPM Badminton
        </h1>
        <ReleaseNotesTrigger
          releases={releases}
          onOpen={openReleaseSheet}
        />
      </div>

      {/* Tile row: Location | Date & Time */}
      <div className="grid grid-cols-2 gap-3">
        {/* Location tile */}
        <div className="glass-card p-4 space-y-2">
          <p className="section-label mb-1">{t('location.label')}</p>
          {session?.locationName && (
            <p className="text-lg font-semibold text-gray-200 leading-snug line-clamp-2">
              {session.locationName}
            </p>
          )}
          {session?.locationAddress ? (
            mapsUrl ? (
              <a
                href={mapsUrl}
                target="_blank"
                rel="noopener noreferrer"
                className="text-xs text-gray-300 underline underline-offset-2 decoration-dotted line-clamp-2 block"
              >
                {session.locationAddress}
              </a>
            ) : (
              <p className="text-xs text-gray-300 line-clamp-2">{session.locationAddress}</p>
            )
          ) : null}
        </div>

        {/* Date & Time tile */}
        <div className="glass-card p-4 space-y-2">
          <p className="section-label mb-1">{t('session.date')}</p>
          <p className="text-lg font-semibold text-gray-200 leading-snug">
            {session ? format.dateTime(new Date(session.datetime), DAY_LONG) : '—'}
          </p>
          <p className="text-lg font-semibold text-gray-200 leading-snug">
            {session ? format.dateTime(new Date(session.datetime), TIME_SHORT) : '—'}
          </p>
        </div>
      </div>

      {/* Cost per person — standalone card above announcement so cost is
          visible whether or not the admin has posted an announcement. */}
      <CostCard
        showCostBreakdown={effectiveSession?.showCostBreakdown}
        perPersonCost={perPersonCost}
        datetime={effectiveSession?.datetime}
      />

      {/* Announcement card — pure club communications surface. */}
      {effectiveAnnouncement && (
        <div className="glass-card p-5 space-y-2">
          <p className="section-label">{t('announcement.label')}</p>
          <div className="announcement-body text-sm text-gray-200 leading-relaxed">
            {renderMarkdown(effectiveAnnouncement.text)}
          </div>
        </div>
      )}

      {/* Sign-Up Card — placed at the bottom so the submit button / payment
          action / "I paid" button sit in the thumb zone for one-handed use. */}
      <div className="glass-card p-5">
        {isSessionFinished ? (
          /* ── State: Session finished ── */
          <div className="space-y-4">
            <p className="text-xl font-bold text-green-400">{t('signup.heading')}</p>
            <StatusBanner tone="success" icon="celebration" title={tStates('finishedTitle')} body={tStates('finishedBody')} />
          </div>
        ) : isSignupClosed && !effectiveIsSignedUp && !isWaitlisted ? (
          /* ── State: Sign-ups opening soon ── */
          <div className="space-y-4">
            <p className="text-xl font-bold text-green-400">{t('signup.heading')}</p>
            <StatusBanner tone="warn" icon="watch_later" title={tStates('openingSoonTitle')} body={tStates('openingSoonBody')} />
          </div>
        ) : isDeadlinePast && !effectiveIsSignedUp && !isWaitlisted ? (
          /* ── State: Deadline passed ── */
          <div className="space-y-4">
            <p className="text-xl font-bold text-green-400">{t('signup.heading')}</p>
            <StatusBanner
              tone="warn"
              icon="lock_clock"
              title={tStates('closedTitle')}
              body={t('signup.closedPreviously', { date: format.dateTime(new Date(session!.deadline), DAY_LONG) })}
            />
          </div>
        ) : effectiveIsSignedUp ? (
          /* ── State 1: Active sign-up ── */
          <div className="space-y-4">
            <div className="flex items-start justify-between">
              <p className="text-xl font-bold text-green-400">{t('signup.heading')}</p>
              <p className="text-sm text-gray-400">{t('signup.spotsRemaining', { count: activePlayers.length, remaining: spotsTotal - activePlayers.length })}</p>
            </div>
            <StatusBanner
              tone="success"
              icon="check_circle"
              title={currentUser ? tStates('signedUpTitle', { name: currentUser }) : tStates('signedUpTitleGeneric')}
              body={tStates('signedUpBody')}
            />
            <button type="button" onClick={() => onTabChange?.('players')} className="btn-ghost w-full">
              {t('signup.viewList')}
            </button>
          </div>
        ) : isWaitlisted ? (
          /* ── State 2: On waitlist ── */
          <div className="space-y-4">
            <div className="flex items-start justify-between">
              <p className="text-xl font-bold text-green-400">{t('signup.heading')}</p>
              <div className="text-right">
                <p className="text-xs text-gray-400">{tStates('waitlistLabel')}</p>
                <p className="text-2xl font-bold text-amber-400 leading-none mt-0.5">
                  #{waitlistPosition}
                </p>
              </div>
            </div>
            <StatusBanner
              tone="warn"
              icon="schedule"
              title={tStates('waitlistTitle')}
              body={`${tStates('waitlistPositionLabel', { position: waitlistPosition, total: waitlistPlayers.length })} · ${t('signup.confirmed', { name: currentUser ?? '' })}`}
            />
            <button type="button" onClick={() => onTabChange?.('players')} className="btn-ghost w-full">
              {t('signup.viewList')}
            </button>
          </div>
        ) : isFull && !isDeadlinePast ? (
          /* ── State 3: Full — join waitlist form ── */
          <div className="space-y-4">
            <div className="flex items-start justify-between">
              <p className="text-xl font-bold text-green-400">{t('signup.heading')}</p>
              <p className="text-sm text-gray-400">{t('signup.spotsFull', { count: activePlayers.length })}</p>
            </div>
            <StatusBanner tone="warn" icon="lock" title={t('signup.full')} body={t('signup.allSpotsTaken', { total: spotsTotal })} />
            <form onSubmit={handleJoinWaitlist} className="space-y-3">
              <div className="relative">
                <input
                  id="waitlist-name"
                  name="name"
                  type="text"
                  placeholder={t('signup.namePlaceholder')}
                  aria-label={t('signup.nameAriaLabel')}
                  aria-describedby={error ? 'signup-error' : undefined}
                  value={name}
                  onChange={(e) => { setName(e.target.value); setError(''); setShowSuggestions(true); }}
                  onFocus={() => setShowSuggestions(true)}
                  onBlur={() => setTimeout(() => setShowSuggestions(false), 100)}
                  maxLength={50}
                  autoComplete="off"
                />
                {showSuggestions && suggestions.length > 0 && (
                  <ul className="absolute left-0 right-0 top-full mt-1 z-10 rounded-xl overflow-hidden animate-scaleIn"
                      style={{
                        background: 'var(--dropdown-bg)',
                        backdropFilter: 'blur(12px)',
                        WebkitBackdropFilter: 'blur(12px)',
                        border: '1px solid var(--glass-border)',
                      }}>
                    {suggestions.map((s) => (
                      <li key={s}>
                        <button
                          type="button"
                          onMouseDown={() => { setName(s); setShowSuggestions(false); setError(''); }}
                          className="w-full text-left px-4 py-2.5 text-sm transition-colors hover:bg-white/5"
                          style={{ color: 'var(--text-primary)' }}
                        >
                          {s}
                        </button>
                      </li>
                    ))}
                  </ul>
                )}
              </div>
              {error && <p id="signup-error" role="alert" className="text-red-400 text-xs">{error}</p>}
              <button
                type="submit"
                disabled={isSubmitting || !name.trim()}
                className="btn-primary w-full"
              >
                {isSubmitting ? t('signup.joining') : t('signup.waitlist')}
              </button>
            </form>
          </div>
        ) : (
          /* ── State 4: Open — normal sign-up ── */
          <div className="space-y-4">
            <div className="flex items-start justify-between">
              <p className="text-xl font-bold text-green-400">{t('signup.heading')}</p>
              <p className="text-sm text-gray-400">{t('signup.spotsRemaining', { count: activePlayers.length, remaining: spotsTotal - activePlayers.length })}</p>
            </div>
            <form onSubmit={handleSignUp} className="space-y-3">
              <div className="relative">
                <input
                  id="signup-name"
                  name="name"
                  type="text"
                  placeholder={t('signup.namePlaceholder')}
                  aria-label={t('signup.nameAriaLabel')}
                  aria-describedby={error ? 'signup-error' : undefined}
                  value={name}
                  onChange={(e) => { setName(e.target.value); setError(''); setShowSuggestions(true); }}
                  onFocus={() => setShowSuggestions(true)}
                  onBlur={() => setTimeout(() => setShowSuggestions(false), 100)}
                  maxLength={50}
                  autoComplete="off"
                />
                {showSuggestions && suggestions.length > 0 && (
                  <ul className="absolute left-0 right-0 top-full mt-1 z-10 rounded-xl overflow-hidden animate-scaleIn"
                      style={{
                        background: 'var(--dropdown-bg)',
                        backdropFilter: 'blur(12px)',
                        WebkitBackdropFilter: 'blur(12px)',
                        border: '1px solid var(--glass-border)',
                      }}>
                    {suggestions.map((s) => (
                      <li key={s}>
                        <button
                          type="button"
                          onMouseDown={() => { setName(s); setShowSuggestions(false); setError(''); }}
                          className="w-full text-left px-4 py-2.5 text-sm transition-colors hover:bg-white/5"
                          style={{ color: 'var(--text-primary)' }}
                        >
                          {s}
                        </button>
                      </li>
                    ))}
                  </ul>
                )}
              </div>
              {error && <p id="signup-error" role="alert" className="text-red-400 text-xs">{error}</p>}
              <button
                type="submit"
                disabled={isSubmitting || !name.trim()}
                className="btn-primary w-full"
              >
                {!isSubmitting && <span className="material-icons icon-sm" aria-hidden="true">how_to_reg</span>}
                {isSubmitting ? t('signup.submitting') : t('signup.button')}
              </button>
              {!hasIdentity && (
                <button
                  type="button"
                  onClick={() => setSignInOpen(true)}
                  className="text-center text-xs underline"
                  style={{ color: 'var(--text-secondary)', background: 'transparent', border: 'none', cursor: 'pointer', padding: '8px 12px', minHeight: 44, alignSelf: 'center' }}
                >
                  {t('signup.alreadyPlayer')}
                </button>
              )}
              {session?.deadline && (
                <p className={`text-center text-xs font-medium ${isDeadlineApproaching ? 'text-red-400' : 'text-gray-400'}`}>
                  {t('signup.closesOn', { date: format.dateTime(new Date(session.deadline), DAY_LONG) })}
                </p>
              )}
            </form>
          </div>
        )}
      </div>
      <RecoverySheet
        open={signInOpen}
        onClose={() => {
          setSignInOpen(false);
          // Refresh identity and active player after sign-in.
          const fresh = getIdentity();
          if (fresh) {
            setHasIdentity(true);
            setCurrentUser(fresh.name);
          }
        }}
        sessionId={session?.id ?? ''}
      />
      {/* Payment reminder for previous session — visible whenever the player
          has identity (i.e. has signed up before), not only when signed up
          for the current session. Addresses research finding 4.8. */}
      <PrevPaymentReminder
        showCostBreakdown={effectiveSession?.showCostBreakdown}
        prevCostPerPerson={effectiveSession?.prevCostPerPerson}
        prevSessionDate={effectiveSession?.prevSessionDate}
        hasIdentity={hasIdentity}
        etransferEmail={etransferEmail}
      />
      <ReleaseNotesSheet
        open={releaseSheetOpen}
        releases={releases}
        onClose={() => setReleaseSheetOpen(false)}
      />
    </div>
  );
}
