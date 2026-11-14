'use client';

import { useCallback, useEffect, useRef, useState } from 'react';
import { useTranslations } from 'next-intl';
import { useOnline } from '@/lib/useOnline';
import { lastClub } from '@/lib/lastClub';
import { useClientValue } from '@/lib/useClientValue';
import { isFlagOn } from '@/lib/flags';

const BASE = process.env.NEXT_PUBLIC_BASE_PATH ?? '';
/** Often enough to feel immediate when Grant is standing right there. */
const POLL_MS = 3_000;

/**
 * Which club the ask is for: the club this phone was last signed in to
 * (lib/lastClub.ts), else nothing, and the server takes BPM. The ask and its
 * poll must send the SAME one, or the poll looks for the request on another
 * club's roster.
 */
function askedClub(): { club: string } | Record<string, never> {
  const club = lastClub();
  return club ? { club } : {};
}

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

export type AskApproved = { name: string; hasPin: boolean };

/**
 * The ask itself: name, the wait, and the answer. Layout-agnostic so it can be a PAGE (the signed-out screen, where a
 * real person is going to approve it — Grant, 2026-11-08: "Since there's a
 * real person approval steps I think they all should be using a page not a
 * sheet") or the body of `AskAccessSheet` (Profile's anonymous card).
 *
 * It never signs anyone in itself: `onApproved` hands the caller the name the
 * server signed in (the cookie is already set) and the caller decides when to
 * write the local identity, because writing it reloads the signed-out screen
 * and the page has one more step to show first.

 */
export default function AskAccessForm({
  active = true,
  initialName = '',
  onApproved,
}: {
  /** False while the surrounding sheet is closed: polling stops and the form resets. */
  active?: boolean;
  initialName?: string;
  /** The server approved and set the session cookie. */
  onApproved: (result: AskApproved) => void;
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
  const [prevOpenFor, setPrevOpenFor] = useState({ active, initialName });
  if (prevOpenFor.active !== active || prevOpenFor.initialName !== initialName) {
    setPrevOpenFor({ active, initialName });
    if (active) {
      setName(initialName);
    } else setPhase('idle');
  }

  // The imperative half stays an effect: clearing the interval and dropping
  // the secret are side effects, and must not run during a render that React
  // may discard.
  useEffect(() => {
    if (active) return;
    stop();
    secret.current = null;
  }, [active, stop]);

  const poll = useCallback(async () => {
    if (!secret.current) return;
    try {
      const res = await fetch(`${BASE}/api/members/access-request/claim`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ name: name.trim(), secret: secret.current, ...askedClub() }),
      });
      if (!res.ok) return; // transient; keep polling
      const body = await res.json();
      if (body.status === 'approved') {
        stop();
        secret.current = null;
        setPhase('approved');
        onApproved({ name: body.name, hasPin: body.hasPin === true });
      } else if (body.status === 'none') {
        // The hour ran out. Every other case,
        // a name the club does not know and a declined ask included, reads
        // `pending` until then (one-way-in step 4c), so this never says
        // whether the name exists.
        stop();
        setPhase('expired');
      }
    } catch {
      /* keep polling — a dropped request is not an answer */
    }
  }, [name, stop, onApproved]);


  async function ask() {
    const trimmed = name.trim();
    if (!trimmed || phase === 'sending' || !online) return;
    setPhase('sending');
    try {
      const res = await fetch(`${BASE}/api/members/access-request`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ name: trimmed, ...askedClub() }),
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

  // A phone that never signed in sends no club and the ask goes to BPM's
  // roster. Say so, rather than leave another club's member waiting on an
  // ask nobody in their club will see. Unknown (server render) shows nothing.
  const noClubHint = useClientValue(() => lastClub() === null, false);
  const sayOtherClub = noClubHint && isFlagOn('NEXT_PUBLIC_FLAG_MULTI_GROUP');

  return (
    <div style={{ display: 'flex', flexDirection: 'column', gap: 'var(--space-4)' }}>
      {phase === 'approved' ? (
        <p className="fs-md motion-fade" style={{ margin: 0 }}>{t('askApproved', { name: name.trim() })}</p>
      ) : (
        <>
          {/* The question, until it is answered: the wait says what happens next. */}
          {phase !== 'waiting' && (
            <p className="fs-md" style={{ color: 'var(--text-secondary)', margin: 0 }}>
              {t('askIntro')}
            </p>
          )}
          {sayOtherClub && (
            <p className="fs-sm" style={{ color: 'var(--text-muted)', margin: 0 }}>{t('askOtherClub')}</p>
          )}

          {phase === 'error' && <p className="field-error" role="alert">{t('askError')}</p>}
          {phase === 'rate_limited' && (
            <p className="field-error" role="alert">{t('askRateLimited')}</p>
          )}
          {phase === 'expired' && (
            <p className="field-error" role="alert">{t('askExpired')}</p>
          )}

          {phase === 'waiting' ? (
            /* Deliberately not a spinner alone. "Keep this open" is the
               instruction that makes the wait work — the secret lives in
               this component, so a closed sheet or page cannot be resumed. */
            <p className="fs-md motion-fade" role="status" style={{ margin: 0, display: 'flex', alignItems: 'center', gap: 'var(--space-3)' }}>
              {/* The wait can last minutes; a turning ring is what says
                  the page is still listening rather than stuck. */}
              <span className="ring-spinner" aria-hidden="true" style={{ flex: 'none' }} />
              <span>{t('askWaiting')}</span>
            </p>
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
                  maxLength={50}
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
  );
}
