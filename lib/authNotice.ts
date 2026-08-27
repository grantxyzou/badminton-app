/**
 * What the app should SAY after an auth redirect lands.
 *
 * Pure — no React, no DOM, no I/O. `HomeShell` performs the side effects; this
 * module owns the decisions, so the reason→copy contract is unit-testable and
 * cannot drift from the server's vocabulary without a test failing.
 *
 * The problem it exists for: the server writes `?signedIn=1`, `?authError=…`,
 * `?verified=1|0` and `?reset=…` on redirect, and until now the client read
 * NONE of them. Every provider failure returned the user to Home in silence,
 * and a successful sign-in rendered a signed-out app.
 */
import type { StatusTone } from '@/components/primitives/StatusBanner';

/**
 * Every `authError` reason the server can emit. Eight come from `oauthFailure`
 * in lib/oauthCallback.ts; `misconfigured` is written directly by the two
 * callback routes when `APP_ORIGIN` is unset.
 *
 * Kept as a const tuple so a test can assert each one has copy in BOTH locales
 * — a reason added server-side with no translation is otherwise invisible until
 * a user hits it.
 */
export const AUTH_ERROR_REASONS = [
  'misconfigured',
  'rate_limited',
  'cancelled',
  'state_mismatch',
  'invalid_callback',
  'provider_not_configured',
  'exchange_failed',
  'already_linked',
  'account_unavailable',
] as const;

export type AuthErrorReason = (typeof AUTH_ERROR_REASONS)[number];

export type AuthNoticeKind =
  | 'signedIn'
  | 'signInUnconfirmed'
  | 'verified'
  | 'notVerified'
  | 'passwordReset'
  | 'authError';

export interface AuthNotice {
  kind: AuthNoticeKind;
  provider?: 'google' | 'apple' | null;
  reason?: string;
}

/** Params this app strips from the URL after reading them. */
export const AUTH_PARAMS = [
  'signedIn',
  'provider',
  'authError',
  'verified',
  'reset',
] as const;

function isKnownReason(reason: string): reason is AuthErrorReason {
  return (AUTH_ERROR_REASONS as readonly string[]).includes(reason);
}

/**
 * i18n key suffix for an error reason, under `profile.auth`.
 *
 * An UNKNOWN reason maps to the generic key rather than to the reason itself:
 * a provider or route added later would otherwise render a raw identifier like
 * `state_mismatch` at the user, in English, in every locale.
 */
export function authErrorKey(reason: string): string {
  if (!isKnownReason(reason)) return 'noticeErrorGeneric';
  // snake_case -> camelCase suffix
  const camel = reason.replace(/_([a-z])/g, (_, c: string) => c.toUpperCase());
  return `noticeError${camel.charAt(0).toUpperCase()}${camel.slice(1)}`;
}

export interface NoticeBanner {
  tone: StatusTone;
  icon: string;
  titleKey: string;
  bodyKey: string;
  /** The primitive's one-shot pop. Reserved for rare, positive moments. */
  celebrate: boolean;
}

/**
 * Tone, glyph and copy keys for a notice.
 *
 * Every glyph here must already be in the Material Symbols subset requested in
 * `app/layout.tsx` — a missing glyph renders as raw text like `LOCK_RESET`
 * rather than failing loudly.
 */
export function noticeBanner(notice: AuthNotice): NoticeBanner {
  switch (notice.kind) {
    case 'signedIn':
      return {
        tone: 'success',
        icon: 'check_circle',
        titleKey: 'noticeSignedInTitle',
        bodyKey: 'noticeSignedInBody',
        celebrate: true,
      };
    case 'verified':
      return {
        tone: 'success',
        icon: 'check_circle',
        titleKey: 'noticeVerifiedTitle',
        bodyKey: 'noticeVerifiedBody',
        celebrate: false,
      };
    case 'passwordReset':
      return {
        tone: 'success',
        icon: 'check_circle',
        titleKey: 'noticePasswordResetTitle',
        bodyKey: 'noticePasswordResetBody',
        celebrate: false,
      };
    case 'notVerified':
      // Deliberately covers used, expired AND already-confirmed with one
      // message. The endpoint answers identically for all three so it cannot be
      // used to probe whether an address has an account; saying more here would
      // hand back the distinction the server withheld.
      return {
        tone: 'warn',
        icon: 'warning',
        titleKey: 'noticeNotVerifiedTitle',
        bodyKey: 'noticeNotVerifiedBody',
        celebrate: false,
      };
    case 'signInUnconfirmed':
      return {
        tone: 'warn',
        icon: 'lock_clock',
        titleKey: 'noticeUnconfirmedTitle',
        bodyKey: 'noticeUnconfirmedBody',
        celebrate: false,
      };
    case 'authError':
    default:
      return {
        tone: 'warn',
        icon: 'warning',
        titleKey: 'noticeErrorTitle',
        bodyKey: authErrorKey(notice.reason ?? ''),
        celebrate: false,
      };
  }
}

/** How long a notice stays up. Good news can go sooner than bad news. */
export function noticeTimeoutMs(notice: AuthNotice): number {
  return noticeBanner(notice).tone === 'success' ? 6000 : 12000;
}
