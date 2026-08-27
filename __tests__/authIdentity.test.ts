import { describe, it, expect, beforeEach } from 'vitest';
import { resetMockStore } from './helpers';
import {
  normalizeEmail,
  identityId,
  lookupIdentity,
  reserveIdentity,
  releaseIdentity,
  listIdentitiesForMember,
} from '../lib/authIdentity';

beforeEach(() => resetMockStore());

describe('normalizeEmail', () => {
  it('lowercases and trims', () => {
    expect(normalizeEmail('  Grant@Example.COM ')).toBe('grant@example.com');
  });
  it('does not strip gmail dots or plus tags', () => {
    // Two different people can legitimately own these on non-Gmail hosts.
    expect(normalizeEmail('a.b+tag@example.com')).toBe('a.b+tag@example.com');
  });
});

describe('identityId', () => {
  it('namespaces by provider so a google sub cannot collide with an apple sub', () => {
    expect(identityId('google', '12345')).toBe('google:12345');
    expect(identityId('apple', '12345')).toBe('apple:12345');
    expect(identityId('email', 'A@B.com')).toBe('email:a@b.com');
  });
});

describe('reserveIdentity', () => {
  it('reserves an unused key and finds it again', async () => {
    const res = await reserveIdentity('google', 'sub-1', 'member-1');
    expect(res.ok).toBe(true);
    const found = await lookupIdentity('google', 'sub-1');
    expect(found?.memberId).toBe('member-1');
    expect(found?.provider).toBe('google');
  });

  it('refuses a key already taken by another member (atomic uniqueness)', async () => {
    await reserveIdentity('email', 'grant@example.com', 'member-1');
    const second = await reserveIdentity('email', 'GRANT@example.com', 'member-2');
    expect(second).toEqual({ ok: false, reason: 'taken' });
    expect((await lookupIdentity('email', 'grant@example.com'))?.memberId).toBe('member-1');
  });

  it('is idempotent when the same member re-reserves the same key', async () => {
    await reserveIdentity('google', 'sub-1', 'member-1');
    const again = await reserveIdentity('google', 'sub-1', 'member-1');
    expect(again.ok).toBe(true);
  });

  it('returns null for a key that was never reserved', async () => {
    expect(await lookupIdentity('apple', 'nope')).toBeNull();
  });
});

describe('releaseIdentity + listIdentitiesForMember', () => {
  it('lists every identity for one member and not other members', async () => {
    await reserveIdentity('google', 'sub-1', 'member-1');
    await reserveIdentity('email', 'grant@example.com', 'member-1');
    await reserveIdentity('apple', 'sub-2', 'member-2');
    const mine = await listIdentitiesForMember('member-1');
    expect(mine.map((i) => i.provider).sort()).toEqual(['email', 'google']);
  });

  it('frees the key so it can be reserved by someone else', async () => {
    await reserveIdentity('google', 'sub-1', 'member-1');
    await releaseIdentity('google', 'sub-1');
    expect(await lookupIdentity('google', 'sub-1')).toBeNull();
    expect((await reserveIdentity('google', 'sub-1', 'member-2')).ok).toBe(true);
  });
});
