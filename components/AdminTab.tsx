'use client';

import { useState, useEffect } from 'react';
import { useTranslations } from 'next-intl';

const BASE = process.env.NEXT_PUBLIC_BASE_PATH ?? '';
import { getIdentity } from '@/lib/identity';
import ShuttleLoader from './ShuttleLoader';
import AdminDashboard from './admin/AdminDashboard';

/* ─────────────────────────── PIN Gate ─────────────────────────── */

export default function AdminTab() {
  const pageT = useTranslations('pages.admin');
  const [isAuthed, setIsAuthed] = useState<boolean | null>(null); // null = loading
  const [pin, setPin] = useState('');
  const [pinError, setPinError] = useState('');
  const [checking, setChecking] = useState(false);

  useEffect(() => {
    fetch(`${BASE}/api/admin`).then(r => r.json()).catch(() => ({ authed: false }))
      .then((d) => setIsAuthed(d.authed === true))
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
    return (
      <div className="space-y-5">
        <h1 className="text-3xl font-bold text-gray-200 leading-tight px-2">
          {pageT('title')}
        </h1>
        <ShuttleLoader />
      </div>
    );
  }

  if (!isAuthed) {
    return (
      <div className="space-y-5">
        <h1 className="text-3xl font-bold text-gray-200 leading-tight px-2">
          {pageT('title')}
        </h1>
        <div className="flex items-center justify-center min-h-[50vh]">
          <div className="glass-card p-6 w-full max-w-xs space-y-5">
            <div className="text-center">
              <span className="material-icons icon-xl text-green-400">lock</span>
              <p className="text-sm text-gray-400 mt-2">Enter your PIN to continue</p>
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
      </div>
    );
  }

  return (
    <div className="space-y-5">
      <h1 className="text-3xl font-bold text-gray-200 leading-tight px-2">
        {pageT('title')}
      </h1>
      <AdminPanel onLogout={handleLogout} />
    </div>
  );
}

/* ─────────────────────────── Admin Panel ─────────────────────────── */

function AdminPanel({ onLogout }: { onLogout: () => void }) {
  return <AdminDashboard onLogout={onLogout} />;
}
