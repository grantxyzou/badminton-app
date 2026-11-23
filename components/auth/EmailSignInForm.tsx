'use client';

import { useTranslations } from 'next-intl';
import { usePasswordSignIn } from './usePasswordSignIn';

interface Props {
  onSuccess: (result: { name: string }) => void;
  /**
   * When provided, render "Forgot your password?" below the submit button.
   * Optional — mirroring `SignInForm`'s `onForgotPin` — so a caller that wants
   * the link somewhere else can render it itself and leave this off, rather
   * than getting two of them. ProfileTab's anonymous card does exactly that:
   * it collects all three secondary routes into one row under the form.
   */
  onForgotPassword?: () => void;
}

/**
 * Sign in with an email address and password.
 *
 * WHY THIS IS NOT `SignInForm`
 * ----------------------------
 * `SignInForm` (name + PIN) hard-gates on `body.deleteToken` being present and
 * treats its absence as a NETWORK error. That is correct for its own flow —
 * it registers you for a session — but `POST /api/auth/signin` is
 * account-level and returns no `deleteToken`, so reusing it would reject every
 * successful sign-in as a connection failure.
 *
 * This form therefore gates on nothing optional. It reads `name`; if that is
 * missing the response is genuinely malformed, which is a service failure and
 * says so — a different thing from rejecting a valid answer.
 *
 * Like `SignInForm`, it owns no post-success UI: the caller decides what
 * becoming signed-in means.
 */
export default function EmailSignInForm({ onSuccess, onForgotPassword }: Props) {
  const t = useTranslations('profile.auth');
  const form = usePasswordSignIn({ onSuccess });
  const { email, password, busy } = form;
  const error =
    form.error === 'invalid'
      ? t('signInInvalid')
      : form.error === 'rate_limited'
        ? t('signInRateLimited')
        : form.error === 'service'
          ? t('signInService')
          : null;

  function submit(e: React.FormEvent) {
    e.preventDefault();
    void form.submit();
  }

  return (
    <form onSubmit={submit} style={{ display: 'grid', gap: 'var(--space-3)' }}>
      <input
        type="email"
        inputMode="email"
        autoComplete="email"
        value={email}
        onChange={(e) => form.setEmail(e.target.value)}
        placeholder={t('emailLabel')}
        aria-label={t('emailLabel')}
        maxLength={254}
      />
      <input
        type="password"
        autoComplete="current-password"
        value={password}
        onChange={(e) => form.setPassword(e.target.value)}
        placeholder={t('passwordLabel')}
        aria-label={t('passwordLabel')}
        maxLength={200}
      />
      {error && <p className="field-error">{error}</p>}
      <button
        type="submit"
        disabled={!form.canSubmit}
        className="cc-btn cc-btn-primary cc-btn-lg"
        style={{ width: '100%' }}
      >
        {busy ? t('emailSignInChecking') : t('emailSignInCta')}
      </button>
      {/* A way out, not another action — see `.link-quiet` in globals.css. */}
      {onForgotPassword && (
        <button type="button" onClick={onForgotPassword} className="link-quiet link-quiet--plain">
          {t('forgotPasswordLink')}
        </button>
      )}
    </form>
  );
}
