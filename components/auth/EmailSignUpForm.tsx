'use client';

import { useState } from 'react';
import { useTranslations } from 'next-intl';
import { PASSWORD_MIN_LENGTH, isCommonPassword } from '@/lib/passwordRules';

const BASE = process.env.NEXT_PUBLIC_BASE_PATH ?? '';

interface Props {
  /**
   * Account created and signed in. `verificationSent` is false when the account
   * is real but the mail did not go out — the caller must SAY so rather than
   * imply one is coming. The sheet shows a dismissable note; a page has nothing
   * to dismiss to, so it carries the line onto its next step instead. That
   * difference is the whole reason this is a prop and not handled in here.
   */
  onSuccess: (result: { name: string; verificationSent: boolean }) => void;
  /**
   * The invite this device arrived on, if any. A stranger who taps a club's
   * link has no account yet and the PIN path is invite-list gated, so email or
   * a provider is how they become one. Passing the token means the account
   * lands in the club that invited it rather than on BPM's roster with the
   * real club added on top (PR #376).
   */
  inviteToken?: string | null;
  /**
   * "I am about to create my own club — do not join me to anything." Without it
   * a signup with no invite resolves to BPM and writes a membership there, so
   * every new organiser would appear on BPM's roster (`lib/inviteSignup.ts`).
   */
  noGroup?: boolean;
  /**
   * Rendered as the dismiss action on the no-mail note. Sheets pass it; a page
   * omits it, because there is nowhere to dismiss to and the note travels on.
   */
  onDismiss?: () => void;
}

/**
 * Create an account with a name, an email address and a password.
 *
 * Layout-agnostic on purpose: this is the body of `EmailSignUpSheet` lifted out
 * so the onboarding create flow can embed it as a step. A bottom sheet is a
 * quick action inside a context you will return to; signing up to make your
 * first club is not that, and portalling a sheet over a full-screen onboarding
 * page would put a scrim over the thing the person is doing.
 *
 * The strength check mirrors `lib/passwordRules.ts` so a too-short password is
 * caught before any request — but the SERVER stays authoritative, and its own
 * `reason` string is deliberately never rendered: it is English prose and would
 * appear untranslated in zh-CN.
 *
 * `name_taken` and `email_taken` get distinct copy on purpose. They need
 * different actions from the user — one means "sign in instead", the other
 * "that address is spoken for" — and a shared "couldn't create that" would
 * leave them guessing which.
 */
