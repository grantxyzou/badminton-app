'use client';

import { useState, useEffect, useCallback } from 'react';
import type { Session, Player, Announcement } from '@/lib/types';
import { fmtDate } from '@/lib/formatters';

const STORAGE_KEY = 'badminton_username';
const STORAGE_KEY_TOKEN = 'badminton_deletetoken';
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


export default function HomeTab({ onTabChange }: { onTabChange?: (tab: 'home' | 'players' | 'admin') => void }) {
  const [session, setSession] = useState<Session | null>(null);
  const [players, setPlayers] = useState<Player[]>([]);
  const [announcement, setAnnouncement] = useState<Announcement | null>(null);
  const [currentUser, setCurrentUser] = useState<string | null>(null);
  const [name, setName] = useState('');
  const [isSubmitting, setIsSubmitting] = useState(false);
  const [error, setError] = useState('');
  const [loading, setLoading] = useState(true);

  const maxPlayers = parseInt(process.env.NEXT_PUBLIC_MAX_PLAYERS ?? '12');

  const loadData = useCallback(async () => {
    setLoading(true);
    try {
      const [sRes, pRes, aRes] = await Promise.all([
        fetch(`${BASE}/api/session`, { cache: 'no-store' }),
        fetch(`${BASE}/api/players`, { cache: 'no-store' }),
        fetch(`${BASE}/api/announcements`, { cache: 'no-store' }),
      ]);
      if (sRes.ok) setSession(await sRes.json());
      if (pRes.ok) setPlayers(await pRes.json());
      if (aRes.ok) {
        const list: Announcement[] = await aRes.json();
        setAnnouncement(list.length > 0 ? list[0] : null);
      }
    } catch (e) {
      console.error('Load error:', e);
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    const stored = localStorage.getItem(STORAGE_KEY);
    if (stored) setCurrentUser(stored);
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
  const spotsTotal = session?.maxPlayers ?? maxPlayers;
  const isDeadlinePast = session ? new Date() > new Date(session.deadline) : false;
  const isSessionFinished = session?.endDatetime ? new Date() > new Date(session.endDatetime) : false;

  const waitlistPosition = isWaitlisted && currentUser
    ? waitlistPlayers.findIndex(p => p.name.toLowerCase() === currentUser.toLowerCase()) + 1
    : 0;

  async function handleSignUp(e: React.FormEvent) {
    e.preventDefault();
    if (!name.trim()) return;
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
        localStorage.setItem(STORAGE_KEY, name.trim());
        if (data.deleteToken) localStorage.setItem(STORAGE_KEY_TOKEN, data.deleteToken);
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
    if (!name.trim()) return;
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
        localStorage.setItem(STORAGE_KEY, name.trim());
        if (data.deleteToken) localStorage.setItem(STORAGE_KEY_TOKEN, data.deleteToken);
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
    return (
      <div className="flex items-center justify-center h-48" role="status" aria-label="Loading">
        <span className="material-icons icon-spin-lg animate-spin text-green-400" aria-hidden="true">refresh</span>
      </div>
    );
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
          <h1 className="text-2xl font-bold text-white">BPM Badminton</h1>
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
          <span className="material-icons icon-pin-lg shrink-0 text-blue-400">calendar_today</span>
          <span className="text-base font-semibold text-white">
            {session ? fmtDate(session.datetime) : '—'}
          </span>
        </div>
        <div className="flex items-center gap-3">
          <span className="material-icons icon-pin-lg shrink-0 text-violet-400">schedule</span>
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
            <p className="text-xl font-bold text-white">Sign up</p>
            <div className="status-banner-green">
              <span className="material-icons icon-status text-green-400">celebration</span>
              <div>
                <p className="font-semibold text-green-400 text-sm">Thanks for coming!</p>
                <p className="text-xs text-gray-400 mt-0.5">Sign up for next week will be announced soon.</p>
              </div>
            </div>
          </div>
        ) : isDeadlinePast && !isSignedUp && !isWaitlisted ? (
          /* ── State: Deadline passed ── */
          <div className="space-y-4">
            <p className="text-xl font-bold text-white">Sign up</p>
            <div className="status-banner-orange">
              <span className="material-icons icon-status text-amber-400">lock_clock</span>
              <div>
                <p className="font-semibold text-amber-300 text-sm">Sign-ups closed</p>
                <p className="text-xs text-gray-400 mt-0.5">Deadline passed {fmtDeadline(session!.deadline)}</p>
              </div>
            </div>
          </div>
        ) : isSignedUp ? (
          /* ── State 1: Active sign-up ── */
          <div className="space-y-4">
            <div className="flex items-start justify-between">
              <p className="text-xl font-bold text-white">Sign up</p>
              <div className="text-right">
                <p className="text-xs text-gray-400">Spots left</p>
                <p className="text-2xl font-bold text-white leading-none mt-0.5">
                  {activePlayers.length}/{spotsTotal}
                </p>
              </div>
            </div>
            <div className="status-banner-green">
              <span className="material-icons icon-status text-green-400">check_circle</span>
              <div>
                <p className="font-semibold text-green-400 text-sm">You&apos;re in!</p>
                <p className="text-xs text-gray-400 mt-0.5">Signed up as {currentUser}</p>
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
              <p className="text-xl font-bold text-white">Sign up</p>
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
                <p className="text-xs text-gray-400 mt-0.5">Position #{waitlistPosition} · Signed up as {currentUser}</p>
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
              <p className="text-xl font-bold text-white">Sign up</p>
              <div className="text-right">
                <p className="text-xs text-gray-400">Spots left</p>
                <p className="text-2xl font-bold text-orange-400 leading-none mt-0.5">
                  {activePlayers.length}/{spotsTotal}
                </p>
              </div>
            </div>
            <div className="status-banner-orange">
              <span className="material-icons icon-status text-orange-400">lock</span>
              <div>
                <p className="font-semibold text-orange-300 text-sm">Session Full</p>
                <p className="text-xs text-gray-400 mt-0.5">All {spotsTotal} spots are taken.</p>
              </div>
            </div>
            <form onSubmit={handleJoinWaitlist} className="space-y-3">
              <input
                type="text"
                placeholder="Who is playing?"
                aria-label="Your name"
                aria-describedby={error ? 'signup-error' : undefined}
                value={name}
                onChange={(e) => setName(e.target.value)}
                required
                maxLength={50}
              />
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
              <p className="text-xl font-bold text-white">Sign up</p>
              <div className="text-right">
                <p className="text-xs text-gray-400">Spots left</p>
                <p className="text-2xl font-bold text-white leading-none mt-0.5">
                  {activePlayers.length}/{spotsTotal}
                </p>
              </div>
            </div>
            <form onSubmit={handleSignUp} className="space-y-3">
              <input
                type="text"
                placeholder="Who is playing?"
                aria-label="Your name"
                aria-describedby={error ? 'signup-error' : undefined}
                value={name}
                onChange={(e) => setName(e.target.value)}
                required
                maxLength={50}
              />
              {error && <p id="signup-error" role="alert" className="text-red-400 text-xs">{error}</p>}
              <button type="submit" disabled={isSubmitting} className="btn-primary w-full">
                {isSubmitting ? 'Signing up…' : 'Sign Up'}
              </button>
              {session?.deadline && (
                <div className="flex items-center justify-center gap-1.5 text-xs font-medium text-amber-400">
                  <span className="material-icons icon-xs" aria-hidden="true">schedule</span>
                  <span>Closes {fmtDeadline(session.deadline)}</span>
                </div>
              )}
            </form>
          </div>
        )}
      </div>
    </div>
  );
}
