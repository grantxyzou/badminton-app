'use client';

import { useState } from 'react';
import { useTranslations } from 'next-intl';
import { getIdentity } from '@/lib/identity';
import PinInput from '@/components/PinInput';

const BASE = process.env.NEXT_PUBLIC_BASE_PATH ?? '';

/**
 * The admin sign-in: your name and your own PIN (`POST /api/admin`), which
 * mints the `admin_session` cookie every admin route checks.
 *
 * One card, two places (2026-11-06). The Admin tab showed it; the Stringing
 * bench did not. An admin whose admin cookie had lapsed while their member
 * cookie lived on still READ as an admin to the shell (their role says so), so
 * the bench opened and every read and save behind it was refused: the job list
 * said "Try again", the player search found nobody, and "Save job" never
 * turned on (Grant: "the add a job stringing job save button does not work").
 * Now both screens put this card in front of the work instead.
 */
export default function AdminSignInCard({ onSignedIn, help }: {
  onSignedIn: () => void;
  /** The line under the lock; the Admin tab's own by default. */
  help?: string;
}) {
  const pageT = useTranslations('pages.admin');
  /* Guarded: `getIdentity()` reads localStorage, which the server lacks. */
  const [name, setName] = useState(() =>
    typeof window === 'undefined' ? '' : (getIdentity()?.name ?? ''),
  );
  const [pin, setPin] = useState('');
  const [error, setError] = useState('');
  const [checking, setChecking] = useState(false);

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
        onSignedIn();
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

  return (
    <div className="glass-card p-5 w-full max-w-xs space-y-5">
      <div className="text-center">
        <span className="material-icons icon-xl text-green-400">lock</span>
        <p className="fs-md text-gray-400 mt-2">{help ?? pageT('signInHelp')}</p>
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
  );
}
