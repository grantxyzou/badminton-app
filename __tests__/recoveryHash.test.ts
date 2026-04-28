import { describe, it, expect } from 'vitest';
import { hashPin, verifyPin, FAKE_HASH } from '../lib/recoveryHash';

describe('recoveryHash', () => {
  it('hashes a PIN and verifies it', async () => {
    const hash = await hashPin('1234');
    expect(hash).toMatch(/^[0-9a-f]+:[0-9a-f]+$/);
    expect(await verifyPin('1234', hash)).toBe(true);
    expect(await verifyPin('5678', hash)).toBe(false);
  });

  it('produces different hashes for the same PIN (salt)', async () => {
    const a = await hashPin('1234');
    const b = await hashPin('1234');
    expect(a).not.toBe(b);
    expect(await verifyPin('1234', a)).toBe(true);
    expect(await verifyPin('1234', b)).toBe(true);
  });

  it('FAKE_HASH never verifies any input', async () => {
    expect(await verifyPin('0000', FAKE_HASH)).toBe(false);
    expect(await verifyPin('1234', FAKE_HASH)).toBe(false);
  });

  it('rejects malformed hash strings', async () => {
    expect(await verifyPin('1234', 'not-a-hash')).toBe(false);
    expect(await verifyPin('1234', '')).toBe(false);
  });
});
