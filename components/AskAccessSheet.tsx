'use client';

import { useCallback, useEffect, useRef, useState } from 'react';
import { useTranslations } from 'next-intl';
import { BottomSheet, BottomSheetHeader, BottomSheetBody } from '@/components/BottomSheet';
import { useOnline } from '@/lib/useOnline';
import { setIdentity } from '@/lib/identity';

const BASE = process.env.NEXT_PUBLIC_BASE_PATH ?? '';
/** Often enough to feel immediate when Grant is standing right there. */
const POLL_MS = 3_000;

/**
 * "I can't sign in — let Grant let me in."
 *
 * This replaces the only recovery instruction the app used to give, which was
 * the sentence "Ask the admin for a 6-digit code" — i.e. the app telling people
 * to leave the app and message someone. That is the support burden, written
 * down as copy.
 *
 * It covers BOTH populations, which is the point: the people who forgot a PIN,
 * and the larger group who never set one and were being told "That didn't
 * match" about a PIN that never existed.
 *
 * The secret returned by the request is held ONLY here, in component state. It
 * is what makes a blind one-tap approval safe — approval is by name, so without
 * a device-bound secret it would admit whoever asked next. Deliberately not
 * persisted: a request that does not outlive the sheet is one that cannot be
 * resumed on a device the asker no longer holds.
 */
type Phase = 'idle' | 'sending' | 'waiting' | 'approved' | 'expired' | 'error' | 'rate_limited';

export default function AskAccessSheet({
  open,
  onClose,
  sessionId,
  initialName = '',
  onSignedIn,
}: {
  open: boolean;
  onClose: () => void;
  sessionId: string;
  initialName?: string;
  /** Fired once they are actually signed in. `hasPin` decides whether it is
   *  worth offering them one. */
  onSignedIn: (result: { name: string; hasPin: boolean }) => void;
}) {
  const t = useTranslations('recovery');
  const online = useOnline();
  const [name, setName] = useState(initialName);
  const [phase, setPhase] = useState<Phase>('idle');
  const secret = useRef<string | null>(null);
  const timer = useRef<ReturnType<typeof setInterval> | null>(null);

  const stop = useCallback(() => {
    if (timer.current !== null) {
      clearInterval(timer.current);
      timer.current = null;
    }
  }, []);

  // Never leave a poll running behind a closed sheet.
  useEffect(() => stop, [stop]);
  /**
   * The state half of "the sheet just opened or closed", adjusted during
   * render.
   *
   * On OPEN, re-sync the name. `useState(initialName)` reads the prop once, at
   * first render — and both parents mount this permanently and only toggle
   * `open`, so at that moment the name is still ''. The signup path that lands
   * here has just watched someone type their name and says "straight into the
   * ask flow with the name already filled"; without this it opened blank and
   * asked them to type it again, on the one screen whose job is to unblock
   * someone stuck.
   *
   * On CLOSE, drop back to `idle`.
   */
  const [prevOpenFor, setPrevOpenFor] = useState({ open, initialName });
  if (prevOpenFor.open !== open || prevOpenFor.initialName !== initialName) {
    setPrevOpenFor({ open, initialName });
    if (open) setName(initialName);
    else setPhase('idle');
  }

  // The imperative half stays an effect: clearing the interval and dropping
  // the secret are side effects, and must not run during a render that React
  // may discard.
  useEffect(() => {
    if (open) return;
    stop();
    secret.current = null;
  }, [open, stop]);

  const poll = useCallback(async () => {
    if (!secret.current) return;
    try {
      const res = await fetch(`${BASE}/api/members/access-request/claim`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ name: name.trim(), secret: secret.current }),
      });
      if (!res.ok) return; // transient; keep polling
      const body = await res.json();
      if (body.status === 'approved') {
        stop();
        secret.current = null;
        setIdentity({ name: body.name, sessionId });
        setPhase('approved');
        onSignedIn({ name: body.name, hasPin: body.hasPin === true });
      } else if (body.status === 'none') {
        // Expired, or Grant declined. One answer, because there is nothing
        // useful to do differently with the two.
        stop();
        setPhase('expired');
      }
    } catch {
      /* keep polling — a dropped request is not an answer */
    }
  }, [name, sessionId, stop, onSignedIn]);

  async function ask() {
    const trimmed = name.trim();
    if (!trimmed || phase === 'sending' || !online) return;
    setPhase('sending');
    try {
      const res = await fetch(`${BASE}/api/members/access-request`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ name: trimmed }),
      });
      if (res.status === 429) { setPhase('rate_limited'); return; }
      if (!res.ok) { setPhase('error'); return; }
      const body = await res.json();
      secret.current = typeof body.secret === 'string' ? body.secret : null;
      if (!secret.current) { setPhase('error'); return; }
      setPhase('waiting');
      stop();
      timer.current = setInterval(() => void poll(), POLL_MS);
    } catch {
      setPhase('error');
    }
  }

  return (
    <BottomSheet open={open} onClose={onClose} ariaLabel={t('askTitle')} maxHeight="60vh" width="narrow">
      <BottomSheetHeader>
        <span style={{ fontSize: 'var(--fs-lg)', fontWeight: 600 }}>{t('askTitle')}</span>
        <button type="button" onClick={onClose} aria-label={t('close')} style={{ minWidth: 44, minHeight: 44 }}>
          <span className="material-icons" style={{ fontSize: 'var(--fs-stat)' }}>close</span>
        </button>
      </BottomSheetHeader>
      <BottomSheetBody>
        <div style={{ display: 'flex', flexDirection: 'column', gap: 'var(--space-4)' }}>
          {phase === 'approved' ? (
            <p className="fs-md" style={{ margin: 0 }}>{t('askApproved', { name: name.trim() })}</p>
          ) : (
            <>
              <p className="fs-md" style={{ color: 'var(--text-secondary)', margin: 0 }}>
                {t('askIntro')}
              </p>

              {phase === 'error' && <p className="field-error" role="alert">{t('askError')}</p>}
              {phase === 'rate_limited' && (
                <p className="field-error" role="alert">{t('askRateLimited')}</p>
              )}
              {phase === 'expired' && <p className="field-error" role="alert">{t('askExpired')}</p>}

              {phase === 'waiting' ? (
                /* Deliberately not a spinner alone. "Keep this open" is the
                   instruction that makes the wait work — the secret lives in
                   this component, so a closed sheet cannot be resumed. */
                <p className="fs-md" role="status" style={{ margin: 0 }}>{t('askWaiting')}</p>
              ) : (
                <>
                  <label style={{ display: 'flex', flexDirection: 'column', gap: 'var(--space-1)' }}>
                    <span className="fs-sm" style={{ color: 'var(--text-secondary)' }}>
                      {t('askNameLabel')}
                    </span>
                    <input
                      type="text"
                      value={name}
                      onChange={(e) => setName(e.target.value)}
                      aria-label={t('askNameLabel')}
                      maxLength={80}
                      autoComplete="name"
                    />
                  </label>
                  <button
                    type="button"
                    className="btn-primary"
                    style={{ width: '100%' }}
                    disabled={!name.trim() || phase === 'sending' || !online}
                    onClick={() => void ask()}
                  >
                    {phase === 'sending'
                      ? t('askSending')
                      : phase === 'expired' || phase === 'error'
                        ? t('askAgain')
                        : t('askCta')}
                  </button>
                </>
              )}
            </>
          )}
        </div>
      </BottomSheetBody>
    </BottomSheet>
  );
}
