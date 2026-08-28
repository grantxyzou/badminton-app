import { describe, it, expect, beforeEach } from 'vitest';
import { resetMockStore } from './helpers';
import { getContainer } from '@/lib/cosmos';
import { buildPlayerNotice } from '@/lib/stringingNotify';
import { composeEmail, sendStringingNotice } from '@/lib/stringingNotifyEmail';
import { notifyPlayerOfStage } from '@/lib/stringingNotifyDispatch';
import type { StringingJob } from '@/lib/types';
import type { StringingStatus } from '@/lib/stringing';

/**
 * The seam had adapters on NEITHER side — nothing built a notice and nothing
 * sent one — so no player was ever told their racket was ready. These cover the
 * wiring, and the two rules that wiring could quietly break: the price never
 * leaves exact, and the bench never breaks because email did.
 */

function job(over: Partial<StringingJob> = {}): StringingJob {
  return {
    id: 'j1',
    memberId: 'm1',
    jobNo: 'J-0007',
    memberName: 'Lin',
    stringerId: null,
    stringerName: null,
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

beforeEach(() => {
  resetMockStore();
  delete process.env.GMAIL_USER;
  delete process.env.GMAIL_APP_PASSWORD;
});

describe('composeEmail — the price rule survives the second door', () => {
  /**
   * THE RULE THE WHOLE FEATURE RESTS ON. `toPlayerJob` bands the price for the
   * API; an email is the same description leaving by another exit, and it is
   * where a hand-written string would defeat it while every API test stayed
   * green.
   */
  it('never puts the exact price in the body, only the band', () => {
    const notice = buildPlayerNotice(job({ priceCents: 3000 }));
    const copy = composeEmail(notice, 'Lin')!;

    expect(copy.text).not.toContain('30.00');
    expect(copy.text).not.toContain('$30');
    expect(copy.text).toContain(notice.priceRange!);
  });

  it('says the racket is ready, and names the job', () => {
    const copy = composeEmail(buildPlayerNotice(job({ status: 'ready' as StringingStatus })), 'Lin')!;
    expect(copy.subject).toContain('J-0007');
    expect(copy.text).toContain('Astrox 88D');
    expect(copy.text).toContain('Lin');
  });

  /** Telling someone about a racket they are holding is how an app teaches
   *  people to ignore it. */
  it('writes NO copy for the quiet stages', () => {
    for (const status of ['received', 'picked_up'] as StringingStatus[]) {
      const notice = buildPlayerNotice(job({ status }));
      expect(composeEmail(notice, 'Lin')).toBeNull();
    }
  });

  it('omits the estimate line entirely when the job has no price yet', () => {
    const copy = composeEmail(buildPlayerNotice(job({ priceCents: null })), 'Lin')!;
    expect(copy.text).not.toContain('Estimate:');
  });
});

describe('sendStringingNotice', () => {
  it('does not send without an address', async () => {
    const notice = buildPlayerNotice(job());
    expect(await sendStringingNotice(notice, null, 'Lin')).toEqual({ sent: false });
    expect(await sendStringingNotice(notice, '', 'Lin')).toEqual({ sent: false });
  });

  it('does not send when SMTP is unconfigured — that is not a failure', async () => {
    const notice = buildPlayerNotice(job());
    expect(await sendStringingNotice(notice, 'a@b.com', 'Lin')).toEqual({ sent: false });
  });

  it('does not send for a stage whose channels exclude email', async () => {
    const notice = buildPlayerNotice(job({ status: 'picked_up' as StringingStatus }));
    expect(notice.channels).not.toContain('email');
    expect(await sendStringingNotice(notice, 'a@b.com', 'Lin')).toEqual({ sent: false });
  });
});

describe('notifyPlayerOfStage — the dispatcher', () => {
  async function seedMember(over: Record<string, unknown> = {}) {
    await getContainer('members').items.upsert({
      id: 'm1',
      name: 'Lin',
      active: true,
      ...over,
    });
  }

  it('skips a quiet stage before touching the database at all', async () => {
    const out = await notifyPlayerOfStage(job({ status: 'picked_up' as StringingStatus }));
    expect(out).toEqual({ attempted: false, emailSent: false, reason: 'quiet_stage' });
  });

  /**
   * The common case today: nearly every member is PIN-only, so there is no
   * address. That is expected, not an error — the in-app stage is what reaches
   * them.
   */
  it('reports no_email for a PIN-only member rather than failing', async () => {
    await seedMember();
    const out = await notifyPlayerOfStage(job());
    expect(out).toEqual({ attempted: true, emailSent: false, reason: 'no_email' });
  });

  it('reports no_member when the job points at nobody', async () => {
    const out = await notifyPlayerOfStage(job({ memberId: 'ghost' }));
    expect(out).toEqual({ attempted: true, emailSent: false, reason: 'no_member' });
  });

  /**
   * THE CONTRACT WITH THE BENCH. This runs inside the admin's PATCH; a mail
   * failure must never turn moving a racket along into a 503.
   */
  it('NEVER throws, even when the member read blows up', async () => {
    await seedMember({ email: 'lin@example.com' });
    process.env.GMAIL_USER = 'x@y.com';
    process.env.GMAIL_APP_PASSWORD = 'nope';

    // No network in tests, so the transport throws — the point is what we do.
    const out = await notifyPlayerOfStage(job());
    expect(out.emailSent).toBe(false);
    expect(out.attempted).toBe(true);
  });

  it('attempts a send for a member who DOES have an address', async () => {
    await seedMember({ email: 'lin@example.com' });
    const out = await notifyPlayerOfStage(job());
    // SMTP unset, so nothing leaves — but it got past every gate to try.
    expect(out.attempted).toBe(true);
    expect(out.reason).toBe('send_failed');
  });
});
