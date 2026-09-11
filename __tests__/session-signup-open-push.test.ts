import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import {
  resetMockStore,
  getStore,
  setupAdminPin,
  seedAdminMember,
  seedTestAdminMember,
  seedGroup,
  seedMember,
  seedMembership,
  seedSession,
  makeAdminRequest,
  makeRequest,
} from './helpers';

/**
 * The sign-up-open trigger.
 *
 * Mocks `@/lib/push` rather than `web-push`: at this layer what matters is
 * WHETHER a send was attempted and how often, not how it was transported.
 */
const sendPushToMembers = vi.fn();
const sendPushToAll = vi.fn();
vi.mock('@/lib/push', () => ({
  sendPushToMembers: (...args: unknown[]) => sendPushToMembers(...args),
  sendPushToAll: (...args: unknown[]) => sendPushToAll(...args),
  isPushConfigured: () => true,
  safeTag: (s: string | undefined) => s,
  ensurePushContainer: vi.fn(),
  hashEndpoint: (s: string) => s,
}));

const { PUT } = await import('../app/api/session/route');

const BASE = 'http://localhost:3000/api/session';

function put(body: Record<string, unknown>) {
  return PUT(makeAdminRequest('PUT', BASE, body));
}

function sessionDoc(): Record<string, unknown> | undefined {
  const docs = (getStore()['sessions'] ?? []) as Record<string, unknown>[];
  return docs.find((d) => d.id === 'current-session');
}

