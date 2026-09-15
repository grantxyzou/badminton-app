'use client';

import { useEffect, useState } from 'react';
import { useTranslations } from 'next-intl';
import { HANDOFF_ACK, HANDOFF_MESSAGE, readHandoffLanding, type HandoffLanding } from '@/lib/handoffClient';

/** How long the opener gets to acknowledge before the code is shown instead. */
const ACK_TIMEOUT_MS = 2500;

/**
 * Read the fragment ONCE and strip it. The codes are live credentials, and
 * dev's StrictMode runs the effect twice — the second run would find an empty
 * fragment and show "no code" over a sign-in that had one.
 */
let taken: HandoffLanding | null = null;
function takeLanding(): HandoffLanding {
  if (!taken) {
    taken = readHandoffLanding(window.location.hash);
    if (window.location.hash) {
      const cleaned = new URL(window.location.href);
      cleaned.hash = '';
      window.history.replaceState(window.history.state, '', cleaned);
    }
  }
  return taken;
}

type Phase = 'sending' | 'sent' | 'code';

/**
 * Gets a finished sign-in back to the app that started it.
 *
 * In a POP-UP, it posts the return code to `window.opener` — aimed at the
 * opener's origin as recorded at `/start`, so a page that opened our pop-up
 * itself hears nothing — and closes once the app acknowledges.
 *
 * Otherwise — no opener, or no acknowledgement in time — it shows the typed
 * code, with a line saying who may ask for it: nobody. That line is the whole
 * defence against the one attack left (lib/authHandoff.ts).
 */
export default function HandoffDone() {
  const t = useTranslations('profile.auth');
  const [phase, setPhase] = useState<Phase>('sending');
  const [typedCode, setTypedCode] = useState<string | null>(null);

  /* eslint-disable react-hooks/set-state-in-effect --
     Everything this page acts on is in the URL fragment and `window.opener`,
     neither of which exists during server rendering. */
  useEffect(() => {
    const landing = takeLanding();
    setTypedCode(landing.typedCode);
    const opener = window.opener as Window | null;
    if (!landing.returnCode || !landing.openerOrigin || !opener) {
      setPhase('code');
      return;
    }
    let acked = false;
    const onMessage = (event: MessageEvent) => {
      if (event.source !== opener) return;
      if ((event.data as { type?: unknown } | null)?.type !== HANDOFF_ACK) return;
      acked = true;
      setPhase('sent');
      window.setTimeout(() => window.close(), 600);
    };
    window.addEventListener('message', onMessage);
    try {
      opener.postMessage({ type: HANDOFF_MESSAGE, returnCode: landing.returnCode }, landing.openerOrigin);
    } catch {
      /* the timer below shows the code */
    }
    const timer = window.setTimeout(() => {
      if (!acked) setPhase('code');
    }, ACK_TIMEOUT_MS);
    return () => {
      window.removeEventListener('message', onMessage);
      window.clearTimeout(timer);
    };
  }, []);
  /* eslint-enable react-hooks/set-state-in-effect */

  return (
    <main style={{ maxWidth: '480px', margin: '0 auto', padding: 'var(--space-9) var(--space-7)', textAlign: 'center' }}>
      {phase === 'sending' && (
        <p className="fs-md" style={{ color: 'var(--text-secondary)' }}>
          {t('handoffDoneSending')}
        </p>
      )}
      {phase === 'sent' && (
        <p className="fs-md" style={{ color: 'var(--text-primary)' }}>
          {t('handoffDoneSent')}
        </p>
      )}
      {phase === 'code' &&
        (typedCode ? (
          <div className="glass-card p-5" style={{ display: 'flex', flexDirection: 'column', gap: 'var(--space-4)' }}>
            <h1 className="bpm-h2" style={{ margin: '0' }}>
              {t('handoffDoneCodeTitle')}
            </h1>
            <p
              data-testid="handoff-typed-code"
              style={{
                fontFamily: 'var(--font-mono)',
                fontSize: 'var(--fs-stat-lg)',
                letterSpacing: '0.3em',
                color: 'var(--text-primary)',
                margin: '0',
              }}
            >
              {`${typedCode.slice(0, 3)} ${typedCode.slice(3)}`}
            </p>
            <p className="fs-md" style={{ color: 'var(--text-primary)', lineHeight: 'var(--lh-normal)', margin: '0' }}>
              {t('handoffDoneCodeBody')}
            </p>
            <p className="fs-sm" style={{ color: 'var(--text-muted)', lineHeight: 'var(--lh-normal)', margin: '0' }}>
              {t('handoffDoneCodeWarning')}
            </p>
          </div>
        ) : (
          <p className="fs-md" style={{ color: 'var(--text-primary)' }}>
            {t('handoffDoneNoCode')}
          </p>
        ))}
    </main>
  );
}
