'use client';

import { useState, useEffect } from 'react';

const BASE = process.env.NEXT_PUBLIC_BASE_PATH ?? '';
import { getIdentity } from '@/lib/identity';
import ShuttleLoader from './ShuttleLoader';
import AdminDashboard from './admin/AdminDashboard';

/* ─────────────────────────── PIN Gate ─────────────────────────── */

export default function AdminTab() {
  const [isAuthed, setIsAuthed] = useState<boolean | null>(null); // null = loading
  const [pin, setPin] = useState('');
  const [pinError, setPinError] = useState('');
  const [checking, setChecking] = useState(false);

  useEffect(() => {
    const minDelay = new Promise(r => setTimeout(r, 1500));
    Promise.all([
      fetch(`${BASE}/api/admin`).then(r => r.json()).catch(() => ({ authed: false })),
      minDelay,
    ]).then(([d]) => setIsAuthed(d.authed === true))
      .catch(() => setIsAuthed(false));
  }, []);

  async function handlePinSubmit(e: React.FormEvent) {
    e.preventDefault();
    setChecking(true);
    setPinError('');
    try {
      const res = await fetch(`${BASE}/api/admin`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ pin, name: getIdentity()?.name ?? '' }),
      });
      if (res.ok) {
        setIsAuthed(true);
      } else {
        setPinError(res.status === 429
          ? 'Too many attempts. Try again in 15 minutes.'
          : 'Incorrect PIN. Please try again.');
        setPin('');
      }
    } catch {
      setPinError('Network error.');
    } finally {
      setChecking(false);
    }
  }

  async function handleLogout() {
    await fetch(`${BASE}/api/admin`, { method: 'DELETE' });
    setIsAuthed(false);
    setPin('');
  }

  if (isAuthed === null) {
    return <ShuttleLoader />;
  }

  if (!isAuthed) {
    return (
      <div className="flex items-center justify-center min-h-[60vh]">
        <div className="glass-card p-6 w-full max-w-xs space-y-5">
          <div className="text-center">
            <span className="material-icons icon-xl text-green-400">lock</span>
            <h2 className="text-lg font-bold text-green-400 mt-2">Admin Access</h2>
            <p className="text-sm text-gray-400 mt-0.5">Enter your PIN to continue</p>
          </div>
          <form onSubmit={handlePinSubmit} className="space-y-3">
            <input
              id="admin-pin"
              name="pin"
              type="password"
              placeholder="PIN"
              aria-label="Admin PIN"
              aria-describedby={pinError ? 'pin-error' : undefined}
              value={pin}
              onChange={(e) => setPin(e.target.value)}
              maxLength={10}
              inputMode="numeric"
              autoFocus
            />
            {pinError && <p id="pin-error" role="alert" className="text-xs text-red-400">{pinError}</p>}
            <button
              type="submit"
              disabled={checking || !pin}
              className="btn-primary w-full"
            >
              {checking ? 'Checking\u2026' : 'Enter'}
            </button>
          </form>
        </div>
      </div>
    );
  }

  return <AdminPanel onLogout={handleLogout} />;
}

/* ─────────────────────────── Admin Panel ─────────────────────────── */

function AdminPanel({ onLogout }: { onLogout: () => void }) {
  return <AdminDashboard onLogout={onLogout} />;
}
