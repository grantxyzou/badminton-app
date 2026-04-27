import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import {
  issueCode,
  consumeCode,
  invalidateCode,
  __resetForTests,
} from '../lib/recoveryCodes';

describe('recoveryCodes', () => {
  beforeEach(() => {
    __resetForTests();
    vi.useFakeTimers();
  });
  afterEach(() => {
    vi.useRealTimers();
  });

  it('issues a 6-digit numeric code', async () => {
    const { code, expiresAt } = await issueCode('player-1', 'session-2026-04-27');
    expect(code).toMatch(/^[0-9]{6}$/);
    expect(expiresAt).toBeGreaterThan(Date.now());
  });

  it('consumes a valid code and returns true once', async () => {
    const { code } = await issueCode('player-1', 'session-2026-04-27');
    expect(await consumeCode('player-1', code)).toBe(true);
    expect(await consumeCode('player-1', code)).toBe(false);
  });

  it('rejects a wrong code without consuming', async () => {
    const { code } = await issueCode('player-1', 'session-2026-04-27');
    expect(await consumeCode('player-1', '999999')).toBe(false);
    expect(await consumeCode('player-1', code)).toBe(true);
  });

  it('rejects a code after 15 min', async () => {
    const { code } = await issueCode('player-1', 'session-2026-04-27');
    vi.advanceTimersByTime(15 * 60 * 1000 + 1);
    expect(await consumeCode('player-1', code)).toBe(false);
  });

  it('re-issuing for the same player invalidates the prior code', async () => {
    const first = await issueCode('player-1', 'session-2026-04-27');
    const second = await issueCode('player-1', 'session-2026-04-27');
    expect(first.code).not.toBe(second.code);
    expect(await consumeCode('player-1', first.code)).toBe(false);
    expect(await consumeCode('player-1', second.code)).toBe(true);
  });

  it('invalidateCode removes an active code', async () => {
    const { code } = await issueCode('player-1', 'session-2026-04-27');
    invalidateCode('player-1');
    expect(await consumeCode('player-1', code)).toBe(false);
  });
});
