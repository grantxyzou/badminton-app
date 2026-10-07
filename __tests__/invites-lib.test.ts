import { describe, it, expect, beforeEach } from 'vitest';
import { resetMockStore, getStore, seedGroup } from './helpers';
import {
  claimInvite,
  INVITE_TTL_MS,
  listInvites,
  mintInvite,
  resolveInvite,
  revokeInvite,
} from '../lib/invites';
import { readGroup } from '../lib/groups';

/**
 * One-time invites (docs/plans/one-time-invites.md). Grant, 2026-10-06:
 * "lets make it one time used link." Each invite is a link and a code that
 * work once, for seven days, and the club record's list of live invites is
 * the authority: an invite is live while it is listed and unexpired, and
 * claiming one removes it under an etag condition.
 */
const NOW = Date.parse('2026-10-06T12:00:00.000Z');
const at = (ms: number) => new Date(NOW + ms).toISOString();

const docs = () => (getStore()['groups'] ?? []) as Array<Record<string, unknown>>;
const doc = (id: string) => docs().find((d) => d.id === id);

beforeEach(() => {
  resetMockStore();
  seedGroup('bpm', { name: 'BPM Badminton' });
});

describe('mintInvite', () => {
  it('mints a link and a code that both resolve, listed on the club, expiring in 7 days', async () => {
    const inv = await mintInvite('bpm', 'admin', NOW);
    expect(inv).not.toBeNull();
    expect(inv!.token).toMatch(/^[0-9a-f]{32}$/);
    expect(inv!.code).toHaveLength(8);
    expect(inv!.expiresAt).toBe(at(INVITE_TTL_MS));
    expect(await resolveInvite(inv!.token, 'invite', NOW)).toBe('bpm');
    expect(await resolveInvite(inv!.code, 'code', NOW)).toBe('bpm');
    const group = await readGroup('bpm');
    expect(group?.invites).toHaveLength(1);
    expect(group?.invites?.[0]).toMatchObject({ id: inv!.id, expiresAt: inv!.expiresAt });
    // The legacy club-wide pointers are never written again.
    expect(group?.inviteId).toBeUndefined();
  });

  it('every mint is a NEW invite; the earlier ones stay live', async () => {
    const a = await mintInvite('bpm', 'admin', NOW);
    const b = await mintInvite('bpm', 'admin', NOW + 1000);
    expect(a!.token).not.toBe(b!.token);
    expect(await resolveInvite(a!.token, 'invite', NOW + 2000)).toBe('bpm');
    expect(await resolveInvite(b!.token, 'invite', NOW + 2000)).toBe('bpm');
    expect(await listInvites('bpm', NOW + 2000)).toHaveLength(2);
  });

  it('refuses for a closed or unknown club', async () => {
    seedGroup('gone', { closedAt: '2026-01-02T00:00:00.000Z' });
    expect(await mintInvite('gone', 'admin', NOW)).toBeNull();
    expect(await mintInvite('nope', 'admin', NOW)).toBeNull();
  });

  it('prunes expired entries from the list as it goes', async () => {
    await mintInvite('bpm', 'admin', NOW - INVITE_TTL_MS - 1);
    await mintInvite('bpm', 'admin', NOW);
    expect((await readGroup('bpm'))?.invites).toHaveLength(1);
  });
});

describe('resolveInvite', () => {
  it('answers null for an unknown secret, the wrong kind, and a closed club', async () => {
    const inv = await mintInvite('bpm', 'admin', NOW);
    expect(await resolveInvite('0'.repeat(32), 'invite', NOW)).toBeNull();
    expect(await resolveInvite(inv!.code, 'invite', NOW)).toBeNull();
    expect(await resolveInvite(inv!.token, 'code', NOW)).toBeNull();
    const group = (await readGroup('bpm'))!;
    getStore()['groups'] = docs().map((d) => (d.id === 'bpm' ? { ...group, closedAt: at(0) } : d));
    expect(await resolveInvite(inv!.token, 'invite', NOW)).toBeNull();
  });

  it('answers null once the invite has expired', async () => {
    const inv = await mintInvite('bpm', 'admin', NOW);
    expect(await resolveInvite(inv!.token, 'invite', NOW + INVITE_TTL_MS - 1)).toBe('bpm');
    expect(await resolveInvite(inv!.token, 'invite', NOW + INVITE_TTL_MS)).toBeNull();
    expect(await resolveInvite(inv!.code, 'code', NOW + INVITE_TTL_MS)).toBeNull();
  });

  it('refuses the LEGACY club-wide pair: a doc with no pairId, pointed at by inviteId', async () => {
    // What production holds from before 2026-10-06. Nobody minted it one-time,
    // so nothing on the list names it, and it is dead on deploy by design.
    const { createHash } = await import('crypto');
    const token = 'a'.repeat(32);
    const id = `invite:${createHash('sha256').update(token).digest('hex')}`;
    docs().push({ id, kind: 'invite', groupId: 'bpm', secret: token, createdAt: at(-1), createdBy: 'admin' });
    const group = (await readGroup('bpm'))!;
    getStore()['groups'] = docs().map((d) => (d.id === 'bpm' ? { ...group, inviteId: id } : d));
    expect(await resolveInvite(token, 'invite', NOW)).toBeNull();
  });
});

