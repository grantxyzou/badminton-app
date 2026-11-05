import { describe, it, expect } from 'vitest';
import { signupErrorKey } from '@/lib/signupError';
import en from '@/messages/en.json';
import zh from '@/messages/zh-CN.json';

/**
 * A refused sign-up shows a sentence in the reader's language, never the
 * server's own words (audit, 2026-11-05): `POST /api/players` answers some
 * refusals in English sentences and some in codes, and the card printed
 * whichever came back — `session_settled` included.
 */
describe('signupErrorKey', () => {
  it('turns each refusal the route sends into a key', () => {
    expect(signupErrorKey(403, 'Sign-ups are not open yet')).toBe('notOpen');
    expect(signupErrorKey(403, 'Sign-up deadline has passed')).toBe('deadlinePassed');
    expect(signupErrorKey(409, 'Already signed up')).toBe('alreadyIn');
    expect(signupErrorKey(409, 'Session is full')).toBe('full');
    expect(signupErrorKey(409, 'session_settled')).toBe('settled');
    expect(signupErrorKey(404, 'no_active_session')).toBe('noSession');
    expect(signupErrorKey(429, 'Too many requests. Please wait a moment.')).toBe('tooMany');
    expect(signupErrorKey(401, 'unauthorized')).toBe('signedOut');
  });

  it('answers null — the generic sentence — for anything it does not know', () => {
    expect(signupErrorKey(500, 'Failed to sign up')).toBeNull();
    expect(signupErrorKey(400, 'toString')).toBeNull();
    expect(signupErrorKey(500, undefined)).toBeNull();
  });

  it('every key has a sentence in both languages', () => {
    const keys = ['notOpen', 'deadlinePassed', 'alreadyIn', 'full', 'settled', 'noSession', 'tooMany', 'signedOut'] as const;
    for (const k of keys) {
      expect(typeof en.home.signup.errors[k], `en ${k}`).toBe('string');
      expect(typeof (zh as typeof en).home.signup.errors[k], `zh ${k}`).toBe('string');
    }
  });
});
