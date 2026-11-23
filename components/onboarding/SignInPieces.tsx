'use client';

import { useTranslations } from 'next-intl';
import ProviderButtons, { type Provider } from '@/components/auth/ProviderButtons';
import CodeBoxes from '@/components/auth/CodeBoxes';
import { CODE_LENGTH, type EmailCode } from '@/components/auth/useEmailCode';
import AuthStage, { type AuthStep } from './AuthStage';

/**
 * The sign-in buttons of a LOGO page (Log in, a club's link): Apple and
 * Google, "or", the address and "Email me a code". They sit in the bottom
 * slot, where the thumb is (docs/plans/sign-in-redesign.md).
 */
export function EmailCodeChoices({
  code,
  authProviders,
  onLeave,
}: {
  code: EmailCode;
  authProviders: Provider[];
  /** Called at the tap that leaves for Google or Apple. */
  onLeave?: () => void;
}) {
  const tc = useTranslations('signedOut.code');
  return (
    <form
      onSubmit={(e) => {
        e.preventDefault();
        void code.send();
      }}
      style={{ display: 'flex', flexDirection: 'column', gap: 'var(--space-4)' }}
    >
      {authProviders.length > 0 && (
        <>
          <ProviderButtons mode="signin" size="auth" available={authProviders} onLeave={onLeave} />
          <p className="auth-or">{tc('or')}</p>
        </>
      )}
      <input
        className="auth-field"
        type="email"
        inputMode="email"
        autoComplete="email"
        autoCapitalize="none"
        spellCheck={false}
        value={code.email}
        onChange={(e) => code.setEmail(e.target.value)}
        placeholder={tc('emailLabel')}
        aria-label={tc('emailLabel')}
        maxLength={254}
      />
      {code.error && (
        <p className="field-error" role="alert">
          {code.error}
        </p>
      )}
      <button type="submit" className="auth-btn auth-btn--primary" disabled={code.busy || !code.online || !code.email.trim()}>
        {code.busy ? tc('sending') : tc('send')}
      </button>
    </form>
  );
}

/**
 * "Check your email": the six boxes, how long the code lasts, a way to send
 * another, and Continue.
 *
 * `definite` is for a club's link, where every address is sent a code, so the
 * sentence can say so. On Log in the server answers every address the same
 * (it must not say which have accounts), so the sentence says IF.
 */
export function CheckEmailPage({
  code,
  title,
  step,
  definite,
}: {
  code: EmailCode;
  title: string;
  step?: AuthStep;
  definite: boolean;
}) {
  const t = useTranslations('signedOut');
  const tc = useTranslations('signedOut.code');
  return (
    <AuthStage
      data-page="check-email"
      title={title}
      onBack={code.restart}
      backLabel={t('back')}
      step={step}
      heading={tc('heading')}
      copy={
        <p className="auth-copy" role="status">
          {tc.rich(definite ? 'sentTo' : 'sentIfAccount', { email: code.email, b: (chunks) => <b>{chunks}</b> })}
        </p>
      }
      actions={
        <>
          {code.error && (
            <p className="field-error" role="alert">
              {code.error}
            </p>
          )}
          <button
            type="button"
            className="auth-btn auth-btn--primary"
            disabled={code.busy || !code.online || code.code.length !== CODE_LENGTH}
            onClick={() => void code.verify()}
          >
            {code.busy ? tc('checking') : tc('continue')}
          </button>
        </>
      }
      links={
        <button type="button" className="link-quiet link-quiet--plain" onClick={code.restart}>
          {tc('otherEmail')}
        </button>
      }
    >
      <CodeBoxes value={code.code} onChange={code.setCode} label={tc('label')} autoFocus />
      <div className="auth-code-foot">
        <p className="auth-note" role={code.resent ? 'status' : undefined}>
          {code.resent ? tc('resent') : tc('valid')}
        </p>
        <button type="button" className="link-quiet link-quiet--plain link-quiet--flush" disabled={code.busy || !code.online} onClick={() => void code.send()}>
          {tc('resend')}
        </button>
      </div>
    </AuthStage>
  );
}

/** "Step 1 of 3" for the club's link. */
export function useDoorStep() {
  const t = useTranslations('signedOut');
  return (n: number, total = 3): AuthStep => ({ n, total, label: t('step', { n, total }) });
}
