import { describe, it, expect, beforeEach, afterAll, vi } from 'vitest';
import {
  resetMockStore,
  getStore,
  setupAdminPin,
  seedAdminMember,
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
const sendPushToAll = vi.fn();
vi.mock('@/lib/push', () => ({
  sendPushToAll: (...args: unknown[]) => sendPushToAll(...args),
  sendPushToMembers: vi.fn(),
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
    sendPushToAll.mockReset();
    sendPushToAll.mockResolvedValue({ configured: true, sent: 3, failed: 0, removed: 0 });
    process.env.NEXT_PUBLIC_FLAG_PUSH_NOTIFY = 'true';
  });

  afterAll(() => {
    delete process.env.NEXT_PUBLIC_FLAG_PUSH_NOTIFY;
  });

  describe('edge detection', () => {
    it('fires once on a false -> true flip and stamps the session', async () => {
      seedSession('current-session', { signupOpen: false });

      const res = await put({ signupOpen: true });
      expect(res.status).toBe(200);

      expect(sendPushToAll).toHaveBeenCalledTimes(1);
      const payload = sendPushToAll.mock.calls[0][0];
      expect(payload.title).toBe('Sign-ups are open');
      expect(sessionDoc()?.signupOpenNotifiedAt).toBeTruthy();
      expect(sessionDoc()?.signupOpenedAt).toBeTruthy();
    });

    it('does NOT fire on true -> true', async () => {
      seedSession('current-session', { signupOpen: true });
      await put({ signupOpen: true });
      expect(sendPushToAll).not.toHaveBeenCalled();
    });

    it('does NOT fire on true -> false', async () => {
      seedSession('current-session', { signupOpen: true });
      await put({ signupOpen: false });
      expect(sendPushToAll).not.toHaveBeenCalled();
    });

    it('does NOT fire when signupOpen is absent (absent means open)', async () => {
      // CLAUDE.md: an absent signupOpen reads as OPEN, so absent -> true is not
      // an edge. A looser `!== true` check would misfire on legacy docs.
      seedSession('current-session', {});
      delete sessionDoc()!.signupOpen;

      await put({ signupOpen: true });
      expect(sendPushToAll).not.toHaveBeenCalled();
    });

    it('does NOT fire when the PUT does not touch signupOpen', async () => {
      seedSession('current-session', { signupOpen: false });
      await put({ title: 'Thursday Badminton' });
      expect(sendPushToAll).not.toHaveBeenCalled();
    });
  });

  describe('idempotency', () => {
    it('fires exactly once across close -> open -> close -> open', async () => {
      seedSession('current-session', { signupOpen: false });

      await put({ signupOpen: true });
      await put({ signupOpen: false });
      await put({ signupOpen: true });

      expect(sendPushToAll).toHaveBeenCalledTimes(1);
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

  describe('flag gating', () => {
    it('does not send when the flag is off, but still records signupOpenedAt', async () => {
      delete process.env.NEXT_PUBLIC_FLAG_PUSH_NOTIFY;
      seedSession('current-session', { signupOpen: false });

      const res = await put({ signupOpen: true });

      expect(res.status).toBe(200);
      expect(sendPushToAll).not.toHaveBeenCalled();
      expect(sessionDoc()?.signupOpenNotifiedAt).toBeUndefined();
      // Plain session history, independent of the notification feature.
      expect(sessionDoc()?.signupOpenedAt).toBeTruthy();

      process.env.NEXT_PUBLIC_FLAG_PUSH_NOTIFY = 'true';
    });
  });

  describe('auth', () => {
    it('rejects a non-admin PUT before any push', async () => {
      seedSession('current-session', { signupOpen: false });
      const res = await PUT(makeRequest('PUT', BASE, { signupOpen: true }));
      expect(res.status).toBe(401);
      expect(sendPushToAll).not.toHaveBeenCalled();
    });
  });

  describe('never fail the caller', () => {
    it('still returns 200 and persists signupOpen when the push throws', async () => {
      seedSession('current-session', { signupOpen: false });
      sendPushToAll.mockRejectedValue(new Error('push service down'));

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
});
