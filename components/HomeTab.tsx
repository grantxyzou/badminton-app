'use client';

import { useState, useEffect, useCallback } from 'react';
import type { Session, Player, Announcement } from '@/lib/types';

const STORAGE_KEY = 'badminton_username';

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

function InfoRow({ icon, text }: { icon: string; text: string }) {
  return (
    <div className="flex items-center gap-2.5 text-sm">
      <span className="material-icons text-green-400" style={{ fontSize: 18 }}>
        {icon}
      </span>
      <span className="text-gray-300">{text}</span>
    </div>
  );
}

export default function HomeTab() {
  const [session, setSession] = useState<Session | null>(null);
  const [players, setPlayers] = useState<Player[]>([]);
  const [announcements, setAnnouncements] = useState<Announcement[]>([]);
  const [currentUser, setCurrentUser] = useState<string | null>(null);
  const [name, setName] = useState('');
  const [skill, setSkill] = useState<Player['skill']>('Intermediate');
  const [isSubmitting, setIsSubmitting] = useState(false);
  const [error, setError] = useState('');
  const [loading, setLoading] = useState(true);

  const maxPlayers = parseInt(process.env.NEXT_PUBLIC_MAX_PLAYERS ?? '12');

  const loadData = useCallback(async () => {
    setLoading(true);
    try {
      const [sRes, pRes, aRes] = await Promise.all([
        fetch('/api/session'),
        fetch('/api/players'),
        fetch('/api/announcements'),
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

  async function handleSignUp(e: React.FormEvent) {
    e.preventDefault();
    if (!name.trim()) return;
    setIsSubmitting(true);
    setError('');
    try {
      const res = await fetch('/api/players', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ name: name.trim(), skill }),
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
      const res = await fetch('/api/players', {
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
        <span className="material-icons animate-spin text-green-400" style={{ fontSize: 32 }}>
          refresh
        </span>
      </div>
    );
  }

  return (
    <div className="space-y-4">
      {/* Session Info Card */}
      <div className="glass-card p-5">
        <h1 className="text-base font-bold text-green-400 mb-4">
          {session?.title ?? 'Weekly Badminton Session'}
        </h1>
        <div className="space-y-2.5">
          <InfoRow icon="location_on" text={session?.location ?? '—'} />
          <InfoRow icon="event" text={session ? fmtDateTime(session.datetime) : '—'} />
          <InfoRow icon="attach_money" text={session?.cost ?? '—'} />
          <InfoRow
            icon="sports_tennis"
            text={`${session?.courts ?? '—'} court${(session?.courts ?? 0) !== 1 ? 's' : ''}`}
          />
          <InfoRow
            icon="people"
            text={`${players.length} / ${session?.maxPlayers ?? maxPlayers} signed up`}
          />
        </div>
        {session?.deadline && (
          <p className="mt-3 text-xs text-gray-500">
            Sign up by {fmtDeadline(session.deadline)}
          </p>
        )}
      </div>

      {/* Announcements */}
      {announcements.length > 0 && (
        <div className="glass-card p-5">
          <h2 className="text-xs font-bold tracking-widest text-green-400 mb-3 flex items-center gap-1.5">
            <span className="material-icons" style={{ fontSize: 16 }}>campaign</span>
            ANNOUNCEMENTS
          </h2>
          <div className="space-y-3">
            {announcements.map((a) => (
              <div key={a.id} className="border-l-2 border-green-400/30 pl-3">
                <p className="text-sm text-gray-200">{a.text}</p>
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
          <div className="text-center space-y-3">
            <div
              className="w-12 h-12 rounded-full flex items-center justify-center mx-auto"
              style={{ background: 'rgba(74, 222, 128, 0.15)' }}
            >
              <span className="material-icons text-green-400" style={{ fontSize: 28 }}>
                check_circle
              </span>
            </div>
            <div>
              <p className="font-semibold text-green-400">You&apos;re in!</p>
              <p className="text-sm text-gray-400 mt-0.5">Signed up as {currentUser}</p>
            </div>
            {error && <p className="text-red-400 text-xs">{error}</p>}
            <button
              onClick={handleCancel}
              disabled={isSubmitting}
              className="btn-ghost w-full"
            >
              {isSubmitting ? 'Cancelling…' : 'Cancel My Spot'}
            </button>
          </div>
        ) : isFull ? (
          <div className="text-center space-y-2 py-2">
            <span className="material-icons text-orange-400" style={{ fontSize: 36 }}>lock</span>
            <p className="font-semibold text-orange-300">Session Full</p>
            <p className="text-sm text-gray-400">
              All {session?.maxPlayers ?? maxPlayers} spots are taken.
            </p>
          </div>
        ) : (
          <form onSubmit={handleSignUp} className="space-y-3">
            <h2 className="text-xs font-bold tracking-widest text-green-400">SIGN UP</h2>
            <input
              type="text"
              placeholder="Your name"
              value={name}
              onChange={(e) => setName(e.target.value)}
              required
              maxLength={50}
            />
            <select
              value={skill}
              onChange={(e) => setSkill(e.target.value as Player['skill'])}
            >
              <option value="Beginner">Beginner</option>
              <option value="Intermediate">Intermediate</option>
              <option value="Advanced">Advanced</option>
            </select>
            {error && <p className="text-red-400 text-xs">{error}</p>}
            <button type="submit" disabled={isSubmitting} className="btn-primary w-full">
              {isSubmitting ? 'Signing up…' : 'Sign Up'}
            </button>
          </form>
        )}
      </div>
    </div>
  );
}
