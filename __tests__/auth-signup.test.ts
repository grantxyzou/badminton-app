import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import { resetMockStore, seedMember, getStore, makeRequest } from './helpers';
import { POST } from '../app/api/auth/signup/route';
import { lookupIdentity } from '../lib/authIdentity';
import { verifyPassword } from '../lib/passwordHash';

const URL_ = 'http://localhost:3000/bpm/api/auth/signup';

beforeEach(() => {
  resetMockStore();
  process.env.NEXT_PUBLIC_FLAG_AUTH_PROVIDERS = 'true';
});

afterEach(() => {
  vi.restoreAllMocks();
  delete process.env.NEXT_PUBLIC_FLAG_AUTH_PROVIDERS;
});

function body(over: Record<string, unknown> = {}) {
  return {
    name: 'Carolina',
    email: 'carolina@example.com',
    password: 'a good long password',
    ...over,
  };
}

describe('POST /api/auth/signup', () => {
  it('creates the member, reserves the email, and signs them in', async () => {
    const res = await POST(makeRequest('POST', URL_, body()));
    expect(res.status).toBe(201);

    const identity = await lookupIdentity('email', 'carolina@example.com');
    expect(identity).not.toBeNull();

    const member = getStore()['members'].find(
      (m) => (m as { id: string }).id === identity!.memberId,
    ) as Record<string, unknown>;
    expect(member.name).toBe('Carolina');
    expect(member.email).toBe('carolina@example.com');
    expect(member.emailVerified).toBe(false);
    expect(await verifyPassword('a good long password', member.passwordHash as string)).toBe(true);

    expect(res.headers.getSetCookie().join('\n')).toMatch(/member_session=[^;]+;/);
  });

  it('never returns a secret in the response body', async () => {
    const res = await POST(makeRequest('POST', URL_, body()));
    const text = JSON.stringify(await res.json());
    for (const secret of ['passwordHash', 'emailVerification', 'passwordReset', 'pinHash']) {
      expect(text).not.toContain(secret);
    }
  });

  it('normalizes the email so case cannot create a second account', async () => {
    await POST(makeRequest('POST', URL_, body()));
    const res = await POST(
      makeRequest('POST', URL_, body({ name: 'Someone Else', email: 'CAROLINA@Example.com' })),
    );
    expect(res.status).toBe(409);
    expect((await res.json()).error).toBe('email_taken');
  });

  it('refuses to attach to an existing name (names are enumerable, not proof)', async () => {
    seedMember('Lin', { pinHash: 'x' });
    const res = await POST(
      makeRequest('POST', URL_, body({ name: 'lin', email: 'imposter@example.com' })),
    );
    expect(res.status).toBe(409);
    expect((await res.json()).error).toBe('name_taken');
    // and the email must NOT stay reserved after the refusal
    expect(await lookupIdentity('email', 'imposter@example.com')).toBeNull();
  });

  it('rejects a weak password and a malformed email', async () => {
    const weak = await POST(makeRequest('POST', URL_, body({ password: 'short' })));
    expect(weak.status).toBe(400);
    const bad = await POST(makeRequest('POST', URL_, body({ email: 'not-an-email' })));
    expect(bad.status).toBe(400);
  });

  it('releases the email reservation when the member write fails', async () => {
    // The write-ordering guarantee: reserve-first means a partial failure
    // leaves an orphan reservation that would block a real signup forever.
    // The catch must free it.
    const cosmos = await import('../lib/cosmos');
    const real = cosmos.getContainer;
    vi.spyOn(cosmos, 'getContainer').mockImplementation((name: string) => {
      if (name !== 'members') return real(name);
      const c = real(name) as unknown as Record<string, unknown>;
      return {
        ...c,
        items: {
          ...(c.items as Record<string, unknown>),
          create: async () => {
            throw new Error('cosmos exploded');
          },
          upsert: async () => {
            throw new Error('cosmos exploded');
          },
        },
        // eslint-disable-next-line @typescript-eslint/no-explicit-any
      } as any;
    });

    const res = await POST(makeRequest('POST', URL_, body({ email: 'orphan@example.com' })));
    expect(res.status).toBe(503);
    expect(await lookupIdentity('email', 'orphan@example.com')).toBeNull();
  });

  it('404s when the flag is off, so a client flag flip cannot reach the database', async () => {
    process.env.NEXT_PUBLIC_FLAG_AUTH_PROVIDERS = 'false';
    const res = await POST(makeRequest('POST', URL_, body()));
    expect(res.status).toBe(404);
  });
});
