import { NextRequest, NextResponse } from 'next/server';
import { getActiveSessionId } from '@/lib/cosmos';
import { groupScope } from '@/lib/groupScope';
import { resolveGroupId, noActiveSession } from '@/lib/groupContext';
import { isAdminAuthedWithMember, unauthorized } from '@/lib/auth';
import { costSplit, isResplitCovered } from '@/lib/sessionCost';
import { ACTIVE_PLAYERS_WHERE } from '@/lib/capacity';
import { mirrorSettle, mirrorUnsettle } from '@/lib/ledgerMirror';
import type { Player, Session, SettledSnapshot } from '@/lib/types';

export const dynamic = 'force-dynamic';

/**
 * Resolve which session id this request targets. Admins may override via
 * `?sessionId=` to settle a session that was already archived (e.g. they
 * advanced before remembering to settle). Falls back to the active pointer.
 */
async function resolveTargetSessionId(req: NextRequest): Promise<string | null> {
  const params = req.nextUrl.searchParams;
  const override = params.get('sessionId');
  if (override) return override;
  return await getActiveSessionId(resolveGroupId(req));
}

/**
 * POST /api/session/settle — freeze the receipt for a session.
 *
 * Computes cost-per-person from the session's current cost inputs and active
 * roster, then writes:
 *   - `session.settled` — the frozen snapshot
 *   - `session.signupOpen = false` — prevent late signups changing the math
 *   - `player.owedAmount` + `player.settledAt` on each billed player
 *
 * Idempotent guard: refuses if `session.settled` already exists, unless the
 * body says `{ resettle: true }`.
 *
 * RE-SETTLE IS ONE STEP, AND IT KEEPS WHO WAS BILLED (audit, 2026-11-05). A
 * cover on a frozen bill used to run DELETE then POST from the browser, and
 * the POST billed only the rows still on the list. So the Cover sheet's
 * "Cover & remove" (meant: the club eats their share) and "Remove without
 * covering" (meant: they still owe it) both did the same third thing: the
 * person dropped out of the split, their share landed on everyone else, and
 * their own debt was wiped. A re-settle now bills everyone the frozen bill
 * billed, removed or not; a removed row is still in the split, covered or
 * owing as its row says. And it refuses — before touching anything — when
 * the new split would change what someone has ALREADY PAID: a paid row
 * re-stamped at a new amount keeps `paid: true` over a figure nobody paid,
 * which is how a re-split after payments under-collected silently. A manual
 * unsettle (DELETE) still forgets the bill, for a settle that was wrong.
 */
