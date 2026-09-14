'use client';

import { useState, useEffect } from 'react';
import { useTranslations } from 'next-intl';

const BASE = process.env.NEXT_PUBLIC_BASE_PATH ?? '';
import { getIdentity } from '@/lib/identity';
import { AdminTabSkeleton } from './primitives/CardSkeleton';
import AdminDashboard from './admin/AdminDashboard';
import PinInput from './PinInput';
import PageHeader from './primitives/PageHeader';
import ErrorState from './primitives/ErrorState';

/* ─────────────────────────── Admin login ───────────────────────────
   Per PR B: admin auth is now per-player. Sign in with your name + your
   own PIN (the same one you use as a player). The shared ADMIN_PIN env
   var is retired. Admin powers come from `member.role === 'admin'` on
   the matched record. */

export default function AdminTab({ onExit }: { onExit: () => void }) {
  const pageT = useTranslations('pages.admin');
  const [isAuthed, setIsAuthed] = useState<boolean | null>(null); // null = loading
  /* Guarded, matching HomeTab's initializer. `getIdentity()` reads
     localStorage, which does not exist on the server. This is safe today only
     because routing never server-renders AdminTab — an accident of
     `showAdmin` starting false, not a property of this file. */
  const [name, setName] = useState(() =>
    typeof window === 'undefined' ? '' : (getIdentity()?.name ?? ''),
  );
  const [pin, setPin] = useState('');
  const [error, setError] = useState('');
  const [checking, setChecking] = useState(false);
  /* Unknown is not "signed out". A thrown or 5xx check used to fall through to
     `{ authed: false }` and put a signed-in admin in front of the PIN form, as
     if their session had ended. `GET /api/admin` answers a real refusal with a
     200 `{ authed: false }`, so `res.ok` is the discriminator. */
  const [checkFailed, setCheckFailed] = useState(false);
  const [checkAttempt, setCheckAttempt] = useState(0);

  useEffect(() => {
    let cancelled = false;
    fetch(`${BASE}/api/admin`)
      .then(async (r) => {
        if (r.status === 401 || r.status === 403) {
          if (!cancelled) setIsAuthed(false);
          return;
        }
        if (!r.ok) throw new Error(`admin check ${r.status}`);
        const d = (await r.json()) as { authed?: boolean };
        if (!cancelled) setIsAuthed(d.authed === true);
      })
      .catch(() => {
        if (!cancelled) setCheckFailed(true);
      });
    return () => {
      cancelled = true;
    };
  }, [checkAttempt]);

  function retryCheck() {
    setCheckFailed(false);
    setIsAuthed(null);
    setCheckAttempt((n) => n + 1);
  }

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

  if (checkFailed) {
    return (
      <div className="space-y-5">
        <PageHeader>{pageT('title')}</PageHeader>
        <div className="flex items-center justify-center min-h-[50vh]">
          <ErrorState
            message={pageT('checkError')}
            action={
              <button type="button" className="cc-btn cc-btn-ghost" onClick={retryCheck}>
                {pageT('retry')}
              </button>
            }
          />
        </div>
      </div>
    );
  }

  if (isAuthed === null) {
    return (
      <div className="space-y-5">
        <PageHeader>{pageT('title')}</PageHeader>
        <AdminTabSkeleton />
      </div>
    );
  }

  if (!isAuthed) {
    return (
      <div className="space-y-5">
        <PageHeader>{pageT('title')}</PageHeader>
        <div className="flex items-center justify-center min-h-[50vh]">
          <div className="glass-card p-5 w-full max-w-xs space-y-5">
            <div className="text-center">
              <span className="material-icons icon-xl text-green-400">lock</span>
              <p className="fs-md text-gray-400 mt-2">{pageT('signInHelp')}</p>
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
              {error && <p id="admin-error" role="alert" className="field-error">{error}</p>}
              <button
                type="submit"
                disabled={checking || !name.trim() || pin.length !== 4}
                className="cc-btn cc-btn-primary cc-btn-lg"
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
  return <AdminDashboard onExit={onExit} />;
}
