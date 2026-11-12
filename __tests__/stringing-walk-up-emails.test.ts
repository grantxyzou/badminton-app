import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import { POST } from '../app/api/stringing/jobs/route';
import { PATCH } from '../app/api/stringing/jobs/[id]/route';
import { composeWalkUpEmail, walkUpEmailRows } from '../lib/stringingWalkUpEmail';
import { walkUpEmailOf } from '../lib/stringing';
import {
  resetMockStore,
  getStore,
  setupAdminPin,
  seedTestAdminMember,
  seedMember,
  seedGroup,
  makeRequest,
  makeAdminRequest,
  memberCookieValue,
} from './helpers';
import type { StringingJob } from '../lib/types';

/**
 * A walk-up's two automatic emails (docs/plans/stringing-walk-ups.md,
 * Decisions, 2026-11-12; Grant: "automatically email", "yes" to a second one
 * when ready, "ok" to a phone number getting only the receipt).
 *
 * The SMTP transport is faked and never reached — the same fake the member's
 * stringing email tests use (`stringing-notify-wiring.test.ts`).
 */
const sendMail = vi.fn(async (_msg: { to: string; subject: string; text: string; html?: string }) => ({}));
vi.mock('@/lib/mailTransport', () => ({
  gmailTransport: async () => ({ sendMail }),
}));

const FLAGS = ['NEXT_PUBLIC_FLAG_STRINGING', 'NEXT_PUBLIC_FLAG_MULTI_GROUP', 'GMAIL_USER', 'GMAIL_APP_PASSWORD'] as const;
const before = Object.fromEntries(FLAGS.map((f) => [f, process.env[f]]));

const jobs = () => (getStore()['stringingJobs'] ?? []) as StringingJob[];
const stored = (id: string) => jobs().find((j) => j.id === id)!;
const subjects = () => sendMail.mock.calls.map(([m]) => m.subject);

const WALK_UP = {
  walkUp: true,
  memberName: 'Lee',
  walkUpContact: '  lee@example.com ',
  racketLabel: 'Astrox 88D Pro',
  stringLabel: 'BG80',
  stringColor: 'Yellow',
  tensionMains: 26,
  tensionCrosses: 28,
  priceCents: 3400,
  readyBy: '2026-11-14',
};

async function create(over: Record<string, unknown> = {}) {
  const res = await POST(makeAdminRequest('POST', 'http://x/api/stringing/jobs', { ...WALK_UP, ...over }));
  return { res, job: (await res.json()).job as StringingJob };
}

async function patch(job: Pick<StringingJob, 'id' | 'memberId'>, body: Record<string, unknown>) {
  const res = await PATCH(makeAdminRequest('PATCH', `http://x/jobs/${job.id}`, { memberId: job.memberId, ...body }), {
    params: Promise.resolve({ id: job.id }),
  });
  return { res, body: await res.json() };
}

beforeEach(async () => {
  resetMockStore();
  setupAdminPin();
  sendMail.mockReset();
  sendMail.mockImplementation(async () => ({}));
  process.env.NEXT_PUBLIC_FLAG_STRINGING = 'true';
  delete process.env.NEXT_PUBLIC_FLAG_MULTI_GROUP;
  process.env.GMAIL_USER = 'club@example.com';
  process.env.GMAIL_APP_PASSWORD = 'app-password';
  seedGroup('bpm', { name: 'BPM Core' });
  await seedTestAdminMember();
});
afterEach(() => {
  for (const f of FLAGS) {
    if (before[f] === undefined) delete process.env[f];
    else process.env[f] = before[f];
  }
  vi.restoreAllMocks();
});

describe('who gets an email', () => {
  it('only a walk-up whose contact is shaped like an email', () => {
    expect(walkUpEmailOf({ walkUp: true, walkUpContact: ' lee@example.com ' })).toBe('lee@example.com');
    expect(walkUpEmailOf({ walkUp: true, walkUpContact: '604-555-0199' })).toBeNull();
    expect(walkUpEmailOf({ walkUp: true })).toBeNull();
    expect(walkUpEmailOf({ walkUp: true, walkUpContact: 'lee@' })).toBeNull();
    // A member's job is never a walk-up's, whatever it carries.
    expect(walkUpEmailOf({ memberId: 'member-wei', walkUpContact: 'wei@example.com' })).toBeNull();
  });
});

