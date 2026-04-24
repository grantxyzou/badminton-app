import { NextRequest, NextResponse } from 'next/server';
import { getContainer } from '@/lib/cosmos';
import { isAdminAuthed, unauthorized } from '@/lib/auth';
import { normalizeBirdUsages } from '@/lib/birdUsages';
import type { BirdUsage, Session } from '@/lib/types';

export const dynamic = 'force-dynamic';

/**
 * PATCH /api/session/bird-usage — upsert a single purchase's usage into a
 * specific session's `birdUsages` array. Unlike `PUT /api/session` which
 * replaces the whole active session, this targets any session by id and
 * only touches the one array entry, so admins can retro-assign tubes to
 * archived sessions from the bird inventory page.
 *
 * Body: { sessionId: string, purchaseId: string, tubes: number (0–100, 0.25 steps) }
 * - tubes === 0 removes the entry for that purchase (undo assignment).
 */
export async function PATCH(req: NextRequest) {
  if (!isAdminAuthed(req)) return unauthorized();

  try {
    const body = await req.json();
    const sessionId = typeof body?.sessionId === 'string' ? body.sessionId : '';
    const purchaseId = typeof body?.purchaseId === 'string' ? body.purchaseId : '';
    const tubes = Number(body?.tubes);

    if (!sessionId) return NextResponse.json({ error: 'sessionId required' }, { status: 400 });
    if (!purchaseId) return NextResponse.json({ error: 'purchaseId required' }, { status: 400 });
    if (!Number.isFinite(tubes) || tubes < 0 || tubes > 100) {
      return NextResponse.json({ error: 'tubes must be between 0 and 100' }, { status: 400 });
    }
    if (Math.round(tubes * 4) !== tubes * 4) {
      return NextResponse.json({ error: 'tubes must be in 0.25 increments' }, { status: 400 });
    }

    const sessionsContainer = getContainer('sessions');
    const { resources } = await sessionsContainer.items
      .query({
        query: 'SELECT * FROM c WHERE c.id = @id',
        parameters: [{ name: '@id', value: sessionId }],
      })
      .fetchAll();
    const session = resources[0] as Session | undefined;
    if (!session) {
      return NextResponse.json({ error: 'Session not found' }, { status: 404 });
    }

    const birdsContainer = getContainer('birds');
    const { resource: purchase } = await birdsContainer.item(purchaseId, purchaseId).read();
    if (!purchase) {
      return NextResponse.json({ error: 'Purchase not found' }, { status: 404 });
    }

    // Existing usages; drop any entry for this purchase so we can re-insert cleanly.
    const existing = normalizeBirdUsages(session).filter((u) => u.purchaseId !== purchaseId);

    const next: BirdUsage[] = [...existing];
    if (tubes > 0) {
      next.push({
        purchaseId: purchase.id,
        purchaseName: purchase.name,
        tubes,
        costPerTube: purchase.costPerTube,
        totalBirdCost: Math.round(tubes * purchase.costPerTube * 100) / 100,
      });
    }

    const updated: Session = { ...session, birdUsages: next };
    // Drop legacy single-object field so it doesn't shadow the array on future reads.
    delete (updated as { birdUsage?: unknown }).birdUsage;

    const { resource } = await sessionsContainer.items.upsert(updated);
    return NextResponse.json(resource);
  } catch (error) {
    console.error('PATCH /api/session/bird-usage error:', error);
    return NextResponse.json({ error: 'Failed to update usage' }, { status: 500 });
  }
}
