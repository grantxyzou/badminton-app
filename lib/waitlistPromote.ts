import type { GroupScope } from './groupScope';
import type { Player, Session } from './types';
import { compareBySignup } from './capacity';
import { defaultMaxPlayers } from './defaults';
import { sendPushToMembers } from './push';
import { buildWaitlistPromotedPayload } from './pushMessages';

/**
 * WHEN A SPOT OPENS, THE FIRST PERSON WAITING TAKES IT
 * (docs/plans/waitlist-auto-promote.md, Grant 2026-10-28).
 *
 * Called after a write that may have freed a spot — a cancel, an admin
 * removal, a raised `maxPlayers`. Before this, a freed spot sat open until an
 * admin noticed it, and a brand-new sign-up (which counts active rows) took it
 * ahead of everyone already waiting.
 *
 * - Sign-up order, `compareBySignup` — the order the race reconcile uses.
 * - Fills every free spot, not one.
 * - Never a held-for-unpaid row: that one moves when its payment lands
 *   (`releaseHoldIfSettled`).
 * - Only before the session starts, and never on a settled session (a
 *   promoted row would rejoin a frozen bill owing nothing).
 * - Each promotion is an etag `replace`. Losing one (another request promoted
 *   that row, or it changed) re-reads and re-plans, up to `MAX_PASSES`.
 *
 * BEST-EFFORT: it never throws. The caller's write has already happened, and a
 * cancel must not fail because the spot could not be handed on.
 */
const MAX_PASSES = 3;

type Row = Player & Record<string, unknown> & { id: string };

/** Pure: which waitlisted rows take the free spots, in order. */
export function planPromotions(rows: Row[], maxPlayers: number): Row[] {
  const live = rows.filter((r) => r.removed !== true);
  const activeCount = live.filter((r) => r.waitlisted !== true).length;
  const room = Math.max(0, Math.floor(maxPlayers) - activeCount);
  if (room === 0) return [];
  return live
    .filter((r) => r.waitlisted === true && r.heldForUnpaid !== true)
    .sort(compareBySignup)
    .slice(0, room);
}

/** Whether a session can still take a promotion at `nowMs`. */
export function promotionOpen(session: Partial<Pick<Session, 'datetime' | 'settled'>> | null | undefined, nowMs: number): boolean {
  if (!session || session.settled) return false;
  const start = typeof session.datetime === 'string' ? Date.parse(session.datetime) : NaN;
  return Number.isFinite(start) && nowMs < start;
}

/** Promote into every free spot of `sessionId`; returns the promoted row ids. */
export async function promoteFromWaitlist(scope: GroupScope, sessionId: string): Promise<string[]> {
  const promoted: Row[] = [];
  try {
    const session = await scope.read<Session & { id: string }>('sessions', sessionId, sessionId);
    if (!promotionOpen(session, Date.now())) return [];
    const maxPlayers = session?.maxPlayers ?? defaultMaxPlayers();

    for (let pass = 0; pass < MAX_PASSES; pass++) {
      const rows = (await scope.query<Row>('players', {
        where: 'c.sessionId = @sessionId',
        params: [{ name: '@sessionId', value: sessionId }],
        partitionKey: sessionId,
      })).filter((r) => r.sessionId === sessionId);
      const picks = planPromotions(rows, maxPlayers);
      if (picks.length === 0) break;
      let lost = false;
      for (const row of picks) {
        const now = new Date().toISOString();
        const written = await scope.replace('players', { ...row, waitlisted: false, promotedAt: now }, sessionId);
        if (written) promoted.push(row);
        else lost = true;
      }
      if (!lost) break;
    }
  } catch (err) {
    console.error('[waitlist] promotion failed (the triggering write stands):', err);
  }

  if (promoted.length > 0) {
    try {
      const session = await scope.read<Session & { id: string }>('sessions', sessionId, sessionId);
      const memberIds = promoted.map((r) => r.memberId).filter((m): m is string => typeof m === 'string' && m.length > 0);
      if (memberIds.length > 0) await sendPushToMembers(memberIds, buildWaitlistPromotedPayload(session ?? { id: sessionId }));
    } catch (err) {
      console.error('[waitlist] promotion push failed (the promotion stands):', err);
    }
  }
  return promoted.map((r) => r.id);
}
