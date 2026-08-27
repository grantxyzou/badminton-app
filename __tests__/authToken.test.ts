import { describe, it, expect } from 'vitest';
import {
  createToken,
  checkToken,
  VERIFICATION_TTL_MS,
  RESET_TTL_MS,
} from '../lib/authToken';

describe('authToken', () => {
  it('round-trips a freshly created token', () => {
    const { token, record } = createToken(RESET_TTL_MS);
    expect(checkToken(token, record)).toBe(true);
  });

  it('never stores the raw token', () => {
    const { token, record } = createToken(RESET_TTL_MS);
    expect(record.hash).not.toBe(token);
    expect(record.hash).toMatch(/^[0-9a-f]{64}$/);
    expect(token).toMatch(/^[0-9a-f]{64}$/);
  });

  it('rejects a different token', () => {
    const { record } = createToken(RESET_TTL_MS);
    const other = createToken(RESET_TTL_MS);
    expect(checkToken(other.token, record)).toBe(false);
  });

  it('rejects an expired record', () => {
    const { token, record } = createToken(-1000); // already expired
    expect(checkToken(token, record)).toBe(false);
  });

  it('rejects absent or malformed records rather than throwing', () => {
    const { token } = createToken(RESET_TTL_MS);
    expect(checkToken(token, undefined)).toBe(false);
    expect(checkToken(token, null)).toBe(false);
    expect(checkToken(token, { hash: '', expiresAt: Date.now() + 1000 })).toBe(false);
    expect(checkToken(token, { hash: 'zz', expiresAt: Date.now() + 1000 })).toBe(false);
    expect(checkToken('', { hash: 'a'.repeat(64), expiresAt: Date.now() + 1000 })).toBe(false);
  });

  it('mints a distinct token every time', () => {
    const a = createToken(RESET_TTL_MS);
    const b = createToken(RESET_TTL_MS);
    expect(a.token).not.toBe(b.token);
    expect(a.record.hash).not.toBe(b.record.hash);
  });

  it('uses a longer window for verification than for password reset', () => {
    expect(VERIFICATION_TTL_MS).toBe(24 * 60 * 60 * 1000);
    expect(RESET_TTL_MS).toBe(60 * 60 * 1000);
    expect(VERIFICATION_TTL_MS).toBeGreaterThan(RESET_TTL_MS);
  });
});
