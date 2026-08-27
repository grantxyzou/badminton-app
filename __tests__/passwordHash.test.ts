import { describe, it, expect } from 'vitest';
import {
  hashPassword,
  verifyPassword,
  validatePasswordStrength,
  FAKE_PASSWORD_HASH,
} from '../lib/passwordHash';

describe('passwordHash', () => {
  it('round-trips a password', async () => {
    const stored = await hashPassword('correct horse battery');
    expect(await verifyPassword('correct horse battery', stored)).toBe(true);
    expect(await verifyPassword('wrong horse battery', stored)).toBe(false);
  });

  it('stores parameters in the hash so they can change later', async () => {
    const stored = await hashPassword('correct horse battery');
    const [scheme, n, r, p, salt, hash] = stored.split('$');
    expect(scheme).toBe('scrypt');
    expect(Number(n)).toBe(65536);
    expect(Number(r)).toBe(8);
    expect(Number(p)).toBe(1);
    expect(salt).toMatch(/^[0-9a-f]{32}$/);
    expect(hash).toMatch(/^[0-9a-f]{64}$/);
  });

  it('salts, so two hashes of the same password differ', async () => {
    expect(await hashPassword('same password here')).not.toBe(
      await hashPassword('same password here'),
    );
  });

  it('returns false for malformed stored values instead of throwing', async () => {
    for (const bad of ['', 'garbage', 'scrypt$1$2$3', 'scrypt$x$8$1$aa$bb', 'a:b']) {
      expect(await verifyPassword('anything', bad)).toBe(false);
    }
  });

  it('never matches against FAKE_PASSWORD_HASH', async () => {
    expect(await verifyPassword('anything at all', FAKE_PASSWORD_HASH)).toBe(false);
    expect(FAKE_PASSWORD_HASH.startsWith('scrypt$')).toBe(true);
  });

  it('rejects short and common passwords', () => {
    expect(validatePasswordStrength('short').ok).toBe(false);
    expect(validatePasswordStrength('password').ok).toBe(false);
    expect(validatePasswordStrength('12345678901').ok).toBe(false);
    expect(validatePasswordStrength('correct horse battery').ok).toBe(true);
  });
});
