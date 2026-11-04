/**
 * The Notifications page's store (`docs/plans/notification-center.md`).
 *
 * A push is sent and forgotten; a NOTICE is the same moment written down, so a
 * member can find it again — and so the members who never turned push on hear
 * about it at all (Grant, 2026-11-03: everyone gets the page, push or not).
 *
 * THREE RULES, each the reason for a shape below:
 *
 *  - **Written beside `sendPushToMembers`, never inside it.** That sender
 *    no-ops without a VAPID key and reaches only people with a device row; an
 *    inbox written from inside it would reach exactly the 3 of 41 who need it
 *    least. Every trigger calls `recordNotices` with the SAME recipient list it
 *    hands the sender.
 *  - **A notice stores what happened, never the push's English sentence.** The
 *    push body is English because a broadcast has no locale (CLAUDE.md, Push);
 *    the page does have one, so it renders each row through `t()`.
 *  - **Never throws.** Every caller runs it after its primary write, as push
 *    does; a failed notice must not fail a sign-up toggle or a bench tap.
 *
 * Stored in `insights` (GROUP-scoped, `/memberId`), as `kind: 'notice'` rows and
 * one `kind: 'noticesSeen'` doc per member per club. That container's two other
 * readers point-read their own ids, so a new kind cannot reach them; the plan
 * doc says why `events` and `pushSubscriptions` were the wrong homes.
 */
import { randomBytes } from 'crypto';
import { ensureContainer } from '@/lib/cosmos';
import { groupScope, groupDocId } from '@/lib/groupScope';
import { flattenMarkdown } from '@/lib/pushMessages';

export const NOTICE_TYPES = [
  'signups_open',
  'promoted',
  'stringing',
  'stringing_change',
  'announcement',
  'settle_up',
] as const;
export type NoticeType = (typeof NOTICE_TYPES)[number];

/** What a trigger hands over: the facts a row needs to render, nothing more. */
export interface NoticeInput {
  type: NoticeType;
  /** The session a sign-ups or waitlist notice is about (its `datetime`). */
  sessionAt?: string;
  /** Stringing: the racket, as the bench labels it. */
  racketLabel?: string;
  /** Stringing: `ready_for_you`, or the stage the push announced. */
  stage?: string;
  /** Announcement: a one-line excerpt, markdown flattened. */
  text?: string;
  /** Settle-up: how many sessions. Never an amount — the lock-screen rule. */
  count?: number;
}

export interface NoticeDoc extends NoticeInput {
  id: string;
  kind: 'notice';
  memberId: string;
  groupId?: string;
  at: string;
}

interface SeenDoc {
  id: string;
  kind: 'noticesSeen';
  memberId: string;
  groupId?: string;
  seenAt: string;
}

/** What the page shows: the newest this many. */
export const NOTICE_PAGE_SIZE = 30;
/** Past this many, the oldest are deleted on read. ~6 months at a club's pace. */
export const NOTICE_KEEP = 60;
/** How far one read looks — a bound on the query, not a promise of the page. */
const NOTICE_READ_LIMIT = 200;
const TEXT_MAX = 200;

function ensureInsights(): Promise<void> {
  return ensureContainer('insights', '/memberId');
}

function seenDocId(groupId: string, memberId: string): string {
  return groupDocId(groupId, `notices-seen:${memberId}`);
}

function clean(input: NoticeInput): NoticeInput {
  const out: NoticeInput = { type: input.type };
  if (typeof input.sessionAt === 'string' && input.sessionAt) out.sessionAt = input.sessionAt;
  if (typeof input.racketLabel === 'string' && input.racketLabel.trim()) out.racketLabel = input.racketLabel.trim().slice(0, 80);
  if (typeof input.stage === 'string' && input.stage) out.stage = input.stage;
  if (typeof input.text === 'string') {
    const flat = flattenMarkdown(input.text);
    if (flat) out.text = flat.length > TEXT_MAX ? `${flat.slice(0, TEXT_MAX - 1)}…` : flat;
  }
  if (typeof input.count === 'number' && Number.isFinite(input.count) && input.count > 0) out.count = Math.floor(input.count);
  return out;
}

/**
 * Write one notice per recipient. Best-effort and silent on failure: resolves
 * the number written, never rejects.
 */
export async function recordNotices(groupId: string, memberIds: readonly string[], input: NoticeInput): Promise<number> {
  const ids = [...new Set(memberIds.filter((m) => typeof m === 'string' && m.length > 0))];
  if (ids.length === 0) return 0;
  try {
    await ensureInsights();
    const scope = groupScope(groupId);
    const at = new Date().toISOString();
    const body = clean(input);
    const results = await Promise.allSettled(
      ids.map((memberId) =>
        scope.create<NoticeDoc>('insights', {
          ...body,
          id: `notice:${randomBytes(12).toString('hex')}`,
          kind: 'notice',
          memberId,
          at,
        }),
      ),
    );
    const failed = results.filter((r) => r.status === 'rejected').length;
    if (failed > 0) console.error(`[notices] ${failed} of ${ids.length} ${input.type} notices failed to write`);
    return ids.length - failed;
  } catch (err) {
    console.error('[notices] write failed (the action itself stands):', err);
    return 0;
  }
}

export interface NoticeList {
  notices: NoticeDoc[];
  /** Newer than `seenAt`. */
  unread: number;
  /** `null` = never opened the page. */
  seenAt: string | null;
}

/** The page's read. Throws on a failed read — the route answers 503, never an empty list. */
export async function listNotices(groupId: string, memberId: string): Promise<NoticeList> {
  await ensureInsights();
  const scope = groupScope(groupId);
  const [rows, seen] = await Promise.all([
    scope.query<NoticeDoc>('insights', {
      where: 'c.memberId = @memberId AND c.kind = @kind',
      params: [
        { name: '@memberId', value: memberId },
        { name: '@kind', value: 'notice' },
      ],
      orderBy: 'c.at DESC',
      limit: NOTICE_READ_LIMIT,
      partitionKey: memberId,
    }),
    scope.read<SeenDoc>('insights', seenDocId(groupId, memberId), memberId),
  ]);

  // Re-checked in JS: the mock store ignores a parameter name it does not know
  // (`@kind`) and the ORDER BY, so without this a test would see every row in
  // the partition, in insertion order.
  const notices = rows
    .filter((r) => r?.kind === 'notice' && r.memberId === memberId && typeof r.at === 'string')
    .sort((a, b) => (a.at < b.at ? 1 : a.at > b.at ? -1 : 0));

  if (notices.length > NOTICE_KEEP) {
    const stale = notices.slice(NOTICE_KEEP);
    void Promise.allSettled(stale.map((n) => scope.remove('insights', n.id, memberId))).catch(() => {});
  }

  const seenAt = seen?.kind === 'noticesSeen' && typeof seen.seenAt === 'string' ? seen.seenAt : null;
  const page = notices.slice(0, NOTICE_PAGE_SIZE);
  const unread = seenAt === null ? page.length : page.filter((n) => n.at > seenAt).length;
  return { notices: page, unread, seenAt };
}

/** Stamp "seen up to now". One doc per member per club, so an upsert. */
export async function markNoticesSeen(groupId: string, memberId: string): Promise<string> {
  await ensureInsights();
  const seenAt = new Date().toISOString();
  await groupScope(groupId).upsert<SeenDoc>('insights', {
    id: seenDocId(groupId, memberId),
    kind: 'noticesSeen',
    memberId,
    seenAt,
  });
  return seenAt;
}
