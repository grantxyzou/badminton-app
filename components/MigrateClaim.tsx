'use client';
import { useEffect, useRef, useState } from 'react';
import { useTranslations } from 'next-intl';
import { setIdentity } from '@/lib/identity';
import { isNative } from '@/lib/native';
import ErrorState from './primitives/ErrorState';

const BASE = process.env.NEXT_PUBLIC_BASE_PATH ?? '';

type Phase = 'working' | 'no-app' | 'no-code' | 'done' | 'failed';

/**
 * `/bpm/migrate?c=<code>` — the landing for the migration link.
 *
 * Inside the NATIVE shell (a universal link opened the app and the bridge
 * navigated here) it claims the code once, writes the identity, and sends the
 * person to Home signed in. Opened in a plain browser — the app is not
 * installed, or the link resolution misfired — it says so and does NOT fake
 * a success: the code is still valid, and the six digits beside it in the
 * PWA's sheet are the fallback.
 *
 * The claim runs ONCE (ref-guarded): React StrictMode mounts effects twice in
 * dev, and a second POST would find the code already burned.
 */
export default function MigrateClaim() {
  const t = useTranslations('profile.migrate');
  const [phase, setPhase] = useState<Phase>('working');
  const ran = useRef(false);

  useEffect(() => {
    if (ran.current) return;
    ran.current = true;
    const code = new URLSearchParams(window.location.search).get('c');
    // Strip the credential from the URL immediately — history, share sheet,
    // and the iOS cold-start URL restore would all otherwise keep it.
    window.history.replaceState(window.history.state, '', `${BASE}/migrate`);
    if (!code) { setPhase('no-code'); return; }
    if (!isNative()) { setPhase('no-app'); return; }

    void (async () => {
      try {
        const res = await fetch(`${BASE}/api/auth/migrate/claim`, {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ link: code }),
          cache: 'no-store',
        });
        if (!res.ok) { setPhase('failed'); return; }
        const body = (await res.json()) as { name: string; deleteToken: string | null; sessionId: string };
        setIdentity({ name: body.name, token: body.deleteToken ?? undefined, sessionId: body.sessionId });
        setPhase('done');
        window.location.replace(`${BASE}/?signedIn=1`);
      } catch {
        setPhase('failed');
      }
    })();
  }, []);

  return (
    <main style={{ maxWidth: '480px', margin: '0 auto', padding: 'var(--space-9) var(--space-7)', textAlign: 'center' }}>
      <h1 className="bpm-h2">{t('pageTitle')}</h1>
      {phase === 'working' && <p className="fs-md" style={{ color: 'var(--text-secondary)' }}>{t('pageWorking')}</p>}
      {phase === 'done' && <p className="fs-md" style={{ color: 'var(--text-secondary)' }}>{t('pageDone')}</p>}
      {phase === 'no-app' && (
        <>
          <p className="fs-md" style={{ color: 'var(--text-primary)', lineHeight: 'var(--lh-normal)' }}>{t('pageNoApp')}</p>
          <p className="fs-sm" style={{ color: 'var(--text-muted)', lineHeight: 'var(--lh-normal)' }}>{t('pageNoAppBody')}</p>
        </>
      )}
      {phase === 'no-code' && <ErrorState message={t('pageNoCode')} />}
      {phase === 'failed' && <ErrorState message={t('pageFailed')} />}
      {phase !== 'working' && phase !== 'done' && (
        <a href={`${BASE}/`} className="bpm-row-link" style={{ width: 'auto', justifyContent: 'center', marginTop: 'var(--space-6)' }}>
          {t('pageHome')}
        </a>
      )}
    </main>
  );
}
