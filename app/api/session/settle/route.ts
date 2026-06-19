import { NextRequest, NextResponse } from 'next/server';
import { getContainer, getActiveSessionId } from '@/lib/cosmos';
import { isAdminAuthedWithMember, unauthorized } from '@/lib/auth';
import { normalizeBirdUsages, totalBirdCost } from '@/lib/birdUsages';
import type { Player, Session, SettledSnapshot } from '@/lib/types';

export const dynamic = 'force-dynamic';

/**
 * Resolve which session id this request targets. Admins may override via
 * `?sessionId=` to settle a session that was already archived (e.g. they
 * advanced before remembering to settle). Falls back to the active pointer.
 */
async function resolveTargetSessionId(req: NextRequest): Promise<string> {
  const params = req.nextUrl.searchParams;
  const override = params.get('sessionId');
  if (override) return override;
  return await getActiveSessionId();
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
    const sessionsContainer = getContainer('sessions');
    const playersContainer = getContainer('players');

    const { resources: sessionDocs } = await sessionsContainer.items
      .query({
        query: 'SELECT * FROM c WHERE c.id = @id',
        parameters: [{ name: '@id', value: sessionId }],
      })
      .fetchAll();
    const session = sessionDocs[0] as Session | undefined;
    if (!session) {
      return NextResponse.json({ error: 'Session not found' }, { status: 404 });
    }
    if (session.settled) {
      return NextResponse.json(
        { error: 'Session already settled. Unsettle first to recompute.' },
        { status: 409 },
      );
    }

    const { resources: allPlayers } = await playersContainer.items
      .query({
        query: 'SELECT * FROM c WHERE c.sessionId = @sessionId AND (NOT IS_DEFINED(c.removed) OR c.removed != true) AND (NOT IS_DEFINED(c.waitlisted) OR c.waitlisted != true)',
        parameters: [{ name: '@sessionId', value: sessionId }],
      })
      .fetchAll();
    const activePlayers = allPlayers as Player[];

    if (activePlayers.length === 0) {
      return NextResponse.json(
        { error: 'No active players to settle.' },
        { status: 400 },
      );
    }

    const courtTotal = Math.round(((session.costPerCourt ?? 0) * (session.courts ?? 0)) * 100) / 100;
    const birdTotal = totalBirdCost(normalizeBirdUsages(session));
    const totalCost = Math.round((courtTotal + birdTotal) * 100) / 100;

    if (totalCost <= 0) {
      return NextResponse.json(
        { error: 'Total cost is zero — set court cost or bird usage before settling.' },
        { status: 400 },
      );
    }

    // Cover-aware denominator. A player the admin is covering (writtenOff)
    // either:
    //   - 'resplit' → excluded from the denominator, so their share is spread
    //     across the remaining payers (group total unchanged, admin pays $0);
    //   - 'absorb'  → kept in the denominator, so everyone else pays the same
    //     and the admin eats the covered player's share.
    // Legacy writtenOff with no coverMode is treated as 'absorb'.
    const isCovered = (p: Player) => p.writtenOff === true;
    const isResplit = (p: Player) => isCovered(p) && p.coverMode === 'resplit';
    const isAbsorb = (p: Player) => isCovered(p) && p.coverMode !== 'resplit';

    const resplitCount = activePlayers.filter(isResplit).length;
    const denominator = activePlayers.length - resplitCount;
    if (denominator <= 0) {
      return NextResponse.json(
        { error: 'Everyone is covered — nobody left to split the cost across.' },
        { status: 400 },
      );
    }

    const costPerPerson = Math.round((totalCost / denominator) * 100) / 100;
    const absorbCount = activePlayers.filter(isAbsorb).length;
    const coveredTotal = Math.round(absorbCount * costPerPerson * 100) / 100;
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
    await sessionsContainer.items.upsert(updatedSession);

    // Stamp each active player with their frozen owed amount.
    // Cosmos: same partition (sessionId), so failures here are unusual; we
    // still loop one-at-a-time for mock-store compatibility. If any single
    // upsert throws, partial state is recoverable via DELETE then POST.
    const stampedPlayers: Array<Pick<Player, 'id' | 'name' | 'owedAmount' | 'settledAt'>> = [];
    for (const player of activePlayers) {
      // resplit-covered players owe nothing (their share went to the payers);
      // absorb-covered players carry the per-person figure too so the ledger
      // can total what the admin absorbed — they're just flagged writtenOff so
      // it's never collected.
      const owed = isResplit(player) ? 0 : costPerPerson;
      const updated: Player = {
        ...player,
        owedAmount: owed,
        settledAt: at,
      };
      await playersContainer.items.upsert(updated);
      stampedPlayers.push({
        id: player.id,
        name: player.name,
        owedAmount: owed,
        settledAt: at,
      });
    }

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
    const sessionsContainer = getContainer('sessions');
    const playersContainer = getContainer('players');

    const { resources: sessionDocs } = await sessionsContainer.items
      .query({
        query: 'SELECT * FROM c WHERE c.id = @id',
        parameters: [{ name: '@id', value: sessionId }],
      })
      .fetchAll();
    const session = sessionDocs[0] as Session | undefined;
    if (!session) {
      return NextResponse.json({ error: 'Session not found' }, { status: 404 });
    }
    if (!session.settled) {
      return NextResponse.json({ error: 'Session is not settled.' }, { status: 404 });
    }

    const { resources: settledPlayers } = await playersContainer.items
      .query({
        query: 'SELECT * FROM c WHERE c.sessionId = @sessionId AND IS_DEFINED(c.settledAt)',
        parameters: [{ name: '@sessionId', value: sessionId }],
      })
      .fetchAll();

    for (const player of settledPlayers as Player[]) {
      const next = { ...player } as Player & { owedAmount?: number; settledAt?: string };
      delete next.owedAmount;
      delete next.settledAt;
      await playersContainer.items.upsert(next);
    }

    const nextSession = { ...session } as Session & { settled?: SettledSnapshot };
    delete nextSession.settled;
    await sessionsContainer.items.upsert(nextSession);

    return NextResponse.json({ sessionId, unsettled: true });
  } catch (error) {
    console.error('DELETE /api/session/settle error:', error);
    return NextResponse.json({ error: 'Failed to unsettle session' }, { status: 500 });
  }
}
