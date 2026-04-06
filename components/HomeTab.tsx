'use client';

import { useState, useEffect, useCallback } from 'react';
import type { Session, Player, Announcement } from '@/lib/types';
import { fmtDate } from '@/lib/formatters';
import { getIdentity, setIdentity, clearIdentity } from '@/lib/identity';
import ShuttleLoader from '@/components/ShuttleLoader';

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


export default function HomeTab({ onTabChange, onTitleTap }: { onTabChange?: (tab: 'home' | 'players' | 'admin') => void; onTitleTap?: () => void }) {
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
  const [reportingPaid, setReportingPaid] = useState(false);

  const maxPlayers = parseInt(process.env.NEXT_PUBLIC_MAX_PLAYERS ?? '12');

  const loadData = useCallback(async () => {
    setLoading(true);
    const minDelay = new Promise(r => setTimeout(r, 1500));
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
      await minDelay;
    } catch (e) {
      console.error('Load error:', e);
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    const id = getIdentity();
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

  // Payment calculations
  const currentPlayerRecord = currentUser
    ? players.find(p => p.name.toLowerCase() === currentUser.toLowerCase())
    : null;
  const courtTotal = session?.costPerCourt && session.courts
    ? session.costPerCourt * session.courts : 0;
  const birdTotal = session?.showCostBreakdown && session?.birdUsage?.totalBirdCost
    ? session.birdUsage.totalBirdCost : 0;
  const totalCost = courtTotal + birdTotal;
  const perPersonCost = totalCost > 0 && activePlayers.length > 0
    ? totalCost / activePlayers.length : null;
  const perPersonCourt = courtTotal > 0 && activePlayers.length > 0
    ? courtTotal / activePlayers.length : null;
  const perPersonBird = birdTotal > 0 && activePlayers.length > 0
    ? birdTotal / activePlayers.length : null;
  const etransferEmail = process.env.NEXT_PUBLIC_ETRANSFER_EMAIL || null;

  async function handleReportPaid() {
    const identity = getIdentity();
    if (!identity?.token || !currentPlayerRecord?.id) return;
    setReportingPaid(true);
    try {
      await fetch(`${BASE}/api/players`, {
        method: 'PATCH',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ id: currentPlayerRecord.id, deleteToken: identity.token, selfReportedPaid: true }),
      });
      await loadData();
    } catch { /* silent */ }
    setReportingPaid(false);
  }

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
      {/* BPM Badminton header + Location combined card */}
      <div className="glass-card p-5 space-y-3">
        <div>
          <p className="section-label mb-1">WELCOME TO</p>
          <h1 className="text-2xl font-bold text-white" onClick={onTitleTap} style={{ cursor: 'default', userSelect: 'none' }}>BPM Badminton</h1>
        </div>
        <div className="border-t border-white/10 pt-3 space-y-1.5">
          <p className="section-label mb-2">LOCATION</p>
          {session?.locationName ? (
            <p className="text-base font-semibold text-white">{session.locationName}</p>
          ) : null}
          {session?.locationAddress ? (
            mapsUrl ? (
              <a
                href={mapsUrl}
                target="_blank"
                rel="noopener noreferrer"
                className="text-sm text-gray-300 break-words underline underline-offset-2 decoration-dotted"
              >
                {session.locationAddress}
              </a>
            ) : (
              <p className="text-sm text-gray-300">{session.locationAddress}</p>
            )
          ) : (
            <p className="text-sm text-gray-500">—</p>
          )}
        </div>
      </div>

      {/* Date & Time card */}
      <div className="glass-card p-5 space-y-3">
        <p className="section-label">DATE & TIME</p>
        <div className="flex items-center gap-3">
          <span className="material-icons icon-pin-lg shrink-0 text-white">&#xe878;</span>
          <span className="text-base font-semibold text-white">
            {session ? fmtDate(session.datetime) : '—'}
          </span>
        </div>
        <div className="flex items-center gap-3">
          <span className="material-icons icon-pin-lg shrink-0 text-white">&#xe8b5;</span>
          <span className="text-base font-semibold text-white">
            {session ? fmtTime(session.datetime) : '—'}
          </span>
        </div>
      </div>

      {/* Announcement card */}
      {announcement && (
        <div className="glass-card p-5 space-y-2">
          <p className="section-label">ANNOUNCEMENT</p>
          <p className="text-sm text-gray-200 leading-relaxed">{announcement.text}</p>
        </div>
      )}

      {/* Sign-Up Card */}
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
        ) : isSignupClosed && !isSignedUp && !isWaitlisted ? (
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
        ) : isDeadlinePast && !isSignedUp && !isWaitlisted ? (
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
        ) : isSignedUp ? (
          /* ── State 1: Active sign-up ── */
          <div className="space-y-4">
            <div className="flex items-start justify-between">
              <p className="text-xl font-bold text-green-400">Sign up</p>
              <p className="text-sm text-gray-400">{activePlayers.length} players · {spotsTotal - activePlayers.length} spots left</p>
            </div>
            <div className="status-banner-green">
              <span className="material-icons icon-status text-green-400">check_circle</span>
              <div>
                <p className="font-semibold text-green-400 text-sm">{currentUser}, thank you for signing up!</p>
                <p className="text-xs text-gray-400 mt-0.5">See you soon!</p>
              </div>
            </div>
            {/* Payment card */}
            {perPersonCost !== null && perPersonCost > 0 && (
              <div className="inner-card p-3 space-y-2">
                {perPersonCourt !== null && perPersonBird !== null ? (
                  <>
                    <div className="flex items-center justify-between">
                      <p className="text-xs" style={{ color: 'var(--text-muted)' }}>Courts</p>
                      <p className="text-xs" style={{ color: 'var(--text-secondary)' }}>${perPersonCourt.toFixed(2)}</p>
                    </div>
                    <div className="flex items-center justify-between">
                      <p className="text-xs" style={{ color: 'var(--text-muted)' }}>Birds</p>
                      <p className="text-xs" style={{ color: 'var(--text-secondary)' }}>${perPersonBird.toFixed(2)}</p>
                    </div>
                    <div className="flex items-center justify-between pt-1" style={{ borderTop: '1px solid var(--glass-border)' }}>
                      <p className="text-xs font-medium" style={{ color: 'var(--text-secondary)' }}>Total per person</p>
                      <p className="text-sm font-bold" style={{ color: 'var(--accent)' }}>${perPersonCost!.toFixed(2)}</p>
                    </div>
                  </>
                ) : (
                  <div className="flex items-center justify-between">
                    <p className="text-xs font-medium" style={{ color: 'var(--text-secondary)' }}>Cost per person</p>
                    <p className="text-sm font-bold" style={{ color: 'var(--accent)' }}>${perPersonCost!.toFixed(2)}</p>
                  </div>
                )}
                {etransferEmail && (
                  <p className="text-xs" style={{ color: 'var(--text-muted)' }}>
                    E-transfer to: <span style={{ color: 'var(--text-secondary)' }}>{etransferEmail}</span>
                  </p>
                )}
                {currentPlayerRecord?.paid ? (
                  <div className="flex items-center gap-1.5">
                    <span className="material-icons text-green-400" style={{ fontSize: 16 }}>check_circle</span>
                    <span className="text-xs font-medium text-green-400">Payment confirmed</span>
                  </div>
                ) : currentPlayerRecord?.selfReportedPaid ? (
                  <div className="flex items-center gap-1.5">
                    <span className="material-icons text-amber-400" style={{ fontSize: 16 }}>schedule</span>
                    <span className="text-xs font-medium text-amber-400">Reported — awaiting confirmation</span>
                  </div>
                ) : (
                  <button
                    type="button"
                    onClick={handleReportPaid}
                    disabled={reportingPaid}
                    className="btn-ghost w-full flex items-center justify-center gap-2"
                    style={{ minHeight: 44 }}
                  >
                    <span className="material-icons" style={{ fontSize: 16 }}>payments</span>
                    <span className="text-sm font-medium">{reportingPaid ? 'Reporting...' : 'I paid'}</span>
                  </button>
                )}
              </div>
            )}
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
              <p className="text-sm text-gray-400">{activePlayers.length} players · Full</p>
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
              <p className="text-sm text-gray-400">{activePlayers.length} players · {spotsTotal - activePlayers.length} spots left</p>
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
    </div>
  );
}
