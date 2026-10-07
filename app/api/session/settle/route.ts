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
 *   - `player.owedAmount` + `player.settledAt` on each active player
 *
 * Idempotent guard: refuses if `session.settled` already exists. Admin must
 * DELETE first to re-settle. This prevents accidental re-stamps that would
 * silently redefine what already-paid players paid for.
 */
export async function POST(req: NextRequest) {
  if (!(await isAdminAuthedWithMember(req)).authed) return unauthorized();

  try {
    const sessionId = await resolveTargetSessionId(req);
    if (!sessionId) return noActiveSession();
    const scope = groupScope(resolveGroupId(req));

    const session = await scope.read<Session>('sessions', sessionId, sessionId);
    if (!session) {
      return NextResponse.json({ error: 'Session not found' }, { status: 404 });
    }
    if (session.settled) {
      return NextResponse.json(
        { error: 'Session already settled. Unsettle first to recompute.' },
        { status: 409 },
      );
    }

    const activePlayers = await scope.query<Player>('players', {
      where: ACTIVE_PLAYERS_WHERE,
      params: [{ name: '@sessionId', value: sessionId }],
    });

    if (activePlayers.length === 0) {
      return NextResponse.json(
        { error: 'No active players to settle.' },
        { status: 400 },
      );
    }

    // The one cover-aware split (lib/sessionCost.ts `costSplit`); settle
    // freezes what it returns, so every later reader takes the snapshot.
    const split = costSplit(session, activePlayers);
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

    const at = new Date().toISOString();

    const snapshot: SettledSnapshot = {
      at,
      costPerPerson,
      totalCost,
      courtTotal,
      birdTotal,
      // Denominator the per-person amount was divided by (payers + absorb-covered).
      playerCount: denominator,
      playerNames: activePlayers.map((p) => p.name),
      ...(coveredTotal > 0 ? { coveredTotal } : {}),
    };

    // Stamp session first. If player updates fail, admin can unsettle & retry.
    const updatedSession: Session = {
      ...session,
      settled: snapshot,
      signupOpen: false,
    };
    await scope.upsert('sessions', updatedSession);

    // Stamp each active player with their frozen owed amount.
    // Cosmos: same partition (sessionId), so failures here are unusual; we
    // still loop one-at-a-time for mock-store compatibility. If any single
    // upsert throws, partial state is recoverable via DELETE then POST.
    const stampedPlayers: Array<Pick<Player, 'id' | 'name' | 'owedAmount' | 'settledAt'>> = [];
    const stampedRows: Player[] = [];
    for (const player of activePlayers) {
      // resplit-covered players owe nothing (their share went to the payers);
      // absorb-covered players carry the per-person figure too so the ledger
      // can total what the admin absorbed — they're just flagged writtenOff so
      // it's never collected.
      const owed = isResplitCovered(player) ? 0 : costPerPerson;
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
    await mirrorSettle(scope, session, snapshot, stampedRows);

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

    const settledPlayers = await scope.query<Player>('players', {
      where: 'c.sessionId = @sessionId AND IS_DEFINED(c.settledAt)',
      params: [{ name: '@sessionId', value: sessionId }],
    });

    for (const player of settledPlayers) {
      const next = { ...player } as Player & { owedAmount?: number; settledAt?: string };
      delete next.owedAmount;
      delete next.settledAt;
      await scope.upsert('players', next);
    }

    const nextSession = { ...session } as Session & { settled?: SettledSnapshot };
    delete nextSession.settled;
    await scope.upsert('sessions', nextSession);

    // Mirror: void every charge, cover and the court cost the settle wrote.
    await mirrorUnsettle(scope, session, settledPlayers);

    return NextResponse.json({ sessionId, unsettled: true });
  } catch (error) {
    console.error('DELETE /api/session/settle error:', error);
    return NextResponse.json({ error: 'Failed to unsettle session' }, { status: 500 });
  }
}
