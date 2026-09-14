'use client';

import { useEffect, useRef, useState } from 'react';

const BASE = process.env.NEXT_PUBLIC_BASE_PATH ?? '';

type Via = 'same' | 'google';
interface Result {
  via: Via;
  opened: boolean;
  heardBack: boolean | null;
  detail: string;
}

function randomState(): string {
  return Array.from(crypto.getRandomValues(new Uint8Array(16)), (b) => b.toString(16).padStart(2, '0')).join('');
}

/** TEMPORARY SPIKE — see page.tsx. */
export default function PopupLab({ googleClientId }: { googleClientId: string | null }) {
  const [env, setEnv] = useState<{ standalone: boolean; ua: string } | null>(null);
  const [results, setResults] = useState<Result[]>([]);
  const pending = useRef<{ via: Via; state: string } | null>(null);

  useEffect(() => {
    const standalone =
      window.matchMedia('(display-mode: standalone)').matches ||
      (navigator as Navigator & { standalone?: boolean }).standalone === true;
    // eslint-disable-next-line react-hooks/set-state-in-effect -- reads browser-only facts once, after hydration
    setEnv({ standalone, ua: navigator.userAgent });

    const onMessage = (e: MessageEvent) => {
      if (e.origin !== window.location.origin) return;
      const data = e.data as { lab?: string; state?: string; detail?: string } | null;
      if (!data || data.lab !== 'popup' || !pending.current || data.state !== pending.current.state) return;
      const via = pending.current.via;
      pending.current = null;
      // Replaces the "waiting" card for this run rather than adding a second.
      setResults((r) => [{ via, opened: true, heardBack: true, detail: data.detail ?? '' }, ...r.slice(1)]);
    };
    window.addEventListener('message', onMessage);
    return () => window.removeEventListener('message', onMessage);
  }, []);

  function run(via: Via) {
    const state = randomState();
    const returnUrl = `${window.location.origin}${BASE}/lab/popup/return`;
    const url =
      via === 'same'
        ? `${returnUrl}?state=${state}&via=same`
        : `https://accounts.google.com/o/oauth2/v2/auth?${new URLSearchParams({
            client_id: googleClientId ?? '',
            redirect_uri: returnUrl,
            response_type: 'code',
            scope: 'openid',
            prompt: 'select_account',
            state,
          }).toString()}`;
    // SYNCHRONOUS, inside the tap: iOS refuses a window.open after an await.
    const win = window.open(url, 'bpm-popup-lab');
    pending.current = { via, state };
    setResults((r) => [
      {
        via,
        opened: !!win,
        heardBack: win ? null : false,
        detail: win ? 'Waiting for the pop-up to report back…' : 'window.open returned null — no pop-up at all.',
      },
      ...r,
    ]);
  }

  const label = (v: Via) => (v === 'same' ? 'A · same site' : 'B · through Google');

  return (
    <main className="page-shell-top" style={{ maxWidth: '32rem', margin: '0 auto', padding: 'var(--space-6) var(--space-5)' }}>
      <h1 className="bpm-h2">Pop-up sign-in test</h1>
      <p className="fs-md" style={{ color: 'var(--text-secondary)', marginTop: 'var(--space-2)' }}>
        Temporary. Open this from the home-screen app, tap A, then B, and send a screenshot.
      </p>

      <div className="glass-card p-5 flex flex-col gap-3" style={{ marginTop: 'var(--space-6)' }}>
        <p className="fs-sm" style={{ color: 'var(--text-muted)', margin: 0 }}>
          Home-screen app: <strong>{env ? (env.standalone ? 'yes' : 'NO — open this from the installed app') : '…'}</strong>
        </p>
        <p className="fs-sm" style={{ color: 'var(--text-muted)', margin: 0, wordBreak: 'break-word' }}>{env?.ua ?? ''}</p>
        <button type="button" className="btn-primary" onClick={() => run('same')}>
          Test A — pop-up on this site
        </button>
        <button type="button" className="btn-ghost" onClick={() => run('google')} disabled={!googleClientId}>
          Test B — pop-up through Google
        </button>
        {!googleClientId && (
          <p className="field-error" role="alert">
            Google isn&apos;t configured here, so test B can&apos;t run.
          </p>
        )}
      </div>

      <div className="flex flex-col gap-3" style={{ marginTop: 'var(--space-6)' }}>
        {results.map((r, i) => (
          <div key={i} className="glass-card p-5">
            <p className="fs-md" style={{ color: 'var(--text-primary)', margin: 0 }}>
              <strong>{label(r.via)}</strong>: {r.heardBack === true ? '✅ heard back' : r.opened ? '⏳ opened' : '❌ did not open'}
            </p>
            <p className="fs-sm" style={{ color: 'var(--text-muted)', marginTop: 'var(--space-1)' }}>{r.detail}</p>
          </div>
        ))}
      </div>
    </main>
  );
}