describe('the spec email, when the job is saved', () => {
  it('goes once, to the address, from the club, and is stamped on the job', async () => {
    const { res, job } = await create();
    expect(res.status).toBe(201);
    expect(sendMail).toHaveBeenCalledTimes(1);
    const [msg] = sendMail.mock.calls[0];
    expect(msg.to).toBe('lee@example.com');
    expect(msg.subject).toBe("Your racket is with BPM Core's stringer (J-0001)");
    expect(msg.text).toContain('Hi Lee,');
    expect(msg.text).toContain('$34, pay at pickup');

    expect(job.walkUpEmails?.spec?.ok).toBe(true);
    expect(stored(job.id).walkUpEmails?.spec?.ok).toBe(true);
    expect(stored(job.id).walkUpEmails?.ready).toBeUndefined();
  });

  it('a phone number sends nothing and stamps nothing', async () => {
    const { res, job } = await create({ walkUpContact: '604-555-0199' });
    expect(res.status).toBe(201);
    expect(sendMail).not.toHaveBeenCalled();
    expect(job.walkUpEmails).toBeUndefined();
    expect(stored(job.id).walkUpEmails).toBeUndefined();
  });

  it('no contact sends nothing', async () => {
    const { job } = await create({ walkUpContact: undefined });
    expect(sendMail).not.toHaveBeenCalled();
    expect(stored(job.id).walkUpEmails).toBeUndefined();
  });

  it('a failed send does not fail the save: the job is there, stamped not sent', async () => {
    sendMail.mockRejectedValueOnce(new Error('smtp down'));
    vi.spyOn(console, 'error').mockImplementation(() => {});
    const { res, job } = await create();
    expect(res.status).toBe(201);
    expect(jobs()).toHaveLength(1);
    expect(job.walkUpEmails?.spec?.ok).toBe(false);
    expect(stored(job.id).walkUpEmails?.spec?.ok).toBe(false);
  });

  it('with no SMTP configured, nothing is sent and the job says so', async () => {
    delete process.env.GMAIL_USER;
    const { job } = await create();
    expect(sendMail).not.toHaveBeenCalled();
    expect(stored(job.id).walkUpEmails?.spec?.ok).toBe(false);
  });
});

describe('the ready email', () => {
  it('goes when the status first moves forward to ready, and is stamped', async () => {
    const { job } = await create();
    await patch(job, { status: 'strung' });
    expect(subjects()).toHaveLength(1);
    const { res, body } = await patch(job, { status: 'ready' });
    expect(res.status).toBe(200);
    expect(subjects()).toEqual(["Your racket is with BPM Core's stringer (J-0001)", 'Your racket is ready (J-0001)']);
    const [msg] = sendMail.mock.calls[1];
    expect(msg.to).toBe('lee@example.com');
    expect(msg.text).toContain('ready to pick up at the next BPM Core session');
    expect(msg.text).toContain('Bring $34 or pay your stringer at pickup.');
    expect(body.job.walkUpEmails.ready.ok).toBe(true);
    // The spec stamp survives the ready one.
    expect(stored(job.id).walkUpEmails?.spec?.ok).toBe(true);
    expect(stored(job.id).walkUpEmails?.ready?.ok).toBe(true);
  });

  it('is not sent again on an undo and a second move to ready', async () => {
    const { job } = await create();
    await patch(job, { status: 'ready' });
    await patch(job, { status: 'strung' });
    await patch(job, { status: 'ready' });
    expect(subjects().filter((s) => s.startsWith('Your racket is ready'))).toHaveLength(1);
  });

  it('is not sent on a move BACK to ready (picked up → ready)', async () => {
    const { job } = await create({ status: 'picked_up' });
    await patch(job, { status: 'ready' });
    expect(subjects().filter((s) => s.startsWith('Your racket is ready'))).toHaveLength(0);
  });

  it('is not sent on any other move', async () => {
    const { job } = await create();
    await patch(job, { status: 'strung' });
    await patch(job, { status: 'picked_up' });
    expect(subjects().filter((s) => s.startsWith('Your racket is ready'))).toHaveLength(0);
  });

  it('a phone number gets no ready email either', async () => {
    const { job } = await create({ walkUpContact: '604-555-0199' });
    await patch(job, { status: 'ready' });
    expect(sendMail).not.toHaveBeenCalled();
    expect(stored(job.id).walkUpEmails).toBeUndefined();
  });

  it('a failed ready send does not fail the move, and a later move may try again', async () => {
    const { job } = await create();
    sendMail.mockRejectedValueOnce(new Error('smtp down'));
    vi.spyOn(console, 'error').mockImplementation(() => {});
    const first = await patch(job, { status: 'ready' });
    expect(first.res.status).toBe(200);
    expect(stored(job.id).status).toBe('ready');
    expect(stored(job.id).walkUpEmails?.ready?.ok).toBe(false);
    await patch(job, { status: 'strung' });
    await patch(job, { status: 'ready' });
    expect(stored(job.id).walkUpEmails?.ready?.ok).toBe(true);
  });
});