describe('PUT /api/session — sign-up-open push trigger', () => {
  beforeEach(() => {
    resetMockStore();
    setupAdminPin();
    // PUT /api/session gates on isAdminAuthedWithMember, which re-reads the
    // member doc — the cookie alone is not enough.
    seedAdminMember();
    sendPushToMembers.mockReset();
    sendPushToAll.mockReset();
    sendPushToMembers.mockResolvedValue({ configured: true, sent: 3, failed: 0, removed: 0 });
  });

  describe('edge detection', () => {
    it('fires once on a false -> true flip and stamps the session', async () => {
      seedSession('current-session', { signupOpen: false });

      const res = await put({ signupOpen: true });
      expect(res.status).toBe(200);

      expect(sendPushToMembers).toHaveBeenCalledTimes(1);
      const payload = sendPushToMembers.mock.calls[0][1];
      expect(payload.title).toBe('Sign-ups are open');
      expect(sessionDoc()?.signupOpenNotifiedAt).toBeTruthy();
      expect(sessionDoc()?.signupOpenedAt).toBeTruthy();
    });

    it('does NOT fire on true -> true', async () => {
      seedSession('current-session', { signupOpen: true });
      await put({ signupOpen: true });
      expect(sendPushToMembers).not.toHaveBeenCalled();
      expect(sendPushToAll).not.toHaveBeenCalled();
    });

    it('does NOT fire on true -> false', async () => {
      seedSession('current-session', { signupOpen: true });
      await put({ signupOpen: false });
      expect(sendPushToMembers).not.toHaveBeenCalled();
      expect(sendPushToAll).not.toHaveBeenCalled();
    });

    it('does NOT fire when signupOpen is absent (absent means open)', async () => {
      // CLAUDE.md: an absent signupOpen reads as OPEN, so absent -> true is not
      // an edge. A looser `!== true` check would misfire on legacy docs.
      seedSession('current-session', {});
      delete sessionDoc()!.signupOpen;

      await put({ signupOpen: true });
      expect(sendPushToMembers).not.toHaveBeenCalled();
      expect(sendPushToAll).not.toHaveBeenCalled();
    });

    it('does NOT fire when the PUT does not touch signupOpen', async () => {
      seedSession('current-session', { signupOpen: false });
      await put({ title: 'Thursday Badminton' });
      expect(sendPushToMembers).not.toHaveBeenCalled();
      expect(sendPushToAll).not.toHaveBeenCalled();
    });
  });

  describe('idempotency', () => {
    it('fires exactly once across close -> open -> close -> open', async () => {
      seedSession('current-session', { signupOpen: false });

      await put({ signupOpen: true });
      await put({ signupOpen: false });
      await put({ signupOpen: true });

      expect(sendPushToMembers).toHaveBeenCalledTimes(1);
    });

    it('keeps the original signupOpenedAt across a reopen', async () => {
      seedSession('current-session', { signupOpen: false });
      await put({ signupOpen: true });
      const firstOpenedAt = sessionDoc()?.signupOpenedAt;

      await put({ signupOpen: false });
      await put({ signupOpen: true });

      expect(sessionDoc()?.signupOpenedAt).toBe(firstOpenedAt);
    });
  });

  describe('auth', () => {
    it('rejects a non-admin PUT before any push', async () => {
      seedSession('current-session', { signupOpen: false });
      const res = await PUT(makeRequest('PUT', BASE, { signupOpen: true }));
      expect(res.status).toBe(401);
      expect(sendPushToMembers).not.toHaveBeenCalled();
      expect(sendPushToAll).not.toHaveBeenCalled();
    });
  });

  describe('never fail the caller', () => {
    it('still returns 200 and persists signupOpen when the push throws', async () => {
      seedSession('current-session', { signupOpen: false });
      sendPushToMembers.mockRejectedValue(new Error('push service down'));

      const res = await put({ signupOpen: true });

      expect(res.status).toBe(200);
      expect((await res.json()).signupOpen).toBe(true);
      expect(sessionDoc()?.signupOpen).toBe(true);
    });
  });

  describe('read-merge preservation', () => {
    it('does not wipe fields the client never sent while stamping', async () => {
      seedSession('current-session', {
        signupOpen: false,
        approvedNames: ['Lin', 'Viktor'],
        settled: { at: '2026-08-01T00:00:00Z', costPerPerson: 12, totalCost: 144 },
      });

      await put({ signupOpen: true });

      const doc = sessionDoc()!;
      expect(doc.approvedNames).toEqual(['Lin', 'Viktor']);
      expect(doc.settled).toBeTruthy();
      expect(doc.signupOpenNotifiedAt).toBeTruthy();
    });
  });

/**
 * THE NARROWING (Phase 3). `pushSubscriptions` is PERSON-scoped — one doc per
 * device, and a person can be in two clubs — so no field on the row separates
 * these. The recipient list has to come from the ROSTER, and this is the case
 * that proves it: a second club exists with its own member, and the club that
 * opened sign-ups must not reach them.
 *
 * It asserts on the ids passed to `sendPushToMembers`, not on what was
 * delivered, because the transport is mocked here — and because the id list IS
 * the boundary. `sendPushToAll` is asserted never called at all: it is the
 * unnarrowed sender, and a future edit that reaches for it is the regression.
 */
describe('narrowed to the roster', () => {
  const FLAG = 'NEXT_PUBLIC_FLAG_MULTI_GROUP';
  afterEach(() => {
    delete process.env[FLAG];
  });

  it('sends to this club only, never to another club on the same deployment', async () => {
    process.env[FLAG] = 'true';
    await seedTestAdminMember();
    seedGroup('bpm');
    seedGroup('other');
    const ours = seedMember('Ours');
    seedMembership('bpm', ours.id, { name: 'Ours' });
    const theirs = seedMember('Theirs');
    seedMembership('other', theirs.id, { name: 'Theirs' });
    seedSession('current-session', { signupOpen: false });

    const res = await put({ signupOpen: true });
    expect(res.status).toBe(200);

    expect(sendPushToMembers).toHaveBeenCalledTimes(1);
    const recipients = sendPushToMembers.mock.calls[0][0] as string[];
    expect(recipients).toContain(ours.id);
    expect(recipients).not.toContain(theirs.id);
    expect(sendPushToAll).not.toHaveBeenCalled();
  });

  it('still names every active member with the flag off', async () => {
    const one = seedMember('One');
    const two = seedMember('Two');
    seedSession('current-session', { signupOpen: false });

    expect((await put({ signupOpen: true })).status).toBe(200);

    const recipients = sendPushToMembers.mock.calls[0][0] as string[];
    expect(recipients).toEqual(expect.arrayContaining([one.id, two.id]));
    expect(sendPushToAll).not.toHaveBeenCalled();
  });
});

});
