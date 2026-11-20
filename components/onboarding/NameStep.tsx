'use client';

import { useEffect, useState } from 'react';
import { useTranslations } from 'next-intl';
import { setIdentity } from '@/lib/identity';
import { isFullName } from '@/lib/fullName';
import { useOnline } from '@/lib/useOnline';
import AuthStage, { type AuthStep } from './AuthStage';

const BASE = process.env.NEXT_PUBLIC_BASE_PATH ?? '';

interface Props {
  /** The top bar's title: "Join {club}", or "Your name". */
  title: string;
  onBack?: () => void;
  step?: AuthStep;
  /** The club's link (docs/plans/one-way-in.md): the new account asks to join it. */
  inviteToken?: string | null;
  /** "Start your own club": the account joins nothing. Sent only without a link. */
  noGroup?: boolean;
  /** The club's name, for "Lin already plays at {club}". */
  club?: string | null;
  /** Ask the server for a name Apple sent, and whether the sign-in is still there. */
  prefill?: boolean;
  /** The account exists (and, with a link, has asked). The caller decides what is next. */
  onMade: (name: string) => void;
  /** The native shell's return code: the account was made inside the system browser sheet. */
  onReturnCode?: (code: string) => void;
}

type Stage = 'name' | 'claim' | 'expired';

/**
 * ONE NAME STEP (docs/plans/sign-in-redesign.md, merge 4): after an email code
 * and after Google or Apple alike, the same page — "What's your name?" and a
 * field. It replaced the name SHEET the provider path used and the page the
 * email path used, which asked the same question in different words.
 *
 * The sign-in itself never touches this page: it lives in a signed, HttpOnly
 * pending-signup cookie, and `complete-signup` and `claim-name` take it from
 * there, so all that is posted from here is a name and a credential.
 *
 * "IS THAT YOU?": a name a signed-in member of the club already holds answers
 * `name_taken`. Prove it is yours — the PIN, or a 6-digit code from an
 * organizer — and this sign-in joins your account (`claim-name`). It never
 * accepts a name alone: names are enumerable.
 */
