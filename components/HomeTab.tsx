'use client';

import { useState, useEffect, useCallback } from 'react';
import type { Session, Player, Announcement } from '@/lib/types';
import type { DevOverrides } from '@/components/DevPanel';
import { fmtDate } from '@/lib/formatters';
import { normalizeBirdUsages, totalBirdCost } from '@/lib/birdUsages';
import { getIdentity, setIdentity, clearIdentity } from '@/lib/identity';
import ShuttleLoader from '@/components/ShuttleLoader';
import CostCard from '@/components/CostCard';
import PrevPaymentReminder from '@/components/PrevPaymentReminder';

const BASE = process.env.NEXT_PUBLIC_BASE_PATH ?? '';

function fmtTime(iso: string) {
  if (!iso) return '—';
  try {
    return new Date(iso).toLocaleTimeString(undefined, {
      hour: '2-digit',
      minute: '2-digit',
    });
  } catch {
    return iso;
  }
}

function fmtDeadline(iso: string) {
  if (!iso) return '—';
  try {
    return new Date(iso).toLocaleDateString(undefined, {
      weekday: 'long',
      month: 'long',
      day: 'numeric',
    });
  } catch {
    return iso;
  }
}


export default function HomeTab({ onTabChange, onTitleTap, devOverrides }: { onTabChange?: (tab: 'home' | 'players' | 'admin') => void; onTitleTap?: () => void; devOverrides?: DevOverrides }) {
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

  const maxPlayers = parseInt(process.env.NEXT_PUBLIC_MAX_PLAYERS ?? '12');

  const loadData = useCallback(async () => {
    setLoading(true);
    try {
      const [sRes, pRes, aRes, mRes] = await Promise.all([
        fetch(`${BASE}/api/session`, { cache: 'no-store' }),
        fetch(`${BASE}/api/players`, { cache: 'no-store' }),
        fetch(`${BASE}/api/announcements`, { cache: 'no-store' }),
        fetch(`${BASE}/api/members`, { cache: 'no-store' }).catch(() => null),
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

  async function handleSignUp(e: React.FormEvent) {
    e.preventDefault();
    if (!name.trim()) { setError('Enter your name to sign up'); return; }
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
        setError(data.error ?? 'Failed to sign up');
        if (res.status === 409) loadData();
      } else {
        setIdentity({ name: name.trim(), token: data.deleteToken ?? '', sessionId: session?.id ?? '' });
        setCurrentUser(name.trim());
        setHasIdentity(true);
        await loadData();
      }
    } catch {
      setError('Network error. Please try again.');
    } finally {
      setIsSubmitting(false);
    }
  }

  async function handleJoinWaitlist(e: React.FormEvent) {
    e.preventDefault();
    if (!name.trim()) { setError('Enter your name to sign up'); return; }
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
        setError(data.error ?? 'Failed to join waitlist');
      } else {
        setIdentity({ name: name.trim(), token: data.deleteToken ?? '', sessionId: session?.id ?? '' });
        setCurrentUser(name.trim());
        setHasIdentity(true);
        await loadData();
      }
    } catch {
      setError('Network error. Please try again.');
    } finally {
      setIsSubmitting(false);
    }
  }

  if (loading) {
    return <ShuttleLoader text="Loading session..." />;
  }

  const mapsUrl = session?.locationAddress
    ? `https://maps.google.com/?q=${encodeURIComponent(session.locationAddress)}`
    : null;

  return (
    <div className="space-y-5">
      {/* Tile row: BPM Badminton | Date & Time */}
      <div className="grid grid-cols-2 gap-3">
        {/* BPM tile */}
        <div className="glass-card p-4 space-y-2">
          <p className="section-label mb-1">BPM</p>
          <h1
            className="text-lg font-bold text-white leading-tight"
            onClick={onTitleTap}
            style={{ cursor: 'default', userSelect: 'none' }}
          >
            BPM Badminton
          </h1>
          {session?.locationName && (
            <p className="text-xs font-semibold text-white line-clamp-2">
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
          <p className="section-label mb-1">WHEN</p>
          <p className="text-sm font-semibold text-white leading-snug">
            {session ? fmtDate(session.datetime) : '—'}
          </p>
          <p className="text-sm font-semibold text-white leading-snug">
            {session ? fmtTime(session.datetime) : '—'}
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
          <p className="section-label">ANNOUNCEMENT</p>
          <p className="text-sm text-gray-200 leading-relaxed">{effectiveAnnouncement.text}</p>
        </div>
      )}

      {/* Sign-Up Card — placed at the bottom so the submit button / payment
          action / "I paid" button sit in the thumb zone for one-handed use. */}
      <div className="glass-card p-5">
        {isSessionFinished ? (
          /* ── State: Session finished ── */
          <div className="space-y-4">
            <p className="text-xl font-bold text-green-400">Sign up</p>
            <div className="status-banner-green">
              <span className="material-icons icon-status text-green-400">celebration</span>
              <div>
                <p className="font-semibold text-green-400 text-sm">Thanks for playing!</p>
                <p className="text-xs text-gray-400 mt-0.5">Sign up for next week will be announced soon.</p>
              </div>
            </div>
          </div>
        ) : isSignupClosed && !effectiveIsSignedUp && !isWaitlisted ? (
          /* ── State: Sign-ups opening soon ── */
          <div className="space-y-4">
            <p className="text-xl font-bold text-green-400">Sign up</p>
            <div className="status-banner-orange">
              <span className="material-icons icon-status text-amber-400">hourglass_top</span>
              <div>
                <p className="font-semibold text-amber-300 text-sm">Sign-ups opening soon</p>
                <p className="text-xs text-gray-400 mt-0.5">Check back soon.</p>
              </div>
            </div>
          </div>
        ) : isDeadlinePast && !effectiveIsSignedUp && !isWaitlisted ? (
          /* ── State: Deadline passed ── */
          <div className="space-y-4">
            <p className="text-xl font-bold text-green-400">Sign up</p>
            <div className="status-banner-orange">
              <span className="material-icons icon-status text-amber-400">lock_clock</span>
              <div>
                <p className="font-semibold text-amber-300 text-sm">Sign-ups closed</p>
                <p className="text-xs text-gray-400 mt-0.5">Sign-ups closed on {fmtDeadline(session!.deadline)}</p>
              </div>
            </div>
          </div>
        ) : effectiveIsSignedUp ? (
          /* ── State 1: Active sign-up ── */
          <div className="space-y-4">
            <div className="flex items-start justify-between">
              <p className="text-xl font-bold text-green-400">Sign up</p>
              <p className="text-sm text-gray-400">Signed-up: {activePlayers.length} · {spotsTotal - activePlayers.length} spots left</p>
            </div>
            <div className="status-banner-green">
              <span className="material-icons icon-status text-green-400">check_circle</span>
              <div>
                <p className="font-semibold text-green-400 text-sm">{currentUser}, thank you for signing up!</p>
                <p className="text-xs text-gray-400 mt-0.5">See you soon!</p>
              </div>
            </div>
            <button type="button" onClick={() => onTabChange?.('players')} className="btn-ghost w-full">
              View Sign Up List
            </button>
          </div>
        ) : isWaitlisted ? (
          /* ── State 2: On waitlist ── */
          <div className="space-y-4">
            <div className="flex items-start justify-between">
              <p className="text-xl font-bold text-green-400">Sign up</p>
              <div className="text-right">
                <p className="text-xs text-gray-400">Waitlist</p>
                <p className="text-2xl font-bold text-amber-400 leading-none mt-0.5">
                  #{waitlistPosition}
                </p>
              </div>
            </div>
            <div className="status-banner-orange">
              <span className="material-icons icon-status text-amber-400">schedule</span>
              <div>
                <p className="font-semibold text-amber-400 text-sm">You&apos;re on the waitlist</p>
                <p className="text-xs text-gray-400 mt-0.5">Position #{waitlistPosition} of {waitlistPlayers.length} · Signed up as {currentUser}</p>
              </div>
            </div>
            <button type="button" onClick={() => onTabChange?.('players')} className="btn-ghost w-full">
              View Sign Up List
            </button>
          </div>
        ) : isFull && !isDeadlinePast ? (
          /* ── State 3: Full — join waitlist form ── */
          <div className="space-y-4">
            <div className="flex items-start justify-between">
              <p className="text-xl font-bold text-green-400">Sign up</p>
              <p className="text-sm text-gray-400">Signed-up: {activePlayers.length} · Full</p>
            </div>
            <div className="status-banner-orange">
              <span className="material-icons icon-status text-orange-400">lock</span>
              <div>
                <p className="font-semibold text-orange-300 text-sm">Session Full</p>
                <p className="text-xs text-gray-400 mt-0.5">All {spotsTotal} spots are taken.</p>
              </div>
            </div>
            <form onSubmit={handleJoinWaitlist} className="space-y-3">
              <div className="relative">
                <input
                  id="waitlist-name"
                  name="name"
                  type="text"
                  placeholder="Enter your name"
                  aria-label="Your name"
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
              <button type="submit" disabled={isSubmitting} className="btn-primary w-full">
                {isSubmitting ? 'Joining…' : 'Join Waitlist'}
              </button>
            </form>
          </div>
        ) : (
          /* ── State 4: Open — normal sign-up ── */
          <div className="space-y-4">
            <div className="flex items-start justify-between">
              <p className="text-xl font-bold text-green-400">Sign up</p>
              <p className="text-sm text-gray-400">Signed-up: {activePlayers.length} · {spotsTotal - activePlayers.length} spots left</p>
            </div>
            <form onSubmit={handleSignUp} className="space-y-3">
              <div className="relative">
                <input
                  id="signup-name"
                  name="name"
                  type="text"
                  placeholder="Enter your name"
                  aria-label="Your name"
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
              <button type="submit" disabled={isSubmitting} className="btn-primary w-full">
                {!isSubmitting && <span className="material-icons icon-sm" aria-hidden="true">how_to_reg</span>}
                {isSubmitting ? 'Signing up…' : 'Sign Up'}
              </button>
              {session?.deadline && (
                <p className={`text-center text-xs font-medium ${isDeadlineApproaching ? 'text-red-400' : 'text-gray-400'}`}>
                  Sign up closes on {fmtDeadline(session.deadline)}
                </p>
              )}
            </form>
          </div>
        )}
      </div>
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
    </div>
  );
}
