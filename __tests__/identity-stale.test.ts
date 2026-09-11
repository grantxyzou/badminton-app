import { describe, it, expect } from 'vitest';
import { resolveStaleIdentity } from '@/lib/identity';

describe('resolveStaleIdentity', () => {
  it('returns keep when no stored identity', () => {
    expect(resolveStaleIdentity(null, 'session-2026-05-15', false)).toEqual({ action: 'keep' });
  });

  it('returns keep when stored sessionId matches active session', () => {
    const stored = { name: 'Alice', token: 'tok-123', sessionId: 'session-2026-05-15' };
    expect(resolveStaleIdentity(stored, 'session-2026-05-15', false)).toEqual({ action: 'keep' });
  });

  it('returns clear for anonymous user crossing a session boundary', () => {
    // No PIN → deleteToken is the only auth, and it was bound to the old session.
    const stored = { name: 'Alice', token: 'tok-old', sessionId: 'session-2026-05-08' };
    expect(resolveStaleIdentity(stored, 'session-2026-05-15', false)).toEqual({ action: 'clear' });
  });

  it('preserves identity for PIN-protected member crossing a session boundary', () => {
    // PIN member: account-level auth survives. Refresh sessionId, drop token.
    const stored = { name: 'Bob', token: 'tok-old', sessionId: 'session-2026-05-08' };
    const result = resolveStaleIdentity(stored, 'session-2026-05-15', true);
    expect(result).toEqual({
      action: 'preserve',
      identity: { name: 'Bob', sessionId: 'session-2026-05-15' },
    });
    // Crucially, the old deleteToken does NOT persist — it was bound to
    // the old session-player record and is no longer valid.
    if (result.action === 'preserve') {
      expect(result.identity.token).toBeUndefined();
    }
  });

  it('returns keep when stored has no sessionId (account-only, never signed up)', () => {
    // Edge case: identity created via the sessionSignup:false path. There's no
    // session-bound aspect to be stale. Leave it alone.
    const stored = { name: 'Carol', sessionId: '' };
    expect(resolveStaleIdentity(stored, 'session-2026-05-15', false)).toEqual({ action: 'keep' });
  });

  it('preserves over clear when hasPin is true even with a deleteToken on the stored identity', () => {
    // Order matters: PIN check wins. Even if the user previously signed up
    // (had a token), their PIN is still the canonical auth.
    const stored = { name: 'Dan', token: 'tok-old', sessionId: 'session-2026-05-08' };
    const result = resolveStaleIdentity(stored, 'session-2026-05-15', true);
    expect(result.action).toBe('preserve');
  });
});

/**
 * THE THIRD PARAMETER IS NOT "hasPin" ANY MORE.
 *
 * It is "does this identity outlive a session" — true for a PIN, a password, a
 * linked provider, or simply a live `member_session` on the device. The old
 * name was only ever half the question, and multi-group turned that half into a
 * broken flow: a club's active session id is its own, so JOINING or SWITCHING
 * one changes it every time. An email member would join a club successfully and
 * be dropped back on the welcome doors, because the server had put them on the
 * roster and the client had wiped their identity before the page rendered.
 */
describe('durable identities survive a session boundary', () => {
  const stored = { name: 'Priya', sessionId: 'alpha:session-2026-09-11', token: 'tok' };

  it('preserves an email or Google member across a GROUP SWITCH', () => {
    // The new session id belongs to a different club. Nothing about that says
    // this person is no longer themselves.
    expect(resolveStaleIdentity(stored, 'beta:session-2026-09-18', true)).toEqual({
      action: 'preserve',
      identity: { name: 'Priya', sessionId: 'beta:session-2026-09-18' },
    });
  });

  it('drops the deleteToken when it preserves', () => {
    // The token was bound to the old session's player row. Carrying it forward
    // would be a live credential for a spot that no longer exists — the
    // strip-canary rule at rest.
    const result = resolveStaleIdentity(stored, 'beta:session-2026-09-18', true);
    expect(result.action).toBe('preserve');
    if (result.action === 'preserve') expect(result.identity.token).toBeUndefined();
  });

  it('still clears a genuinely anonymous sign-up', () => {
    // No durable credential: the identity WAS the session-player row, and that
    // row is stale. This half of the rule was always right.
    expect(resolveStaleIdentity(stored, 'beta:session-2026-09-18', false)).toEqual({ action: 'clear' });
  });
});
