import { describe, it, expect, beforeEach } from 'vitest';
import { resetMockStore, getStore } from './helpers';
import {
  mintMigration,
  claimMigration,
  isLinkCode,
  isShortCode,
  MIGRATION_TTL_MS,
} from '../lib/authMigration';

/**
 * The stash that carries a PWA identity into the native shell. What must hold:
 * codes are never stored in clear, either code claims, a claim burns BOTH,
 * expiry is real, and absent / expired / used are one indistinguishable answer.
 */
const LIN = { id: 'member-lin', name: 'Lin' };

function docs() {
  return (getStore()['authmigration'] ?? []) as Array<{ id: string; kind: string; sibling: string }>;
}

beforeEach(() => {
  resetMockStore();
});

describe('mint', () => {
  it('returns a 64-hex link code and a 6-digit short code, stored only as hashes', async () => {
    const m = await mintMigration(LIN, 'zh-CN');
    expect(isLinkCode(m.linkCode)).toBe(true);
    expect(isShortCode(m.shortCode)).toBe(true);
    expect(Date.parse(m.expiresAt) - Date.now()).toBeLessThanOrEqual(MIGRATION_TTL_MS);

    const all = docs();
    expect(all).toHaveLength(2);
    const raw = JSON.stringify(all);
    expect(raw).not.toContain(m.linkCode);
    expect(raw).not.toContain(m.shortCode);
    // Siblings point at each other.
    const [a, b] = all;
    expect(a!.sibling).toBe(b!.id);
    expect(b!.sibling).toBe(a!.id);
  });
});

describe('claim', () => {
  it('the link code claims, and burns the short code with it', async () => {
    const m = await mintMigration(LIN, undefined);
    const out = await claimMigration({ link: m.linkCode });
    expect(out).toEqual({ status: 'ready', memberId: LIN.id, name: LIN.name });
    expect(docs()).toHaveLength(0);
    expect(await claimMigration({ name: 'Lin', short: m.shortCode })).toEqual({ status: 'none' });
  });

  it('the short code claims (case-insensitive name), and burns the link with it', async () => {
    const m = await mintMigration(LIN, 'zh-CN');
    const out = await claimMigration({ name: '  lin ', short: m.shortCode });
    expect(out).toEqual({ status: 'ready', memberId: LIN.id, name: LIN.name, locale: 'zh-CN' });
    expect(docs()).toHaveLength(0);
    expect(await claimMigration({ link: m.linkCode })).toEqual({ status: 'none' });
  });

  it('a second claim of the same code finds nothing', async () => {
    const m = await mintMigration(LIN, undefined);
    await claimMigration({ link: m.linkCode });
    expect(await claimMigration({ link: m.linkCode })).toEqual({ status: 'none' });
  });

  it('the short code is namespaced by name — the wrong name does not claim', async () => {
    const m = await mintMigration(LIN, undefined);
    expect(await claimMigration({ name: 'Viktor', short: m.shortCode })).toEqual({ status: 'none' });
    // And the stash is still there for the right person.
    expect(docs()).toHaveLength(2);
  });

  it('expires after the TTL', async () => {
    const now = Date.now();
    const m = await mintMigration(LIN, undefined, now);
    expect(await claimMigration({ link: m.linkCode }, now + MIGRATION_TTL_MS + 1)).toEqual({ status: 'none' });
    // An expired stash is not deleted by a failed claim, but it is also not
    // redeemable — same answer as absent.
  });

  it('rejects malformed input without touching the store', async () => {
    await mintMigration(LIN, undefined);
    for (const input of [
      { link: 'nope' },
      { link: 'A'.repeat(64) },
      { name: 'Lin', short: '12345' },
      { name: 'Lin', short: 'abcdef' },
      { name: '', short: '123456' },
    ]) {
      expect(await claimMigration(input as never)).toEqual({ status: 'none' });
    }
    expect(docs()).toHaveLength(2);
  });

  it('two members\' short codes cannot collide by number alone', async () => {
    // Force the same digits for both by retrying mints until they match is
    // not deterministic; instead assert the id derivation includes the name.
    const a = await mintMigration(LIN, undefined);
    const b = await mintMigration({ id: 'member-viktor', name: 'Viktor' }, undefined);
    // Viktor's digits with Lin's name resolves nothing, regardless of value.
    expect(await claimMigration({ name: 'Lin', short: b.shortCode })).toEqual(
      a.shortCode === b.shortCode
        ? { status: 'ready', memberId: LIN.id, name: LIN.name }
        : { status: 'none' },
    );
  });
});