export async function POST(req: NextRequest) {
  if (!(await isAdminAuthedWithMember(req)).authed) return unauthorized();

  try {
    const sessionId = await resolveTargetSessionId(req);
    if (!sessionId) return noActiveSession();
    const scope = groupScope(resolveGroupId(req));
    const body = (await req.json().catch(() => null)) as { resettle?: unknown } | null;
    const resettle = body?.resettle === true;

    const session = await scope.read<Session>('sessions', sessionId, sessionId);
    if (!session) {
      return NextResponse.json({ error: 'Session not found' }, { status: 404 });
    }
    if (session.settled && !resettle) {
      return NextResponse.json(
        { error: 'Session already settled. Unsettle first to recompute.' },
        { status: 409 },
      );
    }

    const activePlayers = await scope.query<Player>('players', {
      where: ACTIVE_PLAYERS_WHERE,
      params: [{ name: '@sessionId', value: sessionId }],
      partitionKey: sessionId,
    });
    // On a re-settle, everyone the frozen bill billed stays in it, removed or
    // not (see above). Waitlisted rows never played.
    const billed = session.settled ? await settledRows(scope, sessionId) : [];
    const billedIds = new Set(billed.map((p) => p.id));
    const byId = new Map<string, Player>();
    for (const p of [...activePlayers, ...billed]) if (p.waitlisted !== true) byId.set(p.id, p);
    const participants = [...byId.values()];

    if (participants.length === 0) {
      return NextResponse.json(
        { error: 'No active players to settle.' },
        { status: 400 },
      );
    }

    // The one cover-aware split (lib/sessionCost.ts `costSplit`); settle
    // freezes what it returns, so every later reader takes the snapshot. A
    // billed row that has since been removed is still a participant here.
    const split = costSplit(
      session,
      participants.map((p) => (billedIds.has(p.id) && p.removed === true ? { ...p, removed: false } : p)),
    );
    const { courtTotal, birdTotal, totalCost, denominator, costPerPerson, coveredTotal } = split;

    if (totalCost <= 0) {
      return NextResponse.json(
        { error: 'Total cost is zero — set court cost or bird usage before settling.' },
        { status: 400 },
      );
    }
    if (denominator <= 0) {
      return NextResponse.json(
        { error: 'Everyone is covered — nobody left to split the cost across.' },
        { status: 400 },
      );
    }

    const owedOf = (p: Player) => (isResplitCovered(p) ? 0 : costPerPerson);
    const paidChanges = participants.filter((p) => p.paid === true && (p.owedAmount ?? 0) !== owedOf(p));
    if (resettle && paidChanges.length > 0) {
      return NextResponse.json(
        { error: 'paid_would_change', names: paidChanges.map((p) => p.name) },
        { status: 409 },
      );
    }

    if (session.settled) {
      // Thaw the frozen bill in the same request, now that it is safe to.
      await clearSettlement(scope, session, billed);
    }

    const at = new Date().toISOString();

    const snapshot: SettledSnapshot = {
      at,
      costPerPerson,
      totalCost,
      courtTotal,
      birdTotal,
      // Denominator the per-person amount was divided by (payers + absorb-covered).
      playerCount: denominator,
      playerNames: participants.map((p) => p.name),
      ...(coveredTotal > 0 ? { coveredTotal } : {}),
    };

    // Stamp session first. If player updates fail, admin can unsettle & retry.
    const { settled: _prev, ...unsettledSession } = session;
    const updatedSession: Session = {
      ...unsettledSession,
      settled: snapshot,
      signupOpen: false,
    };
    await scope.upsert('sessions', updatedSession);

    // Stamp each billed player with their frozen owed amount.
    // Cosmos: same partition (sessionId), so failures here are unusual; we
    // still loop one-at-a-time for mock-store compatibility. If any single
    // upsert throws, partial state is recoverable via DELETE then POST.
    const stampedPlayers: Array<Pick<Player, 'id' | 'name' | 'owedAmount' | 'settledAt'>> = [];
    const stampedRows: Player[] = [];
    for (const player of participants) {
      // resplit-covered players owe nothing (their share went to the payers);
      // absorb-covered players carry the per-person figure too so the ledger
      // can total what the admin absorbed — they're just flagged writtenOff so
      // it's never collected.
      const owed = owedOf(player);
      const updated: Player = {
        ...player,
        owedAmount: owed,
        settledAt: at,
      };
      await scope.upsert('players', updated);
      stampedPlayers.push({
        id: player.id,
        name: player.name,
        owedAmount: owed,
        settledAt: at,
      });
      stampedRows.push(updated);
    }

    // The ledger mirror (docs/plans/payments.md, Phase 2): a charge per row
    // and the court cost, after the rows are saved; never fails the settle.
    await mirrorSettle(scope, updatedSession, snapshot, stampedRows);

    return NextResponse.json({
      sessionId,
      settled: snapshot,
      players: stampedPlayers,
    });
  } catch (error) {
    console.error('POST /api/session/settle error:', error);
    return NextResponse.json({ error: 'Failed to settle session' }, { status: 500 });
  }
}

/** Every row the frozen bill stamped (removed ones included). */
async function settledRows(scope: ReturnType<typeof groupScope>, sessionId: string): Promise<Player[]> {
  return scope.query<Player>('players', {
    where: 'c.sessionId = @sessionId AND IS_DEFINED(c.settledAt)',
    params: [{ name: '@sessionId', value: sessionId }],
    partitionKey: sessionId,
  });
}

/** Clear the frozen amounts off `rows` and the snapshot off the session, and void the mirror. */
async function clearSettlement(scope: ReturnType<typeof groupScope>, session: Session, rows: Player[]): Promise<void> {
  for (const player of rows) {
    const next = { ...player } as Player & { owedAmount?: number; settledAt?: string };
    delete next.owedAmount;
    delete next.settledAt;
    await scope.upsert('players', next);
  }
  const nextSession = { ...session } as Session & { settled?: SettledSnapshot };
  delete nextSession.settled;
  await scope.upsert('sessions', nextSession);
  // Mirror: void every charge, cover and the court cost the settle wrote.
  await mirrorUnsettle(scope, session, rows);
}

/**
 * DELETE /api/session/settle — clear the frozen receipt.
 *
 * Removes `session.settled` and clears each player's `owedAmount` /
 * `settledAt` for that session. Preserves `player.paid` because a paid
 * checkbox represents an independently-meaningful event ("I received
 * payment from this person") that survives a typo'd settle.
 */
export async function DELETE(req: NextRequest) {
  if (!(await isAdminAuthedWithMember(req)).authed) return unauthorized();

  try {
    const sessionId = await resolveTargetSessionId(req);
    if (!sessionId) return noActiveSession();
    const scope = groupScope(resolveGroupId(req));

    const session = await scope.read<Session>('sessions', sessionId, sessionId);
    if (!session) {
      return NextResponse.json({ error: 'Session not found' }, { status: 404 });
    }
    if (!session.settled) {
      return NextResponse.json({ error: 'Session is not settled.' }, { status: 404 });
    }

    await clearSettlement(scope, session, await settledRows(scope, sessionId));

    return NextResponse.json({ sessionId, unsettled: true });
  } catch (error) {
    console.error('DELETE /api/session/settle error:', error);
    return NextResponse.json({ error: 'Failed to unsettle session' }, { status: 500 });
  }
}
