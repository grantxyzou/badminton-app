import { describe, it, expect } from 'vitest';
import { methodsSummary } from '@/components/auth/useSignInMethods';

const labels = { pin: 'PIN', email: 'Email' };

describe('methodsSummary', () => {
  it('names a provider once, even with two accounts of it linked', () => {
    expect(
      methodsSummary({ linked: ['google', 'google'], hasPin: true, hasPassword: false } as never, labels),
    ).toBe('PIN · Google');
  });

  it('names an email a code can go to, with no password (one-way-in step 3)', () => {
    expect(methodsSummary({ linked: [], hasPin: false, hasPassword: false, hasEmailCode: true } as never, labels)).toBe('Email');
  });

  it('is undefined while unknown', () => {
    expect(methodsSummary(null, labels)).toBeUndefined();
  });
});