describe('claimInvite — used once', () => {
  it('claims by link: the invite leaves the list and neither the link nor the code resolves again', async () => {
    const inv = await mintInvite('bpm', 'admin', NOW);
    const claim = await claimInvite(inv!.token, 'invite', NOW);
    expect(claim?.groupId).toBe('bpm');
    expect(await resolveInvite(inv!.token, 'invite', NOW)).toBeNull();
    expect(await resolveInvite(inv!.code, 'code', NOW)).toBeNull();
    expect(await claimInvite(inv!.token, 'invite', NOW)).toBeNull();
    expect((await readGroup('bpm'))?.invites).toEqual([]);
  });

  it('claims by code the same way', async () => {
    const inv = await mintInvite('bpm', 'admin', NOW);
    expect((await claimInvite(inv!.code, 'code', NOW))?.groupId).toBe('bpm');
    expect(await claimInvite(inv!.code, 'code', NOW)).toBeNull();
    expect(await resolveInvite(inv!.token, 'invite', NOW)).toBeNull();
  });

  it('release() puts a claimed invite back, so a sign-up refused for another reason does not burn it', async () => {
    const inv = await mintInvite('bpm', 'admin', NOW);
    const claim = (await claimInvite(inv!.token, 'invite', NOW))!;
    await claim.release();
    expect(await resolveInvite(inv!.token, 'invite', NOW)).toBe('bpm');
    expect(await resolveInvite(inv!.code, 'code', NOW)).toBe('bpm');
    expect((await claimInvite(inv!.token, 'invite', NOW))?.groupId).toBe('bpm');
  });

  it('finalize() records who used it and drops the plaintext from both docs', async () => {
    const inv = await mintInvite('bpm', 'admin', NOW);
    const claim = (await claimInvite(inv!.token, 'invite', NOW))!;
    await claim.finalize('member-x', NOW + 5);
    const link = doc(inv!.id)!;
    expect(link.usedBy).toBe('member-x');
    expect(link.usedAt).toBe(at(5));
    expect(link.secret).toBeUndefined();
    const code = docs().find((d) => d.kind === 'code' && d.pairId === inv!.id)!;
    expect(code.secret).toBeUndefined();
    expect(code.usedBy).toBe('member-x');
  });

  it('two sign-ups racing on one link: exactly one gets in', async () => {
    const inv = await mintInvite('bpm', 'admin', NOW);
    const [a, b] = await Promise.all([claimInvite(inv!.token, 'invite', NOW), claimInvite(inv!.code, 'code', NOW)]);
    expect([a, b].filter(Boolean)).toHaveLength(1);
  });

  it('an expired invite cannot be claimed', async () => {
    const inv = await mintInvite('bpm', 'admin', NOW);
    expect(await claimInvite(inv!.token, 'invite', NOW + INVITE_TTL_MS)).toBeNull();
  });
});

describe('listInvites and revokeInvite', () => {
  it('lists the live ones with their secrets, newest first, and not the expired or the used', async () => {
    const old = await mintInvite('bpm', 'admin', NOW - INVITE_TTL_MS - 1);
    const a = await mintInvite('bpm', 'admin', NOW - 1000);
    const b = await mintInvite('bpm', 'admin', NOW);
    const used = await mintInvite('bpm', 'admin', NOW);
    await (await claimInvite(used!.token, 'invite', NOW))!.finalize('m', NOW);
    const list = await listInvites('bpm', NOW);
    expect(list.map((i) => i.id)).toEqual([b!.id, a!.id]);
    expect(list[0].token).toBe(b!.token);
    expect(list[0].code).toBe(b!.code);
    expect(list.map((i) => i.id)).not.toContain(old!.id);
  });

  it('revoke removes one invite and leaves the others', async () => {
    const a = await mintInvite('bpm', 'admin', NOW);
    const b = await mintInvite('bpm', 'admin', NOW);
    expect(await revokeInvite('bpm', a!.id)).toBe(true);
    expect(await resolveInvite(a!.token, 'invite', NOW)).toBeNull();
    expect(await resolveInvite(a!.code, 'code', NOW)).toBeNull();
    expect(await resolveInvite(b!.token, 'invite', NOW)).toBe('bpm');
    expect(await revokeInvite('bpm', a!.id)).toBe(false);
    expect(doc(a!.id)).toBeUndefined();
  });

  it('a revoke names an id the club does not hold → false, nothing touched', async () => {
    seedGroup('other');
    const a = await mintInvite('bpm', 'admin', NOW);
    expect(await revokeInvite('other', a!.id)).toBe(false);
    expect(await resolveInvite(a!.token, 'invite', NOW)).toBe('bpm');
  });
});
