'use client';

import { useEffect, useState } from 'react';

/**
 * TEMPORARY SPIKE. Reports back to the window that opened it, then closes.
 *
 * It never shows or forwards Google's `code`: only whether one arrived. The
 * code is single-use and useless without the client secret anyway, but a test
 * page has no business displaying a credential.
 */
export default function PopupReturn() {
  const [status, setStatus] = useState('Checking…');

  /* eslint-disable react-hooks/set-state-in-effect -- reads the landing URL once, after hydration */
  useEffect(() => {
    const params = new URLSearchParams(window.location.search);
    const state = params.get('state') ?? '';
    const via = params.get('via') === 'same' ? 'same site' : 'Google';
    const detail =
      via === 'same site'
        ? 'The pop-up reached the app directly.'
        : params.get('error')
          ? `Google answered with an error: ${params.get('error')}`
          : params.get('code')
            ? 'Google signed in and the pop-up reached the app.'
            : 'Google returned without a code.';

    if (!window.opener) {
      setStatus(`❌ window.opener is null (${via}). The app cannot hear this pop-up. Screenshot this, then close it.`);
      return;
    }
    try {
      (window.opener as Window).postMessage({ lab: 'popup', state, detail }, window.location.origin);
      setStatus(`✅ Sent back to the app (${via}). Closing…`);
      window.setTimeout(() => window.close(), 800);
    } catch (err) {
      setStatus(`❌ postMessage failed (${via}): ${String(err)}`);
    }
  }, []);
  /* eslint-enable react-hooks/set-state-in-effect */

  return (
    <main style={{ maxWidth: '32rem', margin: '0 auto', padding: 'var(--space-7) var(--space-5)' }}>
      <p className="fs-md" style={{ color: 'var(--text-primary)' }}>{status}</p>
    </main>
  );
}