describe('member jobs are untouched', () => {
  it('a member job never gets a walk-up email or stamp, and keeps its own stage email', async () => {
    seedMember('Wei', { id: 'member-wei', email: 'wei@example.com' });
    const res = await POST(
      makeAdminRequest('POST', 'http://x/api/stringing/jobs', {
        memberId: 'member-wei',
        memberName: 'Wei',
        walkUpContact: 'someone@example.com',
        racketLabel: 'Astrox 99',
        stringLabel: 'BG65',
        tensionMains: 24,
        tensionCrosses: 24,
        priceCents: 3000,
      }),
    );
    const job = (await res.json()).job as StringingJob;
    expect(sendMail).not.toHaveBeenCalled();
    expect(job.walkUpContact).toBeUndefined();

    await patch(job, { status: 'ready' });
    // The member's existing path: one stage email, to the member, its own subject.
    expect(sendMail).toHaveBeenCalledTimes(1);
    expect(sendMail.mock.calls[0][0].to).toBe('wei@example.com');
    expect(sendMail.mock.calls[0][0].subject).toBe('Your racket is ready — J-0001');
    expect(stored(job.id).walkUpEmails).toBeUndefined();
  });
});

describe('"Send again"', () => {
  it('resends a FAILED spec email, then refuses a second once it went', async () => {
    sendMail.mockRejectedValueOnce(new Error('smtp down'));
    vi.spyOn(console, 'error').mockImplementation(() => {});
    const { job } = await create();
    expect(stored(job.id).walkUpEmails?.spec?.ok).toBe(false);

    const again = await patch(job, { resendSpecEmail: true });
    expect(again.res.status).toBe(200);
    expect(again.body.job.walkUpEmails.spec.ok).toBe(true);
    expect(stored(job.id).walkUpEmails?.spec?.ok).toBe(true);
    expect(sendMail).toHaveBeenCalledTimes(2);

    const twice = await patch(job, { resendSpecEmail: true });
    expect(twice.res.status).toBe(409);
    expect(twice.body.error).toBe('already_sent');
    expect(sendMail).toHaveBeenCalledTimes(2);
  });

  it('sends a MISSING spec email (a job saved before the emails existed)', async () => {
    delete process.env.GMAIL_USER;
    const { job } = await create();
    // Simulate the older row: no stamp at all.
    delete (stored(job.id) as { walkUpEmails?: unknown }).walkUpEmails;
    process.env.GMAIL_USER = 'club@example.com';
    const again = await patch(job, { resendSpecEmail: true });
    expect(again.res.status).toBe(200);
    expect(sendMail).toHaveBeenCalledTimes(1);
  });

  it('refuses a phone number, and anything riding along', async () => {
    const phone = (await create({ walkUpContact: '604-555-0199' })).job;
    expect((await patch(phone, { resendSpecEmail: true })).body.error).toBe('no_email');
    const email = (await create()).job;
    const mixed = await patch(email, { resendSpecEmail: true, status: 'ready' });
    expect(mixed.res.status).toBe(400);
  });

  it('is an admin\'s: a stringer cannot send it', async () => {
    seedMember('Zach', { id: 'member-zach', canString: true });
    sendMail.mockRejectedValueOnce(new Error('smtp down'));
    vi.spyOn(console, 'error').mockImplementation(() => {});
    const { job } = await create();
    await patch(job, { stringerId: 'member-zach' });
    sendMail.mockClear();
    const res = await PATCH(
      makeRequest('PATCH', `http://x/jobs/${job.id}`, { memberId: job.memberId, resendSpecEmail: true }, {
        Cookie: `member_session=${memberCookieValue('Zach', 'member-zach')}`,
      }),
      { params: Promise.resolve({ id: job.id }) },
    );
    expect([401, 403]).toContain(res.status);
    expect(sendMail).not.toHaveBeenCalled();
  });
});