export default function NameStep({ title, onBack, step, inviteToken, noGroup, club, prefill, onMade, onReturnCode }: Props) {
  const t = useTranslations('signedOut');
  const tn = useTranslations('signedOut.name');
  const tc = useTranslations('signedOut.claim');
  const tAuth = useTranslations('profile.auth');
  const online = useOnline();
  const [stage, setStage] = useState<Stage>('name');
  const [name, setName] = useState('');
  const [hinted, setHinted] = useState<string | null>(null);
  const [proof, setProof] = useState<null | 'pin' | 'code'>(null);
  const [secret, setSecret] = useState('');
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const sentInvite = typeof inviteToken === 'string' && inviteToken.trim().length > 0;

  // Apple sends a name on the first authorization only, and the callback parks
  // it in the signed cookie this page cannot read; asking is the only way to
  // prefill. The same answer says whether the sign-in is still there to use.
  useEffect(() => {
    if (!prefill) return;
    let live = true;
    fetch(`${BASE}/api/auth/complete-signup`, { cache: 'no-store' })
      .then((r) => (r.ok ? r.json() : null))
      .then((d) => {
        if (!live || !d) return;
        if (d.pending === false) setStage('expired');
        else if (d.suggestedName) setName((n) => n || String(d.suggestedName).slice(0, 50));
      })
      .catch(() => undefined);
    return () => {
      live = false;
    };
  }, [prefill]);

  async function submitName() {
    const trimmed = name.trim();
    if (!trimmed || busy || !online) return;
    // A first and last name helps the organizer know who is asking, but a
    // club may know someone by one name: a hint once, then it goes.
    if (sentInvite && !isFullName(trimmed) && hinted !== trimmed) {
      setHinted(trimmed);
      return;
    }
    setBusy(true);
    setError(null);
    try {
      const res = await fetch(`${BASE}/api/auth/complete-signup`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          name: trimmed,
          ...(sentInvite ? { inviteToken } : {}),
          ...(noGroup && !sentInvite ? { noGroup: true } : {}),
        }),
      });
      const data = (await res.json().catch(() => ({}))) as { error?: string; name?: string; returnCode?: string };
      if (!res.ok) {
        if (data.error === 'name_taken') {
          setProof(null);
          setSecret('');
          setStage('claim');
        } else if (data.error === 'no_pending_signup') setStage('expired');
        else if (sentInvite && data.error === 'invite_not_found') setError(t('join.linkNotFound'));
        else if (data.error === 'already_linked') setError(tAuth('alreadyLinked'));
        else if (data.error === 'email_taken') setError(tn('emailTaken'));
        else setError(tn('failed'));
        setBusy(false);
        return;
      }
      if (typeof data.returnCode === 'string' && onReturnCode) {
        onReturnCode(data.returnCode);
        return;
      }
      onMade(typeof data.name === 'string' ? data.name : trimmed);
    } catch {
      setError(tn('failed'));
      setBusy(false);
    }
  }

  async function submitClaim() {
    const typed = secret.trim();
    if (!typed || busy || !online || !proof) return;
    setBusy(true);
    setError(null);
    try {
      const res = await fetch(`${BASE}/api/auth/claim-name`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          name: name.trim(),
          ...(sentInvite ? { inviteToken } : {}),
          ...(proof === 'code' ? { code: typed } : { pin: typed }),
        }),
      });
      const data = (await res.json().catch(() => ({}))) as { error?: string; name?: string };
      if (res.ok) {
        // Joined to the account they already have, in the club they are
        // already in: straight in.
        setIdentity({ name: data.name ?? name.trim(), sessionId: '' });
        return;
      }
      if (res.status === 429) setError(tAuth('claimRateLimited'));
      else if (data.error === 'already_linked') setError(tAuth('claimAlreadyLinked'));
      else if (data.error === 'no_pending_signup') setStage('expired');
      else if (res.status === 401) setError(tAuth('claimWrong'));
      else setError(tn('failed'));
    } catch {
      setError(tn('failed'));
    }
    setBusy(false);
  }

  const errorLine = error && (
    <p className="field-error" role="alert">
      {error}
    </p>
  );

  if (stage === 'expired') {
    return (
      <AuthStage
        data-page="name-expired"
        title={title}
        onBack={onBack}
        backLabel={t('back')}
        heading={tn('expiredHeading')}
        copy={<p className="auth-copy">{tAuth('pendingExpired')}</p>}
        actions={
          onBack && (
            <button type="button" className="auth-btn auth-btn--primary" onClick={onBack}>
              {tAuth('pendingExpiredCta')}
            </button>
          )
        }
      />
    );
  }

  if (stage === 'claim') {
    const digits = proof === 'code' ? 6 : 4;
    const who = name.trim();
    return (
      <AuthStage
        data-page="is-that-you"
        title={tc('title')}
        onBack={() => {
          if (proof) setProof(null);
          else setStage('name');
          setError(null);
        }}
        backLabel={t('back')}
        heading={club ? tc('heading', { name: who, club }) : tc('headingNoClub', { name: who })}
        copy={<p className="auth-copy">{tc('body')}</p>}
        actions={
          proof ? (
            <>
              {errorLine}
              <button
                type="button"
                className="auth-btn auth-btn--primary"
                disabled={busy || !online || secret.length !== digits}
                onClick={() => void submitClaim()}
              >
                {busy ? tc('checking') : tc('continue')}
              </button>
            </>
          ) : (
            <>
              <button type="button" className="auth-btn auth-btn--neutral" onClick={() => setProof('pin')}>
                {tc('enterPin')}
              </button>
              <button type="button" className="auth-btn auth-btn--neutral" onClick={() => setProof('code')}>
                {tc('enterCode')}
              </button>
            </>
          )
        }
        links={
          <button
            type="button"
            className="link-quiet"
            onClick={() => {
              setStage('name');
              setProof(null);
              setError(null);
            }}
          >
            {tc('notMe', { name: who })}
          </button>
        }
      >
        {proof && (
          <form
            onSubmit={(e) => {
              e.preventDefault();
              void submitClaim();
            }}
          >
            <input
              key={proof}
              className="auth-field"
              type="password"
              inputMode="numeric"
              autoComplete="one-time-code"
              value={secret}
              onChange={(e) => {
                setSecret(e.target.value.replace(/\D/g, '').slice(0, digits));
                setError(null);
              }}
              maxLength={digits}
              placeholder={proof === 'code' ? tc('codeLabel') : tc('pinLabel')}
              aria-label={proof === 'code' ? tc('codeLabel') : tc('pinLabel')}
              autoFocus
            />
          </form>
        )}
      </AuthStage>
    );
  }

  const oneWord = name.trim().length > 0 && !isFullName(name.trim());
  return (
    <AuthStage
      data-page="your-name"
      title={title}
      onBack={onBack}
      backLabel={t('back')}
      step={step}
      heading={tn('heading')}
      actions={
        <>
          {errorLine}
          <button
            type="button"
            className="auth-btn auth-btn--primary"
            disabled={busy || !online || !name.trim()}
            onClick={() => void submitName()}
          >
            {busy ? tn('asking') : sentInvite ? tn('ask') : tn('continue')}
          </button>
        </>
      }
    >
      <form
        onSubmit={(e) => {
          e.preventDefault();
          void submitName();
        }}
        style={{ display: 'flex', flexDirection: 'column', gap: 'var(--space-3)' }}
      >
        <input
          className="auth-field"
          type="text"
          value={name}
          onChange={(e) => {
            setName(e.target.value);
            setError(null);
          }}
          placeholder={tn('label')}
          aria-label={tn('label')}
          autoComplete="name"
          maxLength={50}
          autoFocus
        />
        {hinted !== null && oneWord && (
          <p className="field-warn" role="status" style={{ paddingInline: 'var(--space-5)' }}>
            {tn('hint')}
          </p>
        )}
      </form>
    </AuthStage>
  );
}
