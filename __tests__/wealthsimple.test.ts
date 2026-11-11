import { describe, it, expect } from 'vitest';
import { isWealthsimpleHandle, normalizeWealthsimpleHandle } from '@/lib/wealthsimple';

describe('Wealthsimple handle', () => {
  it('normalizes to a leading $', () => {
    expect(normalizeWealthsimpleHandle('grantxyzou')).toBe('$grantxyzou');
    expect(normalizeWealthsimpleHandle('  $grant.xyz_ou-1 ')).toBe('$grant.xyz_ou-1');
  });

  it('refuses what is not a handle', () => {
    expect(normalizeWealthsimpleHandle('')).toBeNull();
    expect(normalizeWealthsimpleHandle('grant zou')).toBeNull();
    expect(normalizeWealthsimpleHandle('$' + 'a'.repeat(31))).toBeNull();
    expect(normalizeWealthsimpleHandle('<script>')).toBeNull();
  });

  it('accepts only the stored (normalized) form', () => {
    expect(isWealthsimpleHandle('$grantxyzou')).toBe(true);
    expect(isWealthsimpleHandle('grantxyzou')).toBe(false);
    expect(isWealthsimpleHandle(42)).toBe(false);
  });
});
