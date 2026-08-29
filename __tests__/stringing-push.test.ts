import { describe, it, expect, beforeEach, vi } from 'vitest';
import { resetMockStore } from './helpers';
import { getContainer } from '@/lib/cosmos';
import { buildPlayerNotice } from '@/lib/stringingNotify';
import { STRINGING_FLOW } from '@/lib/stringing';
import type { StringingStatus } from '@/lib/stringing';
import type { StringingJob } from '@/lib/types';

/**
 * The stringing PUSH channel.
 *
 * `channelsFor()` has listed 'push' since the seam was written, and for a day
 * nothing sent it: the dispatcher imported the email adapter and nothing else.
 * These cover the join, and the two things the join could quietly get wrong —
 * putting money on a lock screen, and letting the email gate swallow push.
 *
 * Mocks `@/lib/push` rather than `web-push`: at this layer what matters is
 * WHETHER a targeted send was attempted and with what payload, not how it was
 * transported.
 */
type Payload = { title: string; body: string; url?: string; tag?: string };
const sendPushToMembers = vi.fn(async (_ids: string[], _payload: Payload) => ({
  configured: true,
  sent: 1,
  failed: 0,
  removed: 0,
}));
const sendPushToAll = vi.fn(async (_payload: Payload) => ({
  configured: true,
  sent: 0,
  failed: 0,
  removed: 0,
}));
vi.mock('@/lib/push', () => ({
  sendPushToMembers: (ids: string[], payload: Payload) => sendPushToMembers(ids, payload),
  sendPushToAll: (payload: Payload) => sendPushToAll(payload),
  isPushConfigured: () => true,
  safeTag: (s: string | undefined) => s,
  ensurePushContainer: vi.fn(),
  hashEndpoint: (s: string) => s,
}));

const { notifyPlayerOfStage } = await import('@/lib/stringingNotifyDispatch');
const { buildStringingPayload } = await import('@/lib/pushMessages');

function job(over: Partial<StringingJob> = {}): StringingJob {
  return {
    id: 'j1',
    memberId: 'm1',
    jobNo: 'J-0007',
    memberName: 'Lin',
    stringerId: 'm-grant',
    stringerName: 'Grant',
    status: 'ready' as StringingStatus,
    racketLabel: 'Astrox 88D',
    stringLabel: 'BG65',
    tensionMains: 24,
    tensionCrosses: 24,
    priceCents: 3000,
    readyBy: '2026-09-03',
    method: 'Zach · 2 strings, 4 knots',
    acceptedAt: null,
    paidAt: null,
    sessionId: null,
    history: [],
    createdAt: '2026-09-01T00:00:00.000Z',
    updatedAt: '2026-09-01T00:00:00.000Z',
    ...over,
  };
}

async function seedMember(over: Record<string, unknown> = {}) {
  await getContainer('members').items.upsert({ id: 'm1', name: 'Lin', active: true, ...over });
}

beforeEach(() => {
  resetMockStore();
  sendPushToMembers.mockClear();
  sendPushToAll.mockClear();
  process.env.NEXT_PUBLIC_FLAG_PUSH_NOTIFY = 'true';
  delete process.env.GMAIL_USER;
  delete process.env.GMAIL_APP_PASSWORD;
});

