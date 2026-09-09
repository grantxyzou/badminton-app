import { NextRequest, NextResponse } from 'next/server';
import { groupScope } from '@/lib/groupScope';
import { resolveGroupId } from '@/lib/groupContext';
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

    const scope = groupScope(resolveGroupId(req));
    const resources = await scope.query<{ id: string; type?: string; tubes?: number; delta?: number }>('birds');
    const purchases = resources.filter((d) => d.type !== 'adjustment');
    const adjustments = resources.filter((d) => d.type === 'adjustment');
    const totalPurchased = purchases.reduce((sum, p) => sum + (p.tubes ?? 0), 0);
    const totalAdjustments = adjustments.reduce((sum, a) => sum + (a.delta ?? 0), 0);

    const sessions = await scope.query<Pick<Session, 'birdUsage' | 'birdUsages'>>('sessions', {
      select: 'c.birdUsage, c.birdUsages',
      where: 'IS_DEFINED(c.birdUsage) OR IS_DEFINED(c.birdUsages)',
      includeLegacy: true, // same rule as GET /api/birds, so the delta matches the display
    });
    // Sum RAW, round once — the same rule GET /api/birds uses, so this delta
    // can never disagree with the displayed stock by a rounding penny.
    const totalUsed = sessions.reduce(
      (sum, s) => sum + totalTubes(normalizeBirdUsages(s)),
      0,
    );

    // Deliberately UNCLAMPED (GET clamps its display at 0 + reports the
    // overshoot as stockDrift): the delta must offset the true raw stock so
    // that after reconciling, raw stock === counted. Clamping here would
    // under-adjust a drifted inventory.
    const currentStock = Math.round((totalPurchased + totalAdjustments - totalUsed) * 100) / 100;
    const delta = Math.round((counted - currentStock) * 100) / 100;

    if (delta === 0) {
      return NextResponse.json({ error: 'Count already matches — nothing to reconcile.', currentStock }, { status: 400 });
    }

    const reason = typeof body.reason === 'string' ? body.reason.trim().slice(0, 200) : '';
    const adjustment: Record<string, unknown> & { id: string } = {
      id: randomBytes(12).toString('hex'),
      type: 'adjustment',
      delta,
      countedTotal: counted,
      date: new Date().toISOString().slice(0, 10),
      createdAt: new Date().toISOString(),
    };
    if (reason) adjustment.reason = reason;

    const resource = await scope.create('birds', adjustment);
    return NextResponse.json({ adjustment: resource, currentStock: counted, delta }, { status: 201 });
  } catch (error) {
    console.error('POST birds/reconcile error:', error);
    return NextResponse.json({ error: 'Failed to reconcile count' }, { status: 500 });
  }
}
