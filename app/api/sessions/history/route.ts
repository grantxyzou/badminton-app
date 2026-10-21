import { NextRequest, NextResponse } from 'next/server';
import { getContainer, getActiveSessionId } from '@/lib/cosmos';
import { groupScope } from '@/lib/groupScope';
import { resolveGroupId } from '@/lib/groupContext';
import { isAdminAuthedWithMember, unauthorized } from '@/lib/auth';
import { buildReceiptInput } from '@/lib/buildReceiptInput';
import { readGroup } from '@/lib/groups';
import { recipientOf } from '@/lib/payTo';
import type { ETransferRecipient, Member, Session } from '@/lib/types';

export const dynamic = 'force-dynamic';

const DEFAULT_LIMIT = 8;
const MAX_LIMIT = 24;
/** `counts=1` builds no receipts, so it can answer for every session the
 *  Payments calendar shows (docs/plans/payments-today-first.md). */
const MAX_COUNTS_LIMIT = 200;

/**
 * GET /api/sessions/history — admin-only list of recent sessions, each row
 * carrying a ready-to-render receipt (or the reason it can't be built). The
 * row's `costPerPerson` is the SAME value inside `receipt`, produced by the
 * single `buildReceiptInput` resolver, so the list and the receipt can never
 * disagree (spec §2, §3).
 */
export async function GET(req: NextRequest) {
  const auth = await isAdminAuthedWithMember(req);
  if (!auth.authed) return unauthorized();

  const params = new URL(req.url).searchParams;
  // Counts only: who still owes per session, without the receipts or the
  // recipient read. The Payments card's date picker marks an owing day from
  // it, for every session rather than the newest 24.
  const countsOnly = params.get('counts') === '1';
  const requested = parseInt(params.get('limit') ?? '', 10);
  const limit = Math.max(1, Math.min(countsOnly ? MAX_COUNTS_LIMIT : MAX_LIMIT, Number.isFinite(requested) ? requested : DEFAULT_LIMIT));

  try {
    const scope = groupScope(resolveGroupId(req));
    const membersContainer = getContainer('members');

    // The club's recipient is the default (the group doc's, else the calling
    // admin's own — the same answer the settings screen shows and members are
    // told, lib/payTo.ts); a session may override it.
    let globalRecipient: ETransferRecipient | null = null;
    if (!countsOnly) {
      const { resource: adminMember } = await membersContainer
        .item(auth.memberId, auth.memberId)
        .read<Member>();
      globalRecipient = recipientOf(await readGroup(scope.groupId)) ?? adminMember?.eTransferRecipient ?? null;
    }

    // The currently-active session is owned by the Command Center's live
    // receipt — this list is for PAST (archived) sessions only. Exclude it
    // alongside the pointer + legacy docs. (Also keeps unsettled cover-mode
    // math out of this list, which reads frozen settled snapshots.)
    // Bound as the `@activeId` exclusion; a group with no session excludes nothing.
    const activeId = (await getActiveSessionId(scope.groupId)) ?? '';

    // PAST sessions (the accessor excludes the pointer and legacy docs; the
    // active one is excluded here), newest `limit` of them in SQL. The JS
    // sort + slice stays because the mock store ignores ORDER BY / LIMIT
    // (same contract as sessions/recent).
    const allSessions = await scope.query<Session>('sessions', {
      where: 'c.id != @activeId',
      params: [{ name: '@activeId', value: activeId }],
      orderBy: 'c.id DESC',
      limit,
    });
    const sessions = allSessions
      .sort((a, b) => (a.id < b.id ? 1 : a.id > b.id ? -1 : 0))
      .slice(0, limit);

    // Batched player fetch; the mock ignores IN() and returns everything, so
    // post-filter by the id set (same contract as sessions/recent).
    type PlayerRow = { sessionId: string; name: string; paid?: boolean; removed?: boolean; waitlisted?: boolean; writtenOff?: boolean };
    const sessionIds = sessions.map((s) => s.id);
    const sessionIdSet = new Set(sessionIds);
    const playersBySession = new Map<string, PlayerRow[]>();
    if (sessionIds.length > 0) {
      const placeholders = sessionIds.map((_, i) => `@sid${i}`).join(',');
      const rawPlayers = await scope.query<PlayerRow>('players', {
        select: 'c.sessionId, c.name, c.paid, c.removed, c.waitlisted, c.writtenOff',
        where: `c.sessionId IN (${placeholders})`,
        params: sessionIds.map((id, i) => ({ name: `@sid${i}`, value: id })),
      });
      for (const p of rawPlayers) {
        if (!sessionIdSet.has(p.sessionId)) continue;
        const arr = playersBySession.get(p.sessionId);
        if (arr) arr.push(p);
        else playersBySession.set(p.sessionId, [p]);
      }
    }

    const out = sessions.map((s) => {
      const roster = playersBySession.get(s.id) ?? [];
      // attendanceCount / paidPercent are LIVE (current roster) — deliberately
      // distinct from receipt.playerNames, which is the frozen settled snapshot.
      const active = roster.filter((p) => !p.removed && !p.waitlisted);
      const paidCount = active.filter((p) => p.paid === true).length;
      const paidPercent = active.length > 0 ? Math.round((paidCount / active.length) * 100) : 0;
      // Who still owes: not paid and not covered. The Payments card's date
      // picker dots each session's day from this (amber owing, grey all paid)
      // so a past session says what is left to collect without being opened.
      const unpaidCount = active.filter((p) => p.paid !== true && !p.writtenOff).length;
      if (countsOnly) {
        return { sessionId: s.id, date: s.datetime ?? '', attendanceCount: active.length, unpaidCount };
      }

      const recipient = s.eTransferRecipient ?? globalRecipient;
      const build = buildReceiptInput(s, roster, recipient);

      return {
        sessionId: s.id,
        date: s.datetime ?? '',
        attendanceCount: active.length,
        paidPercent,
        unpaidCount,
        costPerPerson: build.costPerPerson,
        receipt: build.input,
        ...(build.error ? { receiptError: build.error } : {}),
      };
    });

    return NextResponse.json({ sessions: out });
  } catch (error) {
    // 503, never a lying empty 200 (CLAUDE.md). Clients guard on res.ok.
    console.error('GET /api/sessions/history error:', error);
    return NextResponse.json({ error: 'Failed to load session history' }, { status: 503 });
  }
}
