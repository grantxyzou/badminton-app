import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import { NextRequest } from 'next/server';
import { resetMockStore, seedMember, setupAdminPin, memberCookieValue, getStore } from './helpers';
import { DELETE } from '../app/api/auth/identity/route';
import { lookupIdentity, reserveIdentity } from '../lib/authIdentity';
import { hashPin } from '../lib/recoveryHash';

/**
 * Disconnecting a provider.
 *
 * The rule that matters: a member must always keep at least ONE way back in.
 * Removing the last credential is a self-inflicted lockout with no recovery
 * path short of an admin-issued code, and the person doing it has no way to
 * know that at the moment they tap Disconnect.
 */
const URL_ = 'http://localhost:3000/bpm/api/auth/identity';
let ipSeq = 0;

beforeEach(() => {
  resetMockStore();
  setupAdminPin();
  process.env.NEXT_PUBLIC_FLAG_AUTH_PROVIDERS = 'true';
});
afterEach(() => {
  delete process.env.NEXT_PUBLIC_FLAG_AUTH_PROVIDERS;
});

function req(body: Record<string, unknown>, cookie?: string): NextRequest {
  const headers: Record<string, string> = {
    'Content-Type': 'application/json',
    'X-Client-IP': `10.17.${Math.floor(ipSeq / 250)}.${ipSeq++ % 250}`,
  };
  if (cookie) headers.Cookie = cookie;
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  return new NextRequest(URL_, { method: 'DELETE', headers, body: JSON.stringify(body) } as any);
}

function asMember(name: string, id: string): string {
  return `member_session=${memberCookieValue(name, id)}`;
}

function stored(id: string) {
  return (getStore()['members'] as Array<Record<string, unknown>>).find((m) => m.id === id)!;
}

describe('DELETE /api/auth/identity', () => {
  it('disconnects a provider when another credential remains', async () => {
    const m = seedMember('Lin', { pinHash: await hashPin('1234'), linkedProviders: ['google'] });
    await reserveIdentity('google', 'sub-lin', m.id);

    const res = await DELETE(req({ provider: 'google' }, asMember('Lin', m.id)));
    expect(res.status).toBe(200);
    expect(await lookupIdentity('google', 'sub-lin')).toBeNull();
    expect(stored(m.id).linkedProviders).toEqual([]);
  });

  it('REFUSES to remove the only way back in', async () => {
    // No PIN, no password, one provider. Removing it locks them out entirely.
    const m = seedMember('Kento', { linkedProviders: ['google'] });
    await reserveIdentity('google', 'sub-kento', m.id);

    const res = await DELETE(req({ provider: 'google' }, asMember('Kento', m.id)));
    expect(res.status).toBe(409);
    expect((await res.json()).error).toBe('last_credential');
    expect((await lookupIdentity('google', 'sub-kento'))?.memberId).toBe(m.id);
  });

  it('allows it when a password is the remaining credential', async () => {
    const m = seedMember('Akane', {
      passwordHash: 'scrypt$65536$8$1$aa$bb',
      linkedProviders: ['google'],
    });
    await reserveIdentity('google', 'sub-akane', m.id);
    const res = await DELETE(req({ provider: 'google' }, asMember('Akane', m.id)));
    expect(res.status).toBe(200);
  });

  it('allows it when another provider remains', async () => {
    const m = seedMember('Sindhu', { linkedProviders: ['google', 'apple'] });
    await reserveIdentity('google', 'sub-s-g', m.id);
    await reserveIdentity('apple', 'sub-s-a', m.id);

    const res = await DELETE(req({ provider: 'google' }, asMember('Sindhu', m.id)));
    expect(res.status).toBe(200);
    expect(stored(m.id).linkedProviders).toEqual(['apple']);
    expect((await lookupIdentity('apple', 'sub-s-a'))?.memberId).toBe(m.id);
  });

  it('refuses an anonymous caller', async () => {
    const m = seedMember('Lin', { pinHash: await hashPin('1234'), linkedProviders: ['google'] });
    await reserveIdentity('google', 'sub-lin', m.id);
    const res = await DELETE(req({ provider: 'google' }));
    expect(res.status).toBe(401);
    expect(await lookupIdentity('google', 'sub-lin')).not.toBeNull();
  });

  it("cannot disconnect another member's provider", async () => {
    // Identity comes from the cookie, never the body. There is no memberId
    // parameter to abuse.
    const me = seedMember('Lin', { pinHash: await hashPin('1234') });
    const other = seedMember('Viktor', {
      pinHash: await hashPin('5678'),
      linkedProviders: ['google'],
    });
    await reserveIdentity('google', 'sub-viktor', other.id);

    const res = await DELETE(
      req({ provider: 'google', memberId: other.id }, asMember('Lin', me.id)),
    );
    // Lin has no google link of her own, so there is nothing to remove.
    expect(res.status).toBe(404);
    expect((await lookupIdentity('google', 'sub-viktor'))?.memberId).toBe(other.id);
  });

  it('404s when that provider was never linked', async () => {
    const m = seedMember('Lin', { pinHash: await hashPin('1234') });
    const res = await DELETE(req({ provider: 'apple' }, asMember('Lin', m.id)));
    expect(res.status).toBe(404);
  });

  it('rejects a provider name it does not recognise', async () => {
    const m = seedMember('Lin', { pinHash: await hashPin('1234') });
    const res = await DELETE(req({ provider: 'facebook' }, asMember('Lin', m.id)));
    expect(res.status).toBe(400);
  });

  it('leaves the email reservation alone', async () => {
    // Unlinking Google must not surrender the address the password login uses.
    const m = seedMember('Grant', {
      email: 'grant@example.com',
      emailVerified: true,
      passwordHash: 'scrypt$65536$8$1$aa$bb',
      linkedProviders: ['google'],
    });
    await reserveIdentity('email', 'grant@example.com', m.id);
    await reserveIdentity('google', 'sub-grant', m.id);

    await DELETE(req({ provider: 'google' }, asMember('Grant', m.id)));
    expect((await lookupIdentity('email', 'grant@example.com'))?.memberId).toBe(m.id);
    expect(stored(m.id).email).toBe('grant@example.com');
  });

  it('404s when the flag is off', async () => {
    const m = seedMember('Lin', { pinHash: await hashPin('1234'), linkedProviders: ['google'] });
    await reserveIdentity('google', 'sub-lin', m.id);
    process.env.NEXT_PUBLIC_FLAG_AUTH_PROVIDERS = 'false';
    const res = await DELETE(req({ provider: 'google' }, asMember('Lin', m.id)));
    expect(res.status).toBe(404);
  });
});
