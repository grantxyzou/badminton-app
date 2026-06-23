import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import { issueRecoveryCode, verifyRecoveryCode } from '../lib/memberRecoveryCode';

describe('memberRecoveryCode', () => {
  beforeEach(() => {
    vi.useFakeTimers();
  });
  afterEach(() => {
    vi.useRealTimers();
  });

  it('issues a 6-digit numeric code with a future expiry', async () => {
    const { code, stored } = await issueRecoveryCode();
    expect(code).toMatch(/^[0-9]{6}$/);
    expect(stored.expiresAt).toBeGreaterThan(Date.now());
    expect(stored.hash).toContain(':');
  });

  it('verifies the matching code and rejects a wrong one', async () => {
    const { code, stored } = await issueRecoveryCode();
    expect(await verifyRecoveryCode(stored, code)).toBe(true);
    expect(await verifyRecoveryCode(stored, '000000')).toBe(false);
  });

  it('rejects a code after 15 min', async () => {
    const { code, stored } = await issueRecoveryCode();
    vi.advanceTimersByTime(15 * 60 * 1000 + 1);
    expect(await verifyRecoveryCode(stored, code)).toBe(false);
  });

  it('rejects when there is no stored code', async () => {
    expect(await verifyRecoveryCode(undefined, '123456')).toBe(false);
    expect(await verifyRecoveryCode(null, '123456')).toBe(false);
  });

  it('rejects a malformed stored record', async () => {
    // @ts-expect-error — intentionally malformed
    expect(await verifyRecoveryCode({ hash: 123, expiresAt: 'soon' }, '123456')).toBe(false);
  });
});
