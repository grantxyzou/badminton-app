import { describe, it, expect } from 'vitest';
import { readFileSync } from 'node:fs';
import {
  AUTH_ERROR_REASONS,
  AUTH_PARAMS,
  authErrorKey,
  noticeBanner,
  noticeTimeoutMs,
  type AuthNotice,
} from '../lib/authNotice';
import en from '../messages/en.json';
import zh from '../messages/zh-CN.json';

/**
 * The reason→copy contract between the server's redirect vocabulary and the
 * app's translations.
 *
 * This is the check that catches a reason added server-side with no copy: the
 * user would otherwise see a raw identifier like `state_mismatch`, in English,
 * in every locale — or a blank banner.
 */
const enAuth = (en as { profile: { auth: Record<string, string> } }).profile.auth;
const zhAuth = (zh as { profile: { auth: Record<string, string> } }).profile.auth;

const ALL_KINDS: AuthNotice[] = [
  { kind: 'signedIn', provider: 'google' },
  { kind: 'signInUnconfirmed' },
  { kind: 'verified' },
  { kind: 'notVerified' },
  { kind: 'passwordReset' },
  ...AUTH_ERROR_REASONS.map((reason) => ({ kind: 'authError' as const, reason })),
];

describe('authErrorKey', () => {
  it('maps every known reason to a distinct camelCase key', () => {
    const keys = AUTH_ERROR_REASONS.map(authErrorKey);
    expect(new Set(keys).size).toBe(AUTH_ERROR_REASONS.length);
    expect(authErrorKey('state_mismatch')).toBe('noticeErrorStateMismatch');
    expect(authErrorKey('cancelled')).toBe('noticeErrorCancelled');
  });

  it('degrades an UNKNOWN reason to generic copy, never to a raw identifier', () => {
    // A reason added by a future provider must not surface as `some_new_thing`
    // rendered at the user in English.
    expect(authErrorKey('some_new_thing')).toBe('noticeErrorGeneric');
    expect(authErrorKey('')).toBe('noticeErrorGeneric');
  });
});

describe('noticeBanner', () => {
  it.each(ALL_KINDS)('%o resolves copy in BOTH locales', (notice) => {
    const { titleKey, bodyKey } = noticeBanner(notice);
    for (const [label, dict] of [
      ['en', enAuth],
      ['zh-CN', zhAuth],
    ] as const) {
      expect(dict[titleKey], `${label} missing ${titleKey}`).toBeTruthy();
      expect(dict[bodyKey], `${label} missing ${bodyKey}`).toBeTruthy();
    }
  });

  it('only good news is a success tone', () => {
    expect(noticeBanner({ kind: 'signedIn' }).tone).toBe('success');
    expect(noticeBanner({ kind: 'verified' }).tone).toBe('success');
    expect(noticeBanner({ kind: 'passwordReset' }).tone).toBe('success');
    expect(noticeBanner({ kind: 'notVerified' }).tone).toBe('warn');
    expect(noticeBanner({ kind: 'signInUnconfirmed' }).tone).toBe('warn');
    expect(noticeBanner({ kind: 'authError', reason: 'exchange_failed' }).tone).toBe('warn');
  });

  it('celebrates only the sign-in', () => {
    // StatusBanner reserves `celebrate` for rare, positive moments.
    expect(noticeBanner({ kind: 'signedIn' }).celebrate).toBe(true);
    expect(noticeBanner({ kind: 'verified' }).celebrate).toBe(false);
  });

  it('uses only glyphs present in the layout icon subset', () => {
    // A glyph outside the subset renders as raw text like `LOCK_RESET` rather
    // than failing loudly.
    const layout = readFileSync('app/layout.tsx', 'utf8');
    const subset = (layout.match(/icon_names=([^"&]*)/)?.[1] ?? '').split(',');
    expect(subset.length).toBeGreaterThan(10);
    for (const notice of ALL_KINDS) {
      expect(subset, `${noticeBanner(notice).icon} not in subset`).toContain(
        noticeBanner(notice).icon,
      );
    }
  });

  it('keeps bad news up longer than good news', () => {
    expect(noticeTimeoutMs({ kind: 'signedIn' })).toBeLessThan(
      noticeTimeoutMs({ kind: 'authError', reason: 'exchange_failed' }),
    );
  });
});

describe('AUTH_PARAMS', () => {
  it('lists every param the server writes on an auth redirect', () => {
    expect([...AUTH_PARAMS].sort()).toEqual(
      ['authError', 'provider', 'reset', 'signedIn', 'verified', 'native'].sort(),
    );
  });
});
