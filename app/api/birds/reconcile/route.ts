import { NextRequest, NextResponse } from 'next/server';
import { getContainer } from '@/lib/cosmos';
import { randomBytes } from 'crypto';
import { isAdminAuthedWithMember, unauthorized } from '@/lib/auth';
import { normalizeBirdUsages, totalTubes } from '@/lib/birdUsages';
import type { Session } from '@/lib/types';

/**
 * Reconcile the on-hand bird count to a physical recount. The admin enters the
 * number of tubes they actually counted; the server computes the delta against
 * the authoritative current stock (purchased + prior adjustments − used) and
 * stores it as a discriminated `type: 'adjustment'` doc in the birds container.
 * After this, GET /api/birds reports currentStock === countedTotal.
 *
 * A no-op (delta === 0) is rejected so we don't litter the audit trail.
 * Undo = DELETE /api/birds with the adjustment's id.
 */
export async function POST(req: NextRequest) {
  if (!(await isAdminAuthedWithMember(req)).authed) return unauthorized();

  try {
    const body = await req.json();
    const countedTotal = typeof body.countedTotal === 'number' ? body.countedTotal : NaN;
    if (!Number.isFinite(countedTotal) || countedTotal < 0) {
      return NextResponse.json({ error: 'Counted total must be a number ≥ 0' }, { status: 400 });
    }
    // Match the inventory's 0.25-tube granularity.
    const counted = Math.round(countedTotal * 4) / 4;

    const container = getContainer('birds');
    const { resources } = await container.items
      .query({ query: 'SELECT * FROM c' })
      .fetchAll();
    const purchases = resources.filter((d: { type?: string }) => d.type !== 'adjustment');
    const adjustments = resources.filter((d: { type?: string }) => d.type === 'adjustment');
    const totalPurchased = purchases.reduce((sum: number, p: { tubes: number }) => sum + p.tubes, 0);
    const totalAdjustments = adjustments.reduce((sum: number, a: { delta?: number }) => sum + (a.delta ?? 0), 0);

    const sessionsContainer = getContainer('sessions');
    const { resources: sessions } = await sessionsContainer.items
      .query({ query: 'SELECT c.birdUsage, c.birdUsages FROM c WHERE IS_DEFINED(c.birdUsage) OR IS_DEFINED(c.birdUsages)' })
      .fetchAll();
    const totalUsed = (sessions as Pick<Session, 'birdUsage' | 'birdUsages'>[]).reduce(
      (sum, s) => sum + totalTubes(normalizeBirdUsages(s)),
      0,
    );

    const currentStock = Math.round((totalPurchased + totalAdjustments - totalUsed) * 100) / 100;
    const delta = Math.round((counted - currentStock) * 100) / 100;

    if (delta === 0) {
      return NextResponse.json({ error: 'Count already matches — nothing to reconcile.', currentStock }, { status: 400 });
    }

    const reason = typeof body.reason === 'string' ? body.reason.trim().slice(0, 200) : '';
    const adjustment: Record<string, unknown> = {
      id: randomBytes(12).toString('hex'),
      type: 'adjustment',
      delta,
      countedTotal: counted,
      date: new Date().toISOString().slice(0, 10),
      createdAt: new Date().toISOString(),
    };
    if (reason) adjustment.reason = reason;

    const { resource } = await container.items.create(adjustment);
    return NextResponse.json({ adjustment: resource, currentStock: counted, delta }, { status: 201 });
  } catch (error) {
    console.error('POST birds/reconcile error:', error);
    return NextResponse.json({ error: 'Failed to reconcile count' }, { status: 500 });
  }
}
