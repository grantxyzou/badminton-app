import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import { flattenMarkdown, buildAnnouncementPayload } from '@/lib/pushMessages';
import {
  resetMockStore,
  setupAdminPin,
  seedAdminMember,
  seedTestAdminMember,
  seedGroup,
  seedMember,
  seedMembership,
  seedSession,
  makeAdminRequest,
} from './helpers';

/**
 * The transport is mocked at `@/lib/push`: what matters here is WHO a send was
 * addressed to, not how it travelled (same seam as session-signup-open-push).
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

const { POST } = await import('../app/api/announcements/route');

/**
 * The announcement trigger.
 *
 * Two things it must get right, and both are easy to get wrong silently:
 * announcements are stored as RAW MARKDOWN, and only a genuinely NEW one is
 * worth interrupting anyone for.
 */

describe('flattenMarkdown — a lock screen has no renderer', () => {
  it('strips the tokens the app renders, leaving the words', () => {
    expect(flattenMarkdown('**Courts moved** to _Wing’s_')).toBe('Courts moved to Wing’s');
  });

  it('keeps link TEXT and drops the URL', () => {
    expect(flattenMarkdown('See [the map](https://maps.example.com/x)')).toBe('See the map');
  });

  it('drops images entirely — there is nothing to show', () => {
    expect(flattenMarkdown('![court photo](a.png) Doors at 7')).toBe('Doors at 7');
  });

  it('flattens headings, quotes and inline code', () => {
    expect(flattenMarkdown('# Heads up\n> bring `$10`')).toBe('Heads up bring $10');
  });

  it('turns bullets into something readable on one line', () => {
    expect(flattenMarkdown('- bring water\n- pay Grant')).toBe('• bring water • pay Grant');
  });

  it('collapses newlines rather than emitting a multi-line banner', () => {
    expect(flattenMarkdown('Line one\n\n\nLine two')).toBe('Line one Line two');
  });

  it('leaves plain text completely alone', () => {
    expect(flattenMarkdown('Courts are booked for 8pm')).toBe('Courts are booked for 8pm');
  });
});

describe('buildAnnouncementPayload', () => {
  it('uses the announcement text as the body, flattened', () => {
    const p = buildAnnouncementPayload({ id: 'a1', text: '**Late start** tonight' });
    expect(p.title).toBe('New announcement');
    expect(p.body).toBe('Late start tonight');
    expect(p.body).not.toContain('**');
  });

  /** An empty body would render a banner that says nothing at all. */
  it('falls back to something useful when the text is empty or markdown-only', () => {
    expect(buildAnnouncementPayload({ id: 'a1', text: '' }).body).toBe('Tap to read it in the app.');
    expect(buildAnnouncementPayload({ id: 'a1', text: '![x](y.png)' }).body).toBe(
      'Tap to read it in the app.',
    );
  });

  it('tags per announcement, so two notices do not collapse into one', () => {
    const a = buildAnnouncementPayload({ id: 'a1', text: 'one' });
    const b = buildAnnouncementPayload({ id: 'a2', text: 'two' });
    expect(a.tag).not.toBe(b.tag);
  });

  it('survives a missing text field rather than throwing', () => {
    expect(() => buildAnnouncementPayload({ id: 'a1' })).not.toThrow();
  });
});

/**
 * The route wiring. A source scan for the CREATE-only rule: a runtime test
 * would need the whole admin-auth + Cosmos path, and the thing worth pinning is
 * the structural claim — that PATCH does not notify.
 */
describe('the announcement route notifies on CREATE only', () => {
  let src = '';
  beforeEach(async () => {
    const { readFileSync } = await import('fs');
    src = readFileSync(new URL('../app/api/announcements/route.ts', import.meta.url), 'utf8');
  });
  afterEach(() => vi.restoreAllMocks());

  it('sends from the POST handler', () => {
    const post = src.slice(src.indexOf('export async function POST'));
    expect(post).toContain('sendPushToMembers');
    expect(post).toContain('buildAnnouncementPayload');
  });

  /** Re-notifying everyone because a typo was fixed is the empty interruption
   *  the whole notification design exists to avoid. */
  it('does NOT send from the PATCH (edit) handler', () => {
    const patch = src.slice(src.indexOf('export async function PATCH'), src.indexOf('export async function POST'));
    expect(patch).not.toMatch(/sendPushTo(Members|All)/);
  });

  it('persists before it notifies', () => {
    // Scoped to the POST BODY: the sender also appears in the import at the
    // top of the file, which made a whole-file index comparison meaningless.
    // The claim is about order WITHIN the handler. Both indexes are asserted
    // found first — a -1 on the left would pass this vacuously.
    const post = src.slice(src.indexOf('export async function POST'));
    const create = post.indexOf("scope.create('announcements'");
    const send = post.indexOf('sendPushToMembers(');
    expect(create).toBeGreaterThan(-1);
    expect(send).toBeGreaterThan(-1);
    expect(create).toBeLessThan(send);
  });
});

/**
 * THE NARROWING. `pushSubscriptions` is PERSON-scoped — one doc per device,
 * and a person can be in two clubs — so nothing on the row separates clubs;
 * the recipient list has to come from the ROSTER. Until 2026-10-11 this route
 * was the one remaining `sendPushToAll` caller, so one club's announcement
 * would have reached every club in the deployment the day multi-group turned
 * on. Same shape as the sign-up-open case: a second club with its own member,
 * who must not be in the list.
 */
describe('POST /api/announcements — narrowed to the roster', () => {
  const FLAG = 'NEXT_PUBLIC_FLAG_MULTI_GROUP';
  const BASE = 'http://localhost:3000/api/announcements';

  beforeEach(() => {
    resetMockStore();
    setupAdminPin();
    seedAdminMember();
    sendPushToMembers.mockReset();
    sendPushToAll.mockReset();
    sendPushToMembers.mockResolvedValue({ configured: true, sent: 1, failed: 0, removed: 0 });
  });
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
    seedSession('current-session', {});

    const res = await POST(makeAdminRequest('POST', BASE, { text: 'Courts moved to 8pm' }));
    expect(res.status).toBe(201);

    expect(sendPushToMembers).toHaveBeenCalledTimes(1);
    const recipients = sendPushToMembers.mock.calls[0][0] as string[];
    expect(recipients).toContain(ours.id);
    expect(recipients).not.toContain(theirs.id);
    expect(sendPushToAll).not.toHaveBeenCalled();
  });

  it('still names every active member with the flag off', async () => {
    const one = seedMember('One');
    const two = seedMember('Two');
    seedSession('current-session', {});

    const res = await POST(makeAdminRequest('POST', BASE, { text: 'Bring water' }));
    expect(res.status).toBe(201);

    const recipients = sendPushToMembers.mock.calls[0][0] as string[];
    expect(recipients).toEqual(expect.arrayContaining([one.id, two.id]));
    expect(sendPushToAll).not.toHaveBeenCalled();
  });

  it('still returns 201 and keeps the announcement when the push throws', async () => {
    seedSession('current-session', {});
    sendPushToMembers.mockRejectedValue(new Error('push service down'));

    const res = await POST(makeAdminRequest('POST', BASE, { text: 'Late start' }));
    expect(res.status).toBe(201);
  });
});
