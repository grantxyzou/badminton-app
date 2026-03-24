'use client';

import { useState, useEffect, useCallback } from 'react';
import type { Session, Player } from '@/lib/types';

const STORAGE_KEY = 'badminton_username';
const BASE = process.env.NEXT_PUBLIC_BASE_PATH ?? '';

function fmtDate(iso: string) {
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


export default function HomeTab() {
  const [session, setSession] = useState<Session | null>(null);
  const [players, setPlayers] = useState<Player[]>([]);
  const [currentUser, setCurrentUser] = useState<string | null>(null);
  const [name, setName] = useState('');
  const [isSubmitting, setIsSubmitting] = useState(false);
  const [error, setError] = useState('');
  const [loading, setLoading] = useState(true);

  const maxPlayers = parseInt(process.env.NEXT_PUBLIC_MAX_PLAYERS ?? '12');

  const loadData = useCallback(async () => {
    setLoading(true);
    try {
      const [sRes, pRes] = await Promise.all([
        fetch(`${BASE}/api/session`),
        fetch(`${BASE}/api/players`),
      ]);
      if (sRes.ok) setSession(await sRes.json());
      if (pRes.ok) setPlayers(await pRes.json());
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

  const mapsUrl = session?.locationAddress
    ? `https://maps.google.com/?q=${encodeURIComponent(session.locationAddress)}`
    : null;

  return (
    <div className="space-y-5">
      {/* BPM Badminton header card */}
      <div className="glass-card p-5">
        <p className="text-xs font-bold tracking-widest text-green-400 mb-1">WELCOME TO</p>
        <h1 className="text-2xl font-bold text-white">BPM Badminton</h1>
      </div>

      {/* Location card */}
      <div className="glass-card p-5 space-y-1.5">
        <p className="text-xs font-bold tracking-widest text-green-400 mb-2">LOCATION</p>
        {session?.locationName ? (
          <p className="text-base font-semibold text-white">{session.locationName}</p>
        ) : null}
        {session?.locationAddress ? (
          mapsUrl ? (
            <a
              href={mapsUrl}
              target="_blank"
              rel="noopener noreferrer"
              className="text-sm text-blue-400 underline underline-offset-2 break-words"
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

      {/* Date & Time card */}
      <div className="glass-card p-5 space-y-3">
        <p className="text-xs font-bold tracking-widest text-green-400">DATE & TIME</p>
        <div className="flex items-center gap-3">
          <span className="material-icons icon-pin-lg shrink-0" style={{ color: '#60a5fa' }}>calendar_today</span>
          <span className="text-base font-semibold text-white">
            {session ? fmtDate(session.datetime) : '—'}
          </span>
        </div>
        <div className="flex items-center gap-3">
          <span className="material-icons icon-pin-lg shrink-0" style={{ color: '#a78bfa' }}>schedule</span>
          <span className="text-base font-semibold text-white">
            {session ? fmtTime(session.datetime) : '—'}
          </span>
        </div>
      </div>

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
              <button type="submit" disabled={isSubmitting} className="btn-primary w-full">
                {isSubmitting ? 'Signing up…' : 'Sign Up'}
              </button>
              {session?.deadline && (
                <p className="text-center text-xs text-gray-400">
                  Sign up by {fmtDeadline(session.deadline)}
                </p>
              )}
            </form>
          </div>
        )}
      </div>
    </div>
  );
}
