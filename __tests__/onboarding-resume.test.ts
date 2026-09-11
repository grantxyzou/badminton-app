// @vitest-environment jsdom
import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import {
  markOnboardingResume,
  consumeOnboardingResume,
  pruneStaleOnboardingResume,
  clearOnboardingResume,
} from '../lib/onboardingResume';

/**
 * The record that carries "they were creating a group" across an OAuth hop.
 *
 * The two verbs that look redundant are the point of the file. `consume` is
 * destructive regardless of freshness so a marker cannot leak into a later
 * unrelated visit; `prune` removes ONLY an expired one so a second tab
 * reloading mid-excursion does not eat the record the first tab is about to
 * come back for. A single "read and clear" would collapse them and break the
 * two-tab case silently.
 */
const KEY = 'badminton_onboarding_resume';
const TTL_MS = 10 * 60 * 1000;

beforeEach(() => {
  window.localStorage.clear();
  vi.useRealTimers();
});

afterEach(() => {
  vi.useRealTimers();
});

describe('mark and consume', () => {
  it('round-trips a create intent', () => {
    markOnboardingResume('create');
    expect(consumeOnboardingResume()).toMatchObject({ intent: 'create' });
  });

  it('carries the invite token for a join', () => {
    markOnboardingResume('join', 'a'.repeat(32));
    expect(consumeOnboardingResume()).toMatchObject({ intent: 'join', token: 'a'.repeat(32) });
  });

  it('omits the token entirely for a create', () => {
    markOnboardingResume('create');
    expect(consumeOnboardingResume()).not.toHaveProperty('token');
  });

  it('is ONE-SHOT — a second read finds nothing', () => {
    markOnboardingResume('create');
    expect(consumeOnboardingResume()).not.toBeNull();
    expect(consumeOnboardingResume()).toBeNull();
  });

  it('clears the key even when the record is too old to return', () => {
    window.localStorage.setItem(KEY, JSON.stringify({ intent: 'create', at: Date.now() - TTL_MS - 1 }));
    expect(consumeOnboardingResume()).toBeNull();
    // The half that matters: a stale marker must not survive to be read again.
    expect(window.localStorage.getItem(KEY)).toBeNull();
  });
});

describe('the TTL boundary', () => {
  it('returns a record one millisecond inside the window', () => {
    window.localStorage.setItem(KEY, JSON.stringify({ intent: 'create', at: Date.now() - (TTL_MS - 1000) }));
    expect(consumeOnboardingResume()).not.toBeNull();
  });

  it('refuses one exactly at the window', () => {
    window.localStorage.setItem(KEY, JSON.stringify({ intent: 'create', at: Date.now() - TTL_MS }));
    expect(consumeOnboardingResume()).toBeNull();
  });
});

describe('malformed records are no record', () => {
  // Each of these could otherwise reach `setOnboarding(...)` and navigate
  // somebody somewhere on the strength of a corrupt string.
  it.each([
    ['not json at all', '{{{'],
    ['an unknown intent', JSON.stringify({ intent: 'delete-everything', at: Date.now() })],
    ['a missing intent', JSON.stringify({ at: Date.now() })],
    ['a missing timestamp', JSON.stringify({ intent: 'create' })],
    ['a non-numeric timestamp', JSON.stringify({ intent: 'create', at: 'soon' })],
    ['an infinite timestamp', JSON.stringify({ intent: 'create', at: Infinity })],
    ['a null body', 'null'],
  ])('%s', (_label, raw) => {
    window.localStorage.setItem(KEY, raw);
    expect(consumeOnboardingResume()).toBeNull();
  });

  it('drops a non-string token rather than passing it through', () => {
    window.localStorage.setItem(KEY, JSON.stringify({ intent: 'join', at: Date.now(), token: 42 }));
    const record = consumeOnboardingResume();
    expect(record).toMatchObject({ intent: 'join' });
    expect(record).not.toHaveProperty('token');
  });
});

describe('prune is NOT consume', () => {
  it('leaves a fresh record alone — the two-tab case', () => {
    markOnboardingResume('create');
    // A second tab reloads mid-excursion. It is not a sign-in landing, so it
    // prunes rather than consumes; the first tab must still find its record.
    pruneStaleOnboardingResume();
    expect(consumeOnboardingResume()).toMatchObject({ intent: 'create' });
  });

  it('removes an expired one', () => {
    window.localStorage.setItem(KEY, JSON.stringify({ intent: 'create', at: Date.now() - TTL_MS - 1 }));
    pruneStaleOnboardingResume();
    expect(window.localStorage.getItem(KEY)).toBeNull();
  });

  it('removes an unparseable one — nothing will ever read it successfully', () => {
    window.localStorage.setItem(KEY, 'not json');
    pruneStaleOnboardingResume();
    expect(window.localStorage.getItem(KEY)).toBeNull();
  });

  it('does nothing when there is no record', () => {
    expect(() => pruneStaleOnboardingResume()).not.toThrow();
    expect(window.localStorage.getItem(KEY)).toBeNull();
  });
});

describe('clear', () => {
  it('forgets a fresh record outright — deliberate abandonment', () => {
    markOnboardingResume('join', 'token');
    clearOnboardingResume();
    expect(consumeOnboardingResume()).toBeNull();
  });
});

describe('storage refusing to work is not a crash', () => {
  // Private mode, or a browser configured to block site data. The contract is
  // "no resume", which is exactly the behaviour before this file existed.
  it('survives a throwing localStorage on every verb', () => {
    const boom = () => {
      throw new Error('SecurityError');
    };
    const spies = [
      vi.spyOn(Storage.prototype, 'setItem').mockImplementation(boom),
      vi.spyOn(Storage.prototype, 'getItem').mockImplementation(boom),
      vi.spyOn(Storage.prototype, 'removeItem').mockImplementation(boom),
    ];
    expect(() => markOnboardingResume('create')).not.toThrow();
    expect(consumeOnboardingResume()).toBeNull();
    expect(() => pruneStaleOnboardingResume()).not.toThrow();
    expect(() => clearOnboardingResume()).not.toThrow();
    spies.forEach((s) => s.mockRestore());
  });
});
