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