export default function EmailSignUpForm({ onSuccess, inviteToken, noGroup, onDismiss }: Props) {
  const t = useTranslations('profile.auth');
  const [name, setName] = useState('');
  const [email, setEmail] = useState('');
  const [password, setPassword] = useState('');
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [unsentNote, setUnsentNote] = useState<string | null>(null);

  const tooShort = password.length > 0 && password.length < PASSWORD_MIN_LENGTH;
  const tooCommon = password.length >= PASSWORD_MIN_LENGTH && isCommonPassword(password);
  const canSubmit =
    !busy &&
    !!name.trim() &&
    !!email.trim() &&
    password.length >= PASSWORD_MIN_LENGTH &&
    !tooCommon;

  /**
   * ONE expression decides both whether the token is SENT and whether a 404 is
   * read as "that invite was replaced". The server's `attempted` treats a
   * present-but-unusable value as an attempt and refuses it, so a guard that
   * sent `''` while reading `''` as "no invite sent" would show the generic
   * signup error for a refusal that has specific, actionable advice. Keeping it
   * to one constant is what stops the two sides drifting apart.
   */
  const sentInvite = typeof inviteToken === 'string' && inviteToken.trim().length > 0;

  async function submit(e: React.FormEvent) {
    e.preventDefault();
    if (!canSubmit) return;
    setBusy(true);
    setError(null);
    try {
      const res = await fetch(`${BASE}/api/auth/signup`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          name: name.trim(),
          email: email.trim(),
          password,
          ...(sentInvite ? { inviteToken } : {}),
          ...(noGroup ? { noGroup: true } : {}),
        }),
      });
      const data = await res.json().catch(() => ({}));

      if (!res.ok) {
        // The invite was REGENERATED between opening the link and finishing
        // here. #376 refuses before it writes anything — better than leaving an
        // account behind with no club and no way to reach one — so nothing was
        // created and the actionable advice is "ask for a fresh link", not
        // "try again". Only when we actually sent one: a bare 404 from this
        // route means something else entirely.
        if (sentInvite && data.error === 'invite_not_found') setError(t('signUpInviteExpired'));
        else if (res.status === 429) setError(t('signUpRateLimited'));
        else if (data.error === 'name_taken') setError(t('signUpNameTaken'));
        else if (data.error === 'email_taken') setError(t('signUpEmailTaken'));
        else if (data.error === 'weak_password') setError(t('passwordTooCommon'));
        else if (data.error === 'invalid_request') setError(t('signUpInvalidEmail'));
        else setError(t('signUpFailed'));
        setBusy(false);
        return;
      }

      if (data.verificationSent === false) {
        // Real account, no mail. Say it rather than implying one is coming.
        // The note is shown HERE for a sheet (which has a dismiss), and the
        // flag goes to the caller so a page can carry the same honesty onto
        // its next step. Reporting `true` here would be the lie the note
        // exists to prevent.
        setUnsentNote(t('verifyMailUnsent'));
        setBusy(false);
        onSuccess({ name: data.name, verificationSent: false });
        return;
      }
      onSuccess({ name: data.name, verificationSent: true });
    } catch {
      setError(t('signUpFailed'));
      setBusy(false);
    }
  }

  return (
    <>
{unsentNote ? (
  <div style={{ display: 'grid', gap: 'var(--space-4)' }}>
    <p
      role="status"
      style={{ fontSize: 'var(--fs-md)', color: 'var(--text-primary)', margin: '0' }}
    >
      {unsentNote}
    </p>
    {/* Only a sheet has somewhere to dismiss TO. A page omits `onDismiss`
        and carries the note onto its next step instead. */}
    {onDismiss && (
      <button
        type="button"
        onClick={onDismiss}
        className="cc-btn cc-btn-primary cc-btn-lg"
        style={{ width: '100%' }}
      >
        {t('chooseNameCta')}
      </button>
    )}
  </div>
) : (
  <form onSubmit={submit} style={{ display: 'grid', gap: 'var(--space-3)' }}>
    <p style={{ fontSize: 'var(--fs-md)', color: 'var(--text-primary)', margin: '0' }}>
      {t('emailSignUpBody')}
    </p>
    <input
      type="text"
      autoComplete="nickname"
      value={name}
      onChange={(e) => {
        setName(e.target.value);
        setError(null);
      }}
      placeholder={t('yourNameLabel')}
      aria-label={t('yourNameLabel')}
      maxLength={50}
      autoFocus
    />
    <input
      type="email"
      inputMode="email"
      autoComplete="email"
      value={email}
      onChange={(e) => {
        setEmail(e.target.value);
        setError(null);
      }}
      placeholder={t('emailLabel')}
      aria-label={t('emailLabel')}
      maxLength={254}
    />
    <input
      type="password"
      autoComplete="new-password"
      value={password}
      onChange={(e) => {
        setPassword(e.target.value);
        setError(null);
      }}
      placeholder={t('passwordLabel')}
      aria-label={t('passwordLabel')}
      maxLength={200}
    />
    {tooShort && <p className="field-error">{t('passwordTooShort')}</p>}
    {tooCommon && <p className="field-error">{t('passwordTooCommon')}</p>}
    {error && <p className="field-error">{error}</p>}
    <button
      type="submit"
      disabled={!canSubmit}
      className="cc-btn cc-btn-primary cc-btn-lg"
      style={{ width: '100%' }}
    >
      {busy ? t('emailSignUpSaving') : t('emailSignUpCta')}
    </button>
  </form>
)}
    </>
  );
}