describe('the copy', () => {
  const base = {
    id: 'j1',
    memberId: '~walkup:0123456789abcdef',
    walkUp: true,
    walkUpContact: 'lee@example.com',
    jobNo: 'J-0042',
    memberName: 'Lee <b>',
    stringerId: null,
    stringerName: null,
    status: 'received',
    racketLabel: 'Astrox 88D Pro',
    stringLabel: 'BG80',
    stringColor: 'Yellow',
    tensionMains: 26,
    tensionCrosses: 28,
    method: 'Zach',
    priceCents: 3400,
    readyBy: '2026-11-14',
    acceptedAt: null,
    paidAt: null,
    sessionId: null,
    history: [],
    createdAt: '2026-11-12T00:00:00.000Z',
    updatedAt: '2026-11-12T00:00:00.000Z',
  } as StringingJob;

  it('the spec box lists the job, racket, string and colour, tension, price and ready-by', () => {
    expect(walkUpEmailRows(base)).toEqual([
      ['Job', 'J-0042'],
      ['Racket', 'Astrox 88D Pro'],
      ['String', 'BG80 · Yellow'],
      ['Tension', '26 / 28 lb'],
      ['Price', '$34, pay at pickup'],
      ['Ready by', 'Sat, Nov 14'],
    ]);
    const { text } = composeWalkUpEmail('spec', base, 'BPM Core');
    expect(text).toContain("BPM Core's stringer has your racket. Here is what you asked for:");
    expect(text).toContain("We'll email you again when it's ready. If anything looks wrong, tell your stringer.");
    expect(text).toContain("You got this email because you gave this address when you dropped off a racket. You'll get one more email when it's ready.");
  });

  it('an unpriced job says "Ask" and the ready email drops the money sentence', () => {
    const unpriced = { ...base, priceCents: null, readyBy: null };
    expect(walkUpEmailRows(unpriced)).toContainEqual(['Price', 'Ask']);
    expect(walkUpEmailRows(unpriced).map(([k]) => k)).not.toContain('Ready by');
    const { subject, text } = composeWalkUpEmail('ready', unpriced, 'BPM Core');
    expect(subject).toBe('Your racket is ready (J-0042)');
    expect(text).not.toContain('Bring');
    expect(text).toContain('This is the last email about this racket.');
  });

  it('a paid job says paid and asks for no money', () => {
    const paid = { ...base, paidAt: '2026-11-13T00:00:00.000Z' };
    expect(walkUpEmailRows(paid)).toContainEqual(['Price', '$34, paid']);
    expect(composeWalkUpEmail('ready', paid).text).not.toContain('Bring');
  });

  it('escapes what a person typed in the HTML half, and never names the contact in the body', () => {
    const { html, text } = composeWalkUpEmail('spec', base, 'BPM Core');
    expect(html).toContain('Lee &lt;b&gt;');
    expect(html).not.toContain('Lee <b>');
    expect(text).not.toContain('lee@example.com');
    expect(html).not.toContain('lee@example.com');
  });
});
