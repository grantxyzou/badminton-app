'use client';
import { useEffect, useRef, useState } from 'react';
import { useTranslations } from 'next-intl';
import EmptyState from '@/components/primitives/EmptyState';
import { getIdentity, setIdentity } from '@/lib/identity';
import { isNative } from '@/lib/native';
import ErrorState from './primitives/ErrorState';
import { useClientValue, useHydrated } from '@/lib/useClientValue';

const BASE = process.env.NEXT_PUBLIC_BASE_PATH ?? '';

type Phase = 'confirm' | 'working' | 'no-app' | 'no-code' | 'done' | 'failed';

/**
 * The code is cached on FIRST read, before the effect below strips it from the
 * URL. That ordering is the whole reason this is a module-level cache rather
 * than a plain read: after the strip the query string is gone, so a function
 * that re-parsed `window.location` on every render would answer `null` from the
 * second render onward and the page would flip to "no code" mid-claim.
 *
 * Caching also satisfies `useSyncExternalStore`, which compares what `read`
 * returns across renders and loops if it changes on its own.
 */
let cachedCode: string | null | undefined;

function readMigrationCode(): string | null {
  if (cachedCode === undefined) {
    cachedCode = new URLSearchParams(window.location.search).get('c');
  }
  return cachedCode;
}

/**
 * `/bpm/migrate?c=<code>` — the landing for the migration link.
 *
 * Inside the NATIVE shell (a universal link opened the app and the bridge
 * navigated here) it ASKS first, then claims the code once, writes the
 * identity, and sends the person to Home signed in. It claimed on arrival
 * until 2026-11-05 (audit): a link is minted by whoever is signed in on the
 * web, so one sent to someone else signed THEIR app in as the sender — and
 * anything they then entered went to the sender's account. One tap, with the
 * name of whoever is signed in here now, is the whole defence. Opened in a plain browser — the app is not
 * installed, or the link resolution misfired — it says so and does NOT fake
 * a success: the code is still valid, and the six digits beside it in the
 * PWA's sheet are the fallback.
 *
 * The claim runs ONCE (ref-guarded): React StrictMode mounts effects twice in
 * dev, and a second POST would find the code already burned.
 */
export default function MigrateClaim() {
  const t = useTranslations('profile.migrate');
  const hydrated = useHydrated();
  const code = useClientValue(readMigrationCode, null);
  /* Only the outcomes the NETWORK decides are stored. The other two are
     conclusions about the landing itself — no code in the link, or not running
     in the shell — and are derived below rather than pushed in from the effect. */
  const [claimPhase, setClaimPhase] = useState<'working' | 'done' | 'failed' | null>(null);
  const ran = useRef(false);
  const claimed = useRef(false);
  const signedInHere = useClientValue(() => getIdentity()?.name ?? null, null);

  /* `hydrated` is load-bearing: before it flips, `code` is still the server
     snapshot `null`, which is indistinguishable from a link that carried no
     code. Showing 'working' until the client has actually read the URL is what
     stops a valid link flashing "that link had no code" on its first frame. */
  const phase: Phase =
    claimPhase ??
    (!hydrated ? 'working' : !code ? 'no-code' : !isNative() ? 'no-app' : 'confirm');

  useEffect(() => {
    if (ran.current) return;
    ran.current = true;
    // Strip the credential from the URL immediately — history, share sheet,
    // and the iOS cold-start URL restore would all otherwise keep it. Reading
    // through the cache above is what keeps the stripped value available.
    readMigrationCode();
    window.history.replaceState(window.history.state, '', `${BASE}/migrate`);
  }, []);

  function claim() {
    const claimCode = readMigrationCode();
    if (claimed.current || !claimCode || !isNative()) return;
    claimed.current = true;
    setClaimPhase('working');
    void (async () => {
      try {
        const res = await fetch(`${BASE}/api/auth/migrate/claim`, {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ link: claimCode }),
          cache: 'no-store',
        });
        if (!res.ok) { setClaimPhase('failed'); return; }
        const body = (await res.json()) as { name: string; deleteToken: string | null; sessionId: string };
        setIdentity({ name: body.name, token: body.deleteToken ?? undefined, sessionId: body.sessionId });
        setClaimPhase('done');
        window.location.replace(`${BASE}/?signedIn=1`);
      } catch {
        setClaimPhase('failed');
      }
    })();
  }

  return (
    <main style={{ maxWidth: '480px', margin: '0 auto', padding: 'var(--space-9) var(--space-7)', textAlign: 'center' }}>
      <h1 className="bpm-h2">{t('pageTitle')}</h1>
      {phase === 'confirm' && (
        <>
          <p className="fs-md" style={{ color: 'var(--text-primary)', fontWeight: 600 }}>{t('pageConfirm')}</p>
          <p className="fs-sm" style={{ color: 'var(--text-secondary)', lineHeight: 'var(--lh-normal)' }}>{t('pageConfirmBody')}</p>
          {signedInHere && (
            <p className="fs-sm" style={{ color: 'var(--text-muted)', lineHeight: 'var(--lh-normal)' }}>{t('pageReplaces', { name: signedInHere })}</p>
          )}
          <button type="button" className="btn-primary w-full" style={{ marginTop: 'var(--space-6)' }} onClick={claim}>
            {t('pageConfirmCta')}
          </button>
          <a href={`${BASE}/`} className="bpm-row-link" style={{ width: 'auto', justifyContent: 'center', marginTop: 'var(--space-4)' }}>
            {t('pageCancel')}
          </a>
        </>
      )}
      {phase === 'working' && <p className="fs-md" style={{ color: 'var(--text-secondary)' }}>{t('pageWorking')}</p>}
      {phase === 'done' && <p className="fs-md" style={{ color: 'var(--text-secondary)' }}>{t('pageDone')}</p>}
      {phase === 'no-app' && (
        <>
          <p className="fs-md" style={{ color: 'var(--text-primary)', lineHeight: 'var(--lh-normal)' }}>{t('pageNoApp')}</p>
          <p className="fs-sm" style={{ color: 'var(--text-muted)', lineHeight: 'var(--lh-normal)' }}>{t('pageNoAppBody')}</p>
        </>
      )}
      {/* No code in the link is nothing to fail at — muted, with the way home below. */}
      {phase === 'no-code' && <EmptyState>{t('pageNoCode')}</EmptyState>}
      {phase === 'failed' && <ErrorState message={t('pageFailed')} />}
      {phase !== 'working' && phase !== 'done' && phase !== 'confirm' && (
        <a href={`${BASE}/`} className="bpm-row-link" style={{ width: 'auto', justifyContent: 'center', marginTop: 'var(--space-6)' }}>
          {t('pageHome')}
        </a>
      )}
    </main>
  );
}
