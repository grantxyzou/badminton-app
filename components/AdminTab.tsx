'use client';

import { usePageBack } from '@/lib/pageStack';
import { useState, useEffect } from 'react';
import { useTranslations } from 'next-intl';

const BASE = process.env.NEXT_PUBLIC_BASE_PATH ?? '';
import { AdminTabSkeleton } from './primitives/CardSkeleton';
import AdminDashboard from './admin/AdminDashboard';
import AdminSignInCard from './admin/AdminSignInCard';
import TopBar from './primitives/TopBar';
import ErrorState from './primitives/ErrorState';
import { isRefused } from '@/lib/apiFetch';

/* ─────────────────────────── Admin login ───────────────────────────
   Per PR B: admin auth is now per-player. Sign in with your name + your
   own PIN (the same one you use as a player). The shared ADMIN_PIN env
   var is retired. Admin powers come from `member.role === 'admin'` on
   the matched record. */

export default function AdminTab({ onExit, knownAuthed = false, onSignedIn }: {
  onExit: () => void;
  /** A PIN sign-in here minted the admin cookie: the shell re-checks, so the
   *  Stringing bench (which reads the shell's verdict) opens without a second
   *  sign-in. */
  onSignedIn?: () => void;
  /** The shell's own `GET /api/admin` already said yes. The console then
   *  renders at once and this tab's check runs behind it, instead of every
   *  console read waiting on a second answer to the same question
   *  (2026-10-25). A refusal still swaps in the PIN form; the server checks
   *  every admin read regardless. */
  knownAuthed?: boolean;
}) {
  const pageT = useTranslations('pages.admin');
  // Admin is opened from Profile, and its own back arrow returns there; the
  // Android back button does the same rather than jumping Home. A page open
  // inside admin sits above this one (lib/pageStack.ts).
  usePageBack(true, onExit, -1);
  const [isAuthed, setIsAuthed] = useState<boolean | null>(knownAuthed ? true : null); // null = loading
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
        if (isRefused(r)) {
          if (!cancelled) setIsAuthed(false);
          return;
        }
        if (!r.ok) throw new Error(`admin check ${r.status}`);
        const d = (await r.json()) as { authed?: boolean };
        if (!cancelled) setIsAuthed(d.authed === true);
      })
      .catch(() => {
        // A console already on screen stays: its own reads report their own
        // failures. Only a check nothing else stands behind shows the error.
        if (!cancelled && !knownAuthed) setCheckFailed(true);
      });
    return () => {
      cancelled = true;
    };
    // `knownAuthed` seeds the first render only; a later change does not re-check.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [checkAttempt]);

  function retryCheck() {
    setCheckFailed(false);
    setIsAuthed(null);
    setCheckAttempt((n) => n + 1);
  }

  if (checkFailed) {
    return (
      <div className="space-y-5">
        {/* The console's own bar: the header used to change component the
            moment the console loaded, from a page title to a back bar. */}
        <TopBar title={pageT('title')} onBack={onExit} backLabel="Back to profile" />
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
        {/* The console's own bar: the header used to change component the
            moment the console loaded, from a page title to a back bar. */}
        <TopBar title={pageT('title')} onBack={onExit} backLabel="Back to profile" />
        <AdminTabSkeleton />
      </div>
    );
  }

  if (!isAuthed) {
    return (
      <div className="space-y-5">
        {/* The console's own bar: the header used to change component the
            moment the console loaded, from a page title to a back bar. */}
        <TopBar title={pageT('title')} onBack={onExit} backLabel="Back to profile" />
        <div className="flex items-center justify-center min-h-[50vh]">
          <AdminSignInCard
            onSignedIn={() => {
              setIsAuthed(true);
              onSignedIn?.();
            }}
          />
        </div>
      </div>
    );
  }

  // Dashboard renders its own h1 when on the dashboard view so the header
  // disappears when the user drills into a sub-page (Set up, Roster, etc.) —
  // those render AdminBackHeader instead.
  return <AdminDashboard onExit={onExit} />;
}
