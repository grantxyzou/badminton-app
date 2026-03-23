'use client';

import { useState, useEffect, useCallback } from 'react';
import type { Session, Announcement, Player } from '@/lib/types';

const STORAGE_KEY = 'badminton_username';
const BASE = process.env.NEXT_PUBLIC_BASE_PATH ?? '';

function fmtDateTime(iso: string) {
  if (!iso) return '—';
  try {
    return new Date(iso).toLocaleString(undefined, {
      weekday: 'short',
      month: 'short',
      day: 'numeric',
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

const ICON_COLORS: Record<string, string> = {
  location_on: '#ef4444',
  event: '#60a5fa',
  sports_tennis: '#a78bfa',
  payments: '#4ade80',
};

function InfoRow({ icon, text }: { icon: string; text: string }) {
  return (
    <div className="flex items-start gap-2.5 text-sm">
      <span className="material-icons icon-pin shrink-0" style={{ color: ICON_COLORS[icon] ?? 'inherit' }}>{icon}</span>
      <span className="text-gray-300 leading-snug">{text}</span>
    </div>
  );
}

export default function HomeTab() {
  const [session, setSession] = useState<Session | null>(null);
  const [players, setPlayers] = useState<Player[]>([]);
  const [announcements, setAnnouncements] = useState<Announcement[]>([]);
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
        fetch(`${BASE}/api/session`),
        fetch(`${BASE}/api/players`),
        fetch(`${BASE}/api/announcements`),
      ]);
      if (sRes.ok) setSession(await sRes.json());
      if (pRes.ok) setPlayers(await pRes.json());
      if (aRes.ok) setAnnouncements(await aRes.json());
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

  const isSignedUp = currentUser
    ? players.some((p) => p.name.toLowerCase() === currentUser.toLowerCase())
    : false;

  const isFull = players.length >= (session?.maxPlayers ?? maxPlayers);
  const spotsTotal = session?.maxPlayers ?? maxPlayers;

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
      } else {
        localStorage.setItem(STORAGE_KEY, name.trim());
        setCurrentUser(name.trim());
        await loadData();
      }
    } catch {
      setError('Network error. Please try again.');
    } finally {
      setIsSubmitting(false);
    }
  }

  async function handleCancel() {
    if (!currentUser) return;
    setIsSubmitting(true);
    setError('');
    try {
      const res = await fetch(`${BASE}/api/players`, {
        method: 'DELETE',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ name: currentUser }),
      });
      if (res.ok) {
        localStorage.removeItem(STORAGE_KEY);
        setCurrentUser(null);
        setName('');
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
      <div className="flex items-center justify-center h-48">
        <span className="material-icons icon-spin-lg animate-spin text-green-400">refresh</span>
      </div>
    );
  }

  return (
    <div className="space-y-5">
      {/* Page title */}
      <h1 className="text-2xl font-bold text-white">Announcement</h1>

      {/* Hero card: date/time + courts */}
      <div className="glass-card p-5 space-y-3">
        <div className="flex items-center gap-3">
          <span className="material-icons icon-pin-lg shrink-0" style={{ color: '#60a5fa' }}>event</span>
          <span className="text-xl font-bold text-white leading-tight">
            {session ? fmtDateTime(session.datetime) : '—'}
          </span>
        </div>
        <div className="flex items-center gap-3">
          <span className="material-icons icon-pin-lg shrink-0" style={{ color: '#a78bfa' }}>sports_tennis</span>
          <span className="text-xl font-bold text-white">
            {session?.courts ?? '—'} Court{(session?.courts ?? 0) !== 1 ? 's' : ''}
          </span>
        </div>
      </div>

      {/* Two-column: Event info | Cost info */}
      <div className="grid grid-cols-2 gap-3 items-start">
        <div>
          <p className="text-sm font-semibold text-white mb-2">Event info</p>
          <div className="glass-card p-4 space-y-2.5">
            <InfoRow icon="location_on" text={session?.location ?? '—'} />
            <InfoRow icon="event" text={session ? fmtDateTime(session.datetime) : '—'} />
            <InfoRow icon="sports_tennis" text={`${session?.courts ?? '—'} Court${(session?.courts ?? 0) !== 1 ? 's' : ''}`} />
          </div>
        </div>
        <div>
          <p className="text-sm font-semibold text-white mb-2">Cost info</p>
          <div className="glass-card p-4">
            <InfoRow icon="payments" text={session?.cost ?? 'TBD'} />
          </div>
        </div>
      </div>

      {/* Announcements */}
      {announcements.length > 0 && (
        <div className="glass-card p-5">
          <h2 className="text-xs font-bold tracking-widest text-green-400 mb-3 flex items-center gap-1.5">
            <span className="material-icons icon-sm">campaign</span>
            ANNOUNCEMENTS
          </h2>
          <div className="space-y-3">
            {announcements.map((a) => (
              <div key={a.id} className="border-l-2 border-green-400/30 pl-3">
                <p className="text-sm text-gray-200 break-words">{a.text}</p>
                <p className="text-xs text-gray-500 mt-0.5">
                  {new Date(a.time).toLocaleDateString(undefined, {
                    month: 'short',
                    day: 'numeric',
                  })}
                </p>
              </div>
            ))}
          </div>
        </div>
      )}

      {/* Sign-Up Card */}
      <div className="glass-card p-5">
        {isSignedUp ? (
          <div className="space-y-4">
            <div className="flex items-start justify-between">
              <p className="text-xl font-bold text-white">Sign up</p>
              <div className="text-right">
                <p className="text-xs text-gray-400">Spots left</p>
                <p className="text-2xl font-bold text-white leading-none mt-0.5">
                  {players.length}/{spotsTotal}
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
            {error && <p className="text-red-400 text-xs">{error}</p>}
            <button type="button" onClick={handleCancel} disabled={isSubmitting} className="btn-ghost w-full">
              {isSubmitting ? 'Cancelling…' : 'Cancel My Spot'}
            </button>
          </div>
        ) : isFull ? (
          <div className="space-y-4">
            <div className="flex items-start justify-between">
              <p className="text-xl font-bold text-white">Sign up</p>
              <div className="text-right">
                <p className="text-xs text-gray-400">Spots left</p>
                <p className="text-2xl font-bold text-orange-400 leading-none mt-0.5">
                  {players.length}/{spotsTotal}
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
          </div>
        ) : (
          <div className="space-y-4">
            <div className="flex items-start justify-between">
              <p className="text-xl font-bold text-white">Sign up</p>
              <div className="text-right">
                <p className="text-xs text-gray-400">Spots left</p>
                <p className="text-2xl font-bold text-white leading-none mt-0.5">
                  {players.length}/{spotsTotal}
                </p>
              </div>
            </div>
            <form onSubmit={handleSignUp} className="space-y-3">
              <input
                type="text"
                placeholder="Who is playing?"
                value={name}
                onChange={(e) => setName(e.target.value)}
                required
                maxLength={50}
              />
              {error && <p className="text-red-400 text-xs">{error}</p>}
              {session?.deadline && (
                <p className="text-center text-xs text-gray-400">
                  Sign up by {fmtDeadline(session.deadline)}
                </p>
              )}
              <button type="submit" disabled={isSubmitting} className="btn-primary w-full">
                {isSubmitting ? 'Signing up…' : 'Sign Up'}
              </button>
            </form>
          </div>
        )}
      </div>
    </div>
  );
}