describe('buildStringingPayload — a lock screen is not a private surface', () => {
  /**
   * The band exists to hide a PROVISIONAL figure, and `amountDue` exists
   * because a bill is a number. A notification is neither situation: it renders
   * on a locked phone, in a gym, in front of whoever is standing there. So it
   * carries NO money at all — not the exact price, and not the band either.
   */
  it('carries no money of any kind, for any price, on any notifying stage', () => {
    for (const status of STRINGING_FLOW) {
      for (const priceCents of [999, 2800, 2999, 3000, 3001, 4200, 12345]) {
        const notice = buildPlayerNotice(job({ status, priceCents }));
        const payload = buildStringingPayload(notice);
        if (!payload) continue;
        const text = `${payload.title}|${payload.body}`;
        expect(text).not.toContain((priceCents / 100).toFixed(2));
        expect(text).not.toContain(String(priceCents));
        // Not the band either — that is the point of this test.
        expect(text).not.toContain(notice.priceRange ?? '__no_band__');
        expect(text).not.toContain('$');
      }
    }
  });

  it('carries no stringer name and no bench status', () => {
    const payload = buildStringingPayload(buildPlayerNotice(job()))!;
    const raw = JSON.stringify(payload);
    expect(raw).not.toContain('Grant');
    expect(raw).not.toContain('m-grant');
    expect(raw).not.toContain('"ready"');
  });

  it('names the racket, so the banner says something worth unlocking for', () => {
    const payload = buildStringingPayload(buildPlayerNotice(job()))!;
    expect(`${payload.title}|${payload.body}`).toContain('Astrox 88D');
  });

  it('writes nothing at all for the quiet stages', () => {
    for (const status of ['requested', 'received', 'picked_up'] as StringingStatus[]) {
      expect(buildStringingPayload(buildPlayerNotice(job({ status })))).toBeNull();
    }
  });

  /** Two different pieces of news must not collapse into one banner. */
  it('tags the two notifying stages differently', () => {
    const strung = buildStringingPayload(buildPlayerNotice(job({ status: 'strung' })))!;
    const ready = buildStringingPayload(buildPlayerNotice(job({ status: 'ready' })))!;
    expect(strung.tag).toBeTruthy();
    expect(ready.tag).toBeTruthy();
    expect(strung.tag).not.toBe(ready.tag);
  });

  it('opens the app rather than a bare origin', () => {
    const payload = buildStringingPayload(buildPlayerNotice(job()))!;
    expect(payload.url).toBeTruthy();
  });
});

describe('notifyPlayerOfStage — the push arm', () => {
  it('pushes to the job owner ALONE, never a broadcast', async () => {
    await seedMember();
    await notifyPlayerOfStage(job());
    expect(sendPushToAll).not.toHaveBeenCalled();
    expect(sendPushToMembers).toHaveBeenCalledTimes(1);
    expect(sendPushToMembers.mock.calls[0][0]).toEqual(['m1']);
  });

  /**
   * THE REGRESSION THIS FILE EXISTS FOR. The dispatcher used to return early on
   * `no_email`, and nearly every member is PIN-only — so wiring push in behind
   * that gate would have shipped a feature that reached almost nobody, while
   * every test still passed.
   */
  it('pushes to a member with NO email address', async () => {
    await seedMember(); // no email
    const out = await notifyPlayerOfStage(job());
    expect(sendPushToMembers).toHaveBeenCalledTimes(1);
    expect(out.pushSent).toBe(1);
    expect(out.emailSent).toBe(false);
    expect(out.reason).toBe('no_email');
  });

  it('sends on both channels when the member has an address', async () => {
    await seedMember({ email: 'lin@example.com' });
    const out = await notifyPlayerOfStage(job());
    expect(sendPushToMembers).toHaveBeenCalledTimes(1);
    expect(out.pushSent).toBe(1);
    // SMTP is unset, so email gets as far as trying and no further.
    expect(out.emailSent).toBe(false);
  });

  it('does not push for a quiet stage', async () => {
    await seedMember();
    await notifyPlayerOfStage(job({ status: 'picked_up' as StringingStatus }));
    expect(sendPushToMembers).not.toHaveBeenCalled();
  });

  it('does not push when the job points at nobody', async () => {
    const out = await notifyPlayerOfStage(job({ memberId: 'ghost' }));
    expect(sendPushToMembers).not.toHaveBeenCalled();
    expect(out.reason).toBe('no_member');
  });

  it('does not push when the flag is off', async () => {
    process.env.NEXT_PUBLIC_FLAG_PUSH_NOTIFY = 'false';
    await seedMember();
    const out = await notifyPlayerOfStage(job());
    expect(sendPushToMembers).not.toHaveBeenCalled();
    expect(out.pushSent).toBe(0);
  });

  /**
   * THE CONTRACT WITH THE BENCH, extended to the second channel. This runs
   * inside the admin's PATCH; a dead push service must not turn moving a racket
   * along into a 503, and it must not cost the email either.
   */
  it('survives a throwing push service, and still attempts email', async () => {
    await seedMember({ email: 'lin@example.com' });
    sendPushToMembers.mockRejectedValueOnce(new Error('push service down'));
    const out = await notifyPlayerOfStage(job());
    expect(out.pushSent).toBe(0);
    expect(out.attempted).toBe(true);
    // Email still ran: it is behind its own gate, not behind push's success.
    expect(out.reason).toBe('send_failed');
  });
});
