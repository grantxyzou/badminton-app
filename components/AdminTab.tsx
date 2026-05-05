'use client';

import { useState, useEffect } from 'react';
import { useTranslations } from 'next-intl';

const BASE = process.env.NEXT_PUBLIC_BASE_PATH ?? '';
import { getIdentity } from '@/lib/identity';
import ShuttleLoader from './ShuttleLoader';
import AdminDashboard from './admin/AdminDashboard';
import PinInput from './PinInput';
import PageHeader from './primitives/PageHeader';

/* ─────────────────────────── Admin login ───────────────────────────
   Per PR B: admin auth is now per-player. Sign in with your name + your
   own PIN (the same one you use as a player). The shared ADMIN_PIN env
   var is retired. Admin powers come from `member.role === 'admin'` on
   the matched record. */

export default function AdminTab() {
  const pageT = useTranslations('pages.admin');
  const [isAuthed, setIsAuthed] = useState<boolean | null>(null); // null = loading
  const [name, setName] = useState(() => getIdentity()?.name ?? '');
  const [pin, setPin] = useState('');
  const [error, setError] = useState('');
  const [checking, setChecking] = useState(false);

  useEffect(() => {
    fetch(`${BASE}/api/admin`).then(r => r.json()).catch(() => ({ authed: false }))
      .then((d) => setIsAuthed(d.authed === true))
      .catch(() => setIsAuthed(false));
  }, []);

  async function handleSubmit(e: React.FormEvent) {
    e.preventDefault();
    setChecking(true);
    setError('');
    try {
      const res = await fetch(`${BASE}/api/admin`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ name: name.trim(), pin }),
      });
      if (res.ok) {
        setIsAuthed(true);
      } else if (res.status === 429) {
        setError(pageT('signInErrorRateLimited'));
      } else {
        setError(pageT('signInErrorInvalid'));
        setPin('');
      }
    } catch {
      setError(pageT('signInErrorNetwork'));
    } finally {
      setChecking(false);
    }
  }

  if (isAuthed === null) {
    return (
      <div className="space-y-5">
        <PageHeader>{pageT('title')}</PageHeader>
        <ShuttleLoader />
      </div>
    );
  }

  if (!isAuthed) {
    return (
      <div className="space-y-5">
        <PageHeader>{pageT('title')}</PageHeader>
        <div className="flex items-center justify-center min-h-[50vh]">
          <div className="glass-card p-6 w-full max-w-xs space-y-5">
            <div className="text-center">
              <span className="material-icons icon-xl text-green-400">lock</span>
              <p className="text-sm text-gray-400 mt-2">{pageT('signInHelp')}</p>
            </div>
            <form onSubmit={handleSubmit} className="space-y-3">
              <div>
                <label htmlFor="admin-name" className="sr-only">{pageT('nameLabel')}</label>
                <input
                  id="admin-name"
                  name="name"
                  type="text"
                  placeholder={pageT('namePlaceholder')}
                  aria-label={pageT('nameLabel')}
                  value={name}
                  onChange={(e) => setName(e.target.value)}
                  maxLength={50}
                  autoComplete="nickname"
                  autoFocus={!name}
                />
              </div>
              <PinInput
                value={pin}
                onChange={setPin}
                digits={4}
                label={pageT('pinLabel')}
                ariaInvalid={!!error}
                autoFocus={!!name}
              />
              {error && <p id="admin-error" role="alert" className="text-xs text-red-400">{error}</p>}
              <button
                type="submit"
                disabled={checking || !name.trim() || pin.length !== 4}
                className="btn-primary w-full"
              >
                {checking ? pageT('signInChecking') : pageT('signInButton')}
              </button>
            </form>
          </div>
        </div>
      </div>
    );
  }

  // Dashboard renders its own h1 when on the dashboard view so the header
  // disappears when the user drills into a sub-editor (Session Details,
  // Members, etc.) — those render AdminBackHeader instead.
  return <AdminDashboard />;
}
