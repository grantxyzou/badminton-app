import { NextRequest, NextResponse } from 'next/server';
import { getContainer } from '@/lib/cosmos';
import { randomBytes } from 'crypto';
import { isAdminAuthed, isAdminAuthedWithMember, unauthorized } from '@/lib/auth';
import { normalizeBirdUsages, totalTubes } from '@/lib/birdUsages';
import type { Session } from '@/lib/types';

export async function GET(req: NextRequest) {
  if (!isAdminAuthed(req)) return unauthorized();

  try {
    const container = getContainer('birds');
    const { resources } = await container.items
      .query({ query: 'SELECT * FROM c ORDER BY c.date DESC' })
      .fetchAll();

    // The birds container holds two doc kinds, discriminated by `type`:
    // purchases (no `type` or 'purchase') and reconciliation adjustments
    // ('adjustment'). Split them so purchase math never sees adjustment docs.
    const purchases = resources.filter((d: { type?: string }) => d.type !== 'adjustment');
    const adjustments = resources.filter((d: { type?: string }) => d.type === 'adjustment');

    // Compute current stock: total purchased + manual adjustments - total used
    const totalPurchased = purchases.reduce((sum: number, p: { tubes: number }) => sum + p.tubes, 0);
    const totalAdjustments = adjustments.reduce((sum: number, a: { delta?: number }) => sum + (a.delta ?? 0), 0);

    const sessionsContainer = getContainer('sessions');
    // Pull datetime alongside the usage shapes so we can compute recent-window
    // stats (last 60 days). Burn rate consumers should use those, not
    // totalUsed / recentSessionCount, which mixes time scales.
    const { resources: sessions } = await sessionsContainer.items
      .query({ query: 'SELECT c.birdUsage, c.birdUsages, c.datetime FROM c WHERE IS_DEFINED(c.birdUsage) OR IS_DEFINED(c.birdUsages)' })
      .fetchAll();

    // All-time tubes used, both in total and per purchase. The per-purchase
    // map drives `remainingByPurchase`, which the create-session bird picker
    // uses to hide depleted purchases (remaining <= 0).
    // Sum RAW and round once at the end — the same rule reconcile uses, so a
    // stock-take delta can never be a rounding penny off from the stock this
    // GET displays. (Previously totalUsed was pre-rounded before the stock
    // formula while reconcile summed raw.)
    const usedByPurchase = new Map<string, number>();
    let totalUsedRaw = 0;
    for (const s of sessions as Pick<Session, 'birdUsage' | 'birdUsages'>[]) {
      for (const u of normalizeBirdUsages(s)) {
        const t = u.tubes ?? 0;
        totalUsedRaw += t;
        usedByPurchase.set(u.purchaseId, (usedByPurchase.get(u.purchaseId) ?? 0) + t);
      }
    }
    const totalUsed = Math.round(totalUsedRaw * 100) / 100;

    // Clamped at 0 for display — a purchase can be over-consumed (e.g. its
    // tubes were edited down after sessions used them), but negative
    // "remaining" is meaningless to the picker (which hides remaining <= 0).
    const remainingByPurchase: Record<string, number> = {};
    for (const p of purchases as { id: string; tubes: number }[]) {
      remainingByPurchase[p.id] = Math.max(0, Math.round((p.tubes - (usedByPurchase.get(p.id) ?? 0)) * 100) / 100);
    }

    const sixtyDaysAgo = Date.now() - 60 * 86_400_000;
    let recentSessionsLast60d = 0;
    let recentUsedLast60d = 0;
    for (const s of sessions as Array<Pick<Session, 'birdUsage' | 'birdUsages'> & { datetime?: string }>) {
      if (typeof s.datetime !== 'string') continue;
      const t = new Date(s.datetime).getTime();
      if (!Number.isFinite(t) || t < sixtyDaysAgo) continue;
      recentSessionsLast60d++;
      recentUsedLast60d += totalTubes(normalizeBirdUsages(s));
    }
    const burnPerSession = recentSessionsLast60d > 0
      ? recentUsedLast60d / recentSessionsLast60d
      : 0;

    // Stock can go negative when recorded usage exceeds recorded purchases
    // (a purchase edited down or deleted after sessions consumed it). Display
    // clamps at 0; the overshoot is surfaced as `stockDrift` so the skew is
    // visible instead of silently rendering "-3 tubes on hand".
    const currentStockRaw = Math.round((totalPurchased + totalAdjustments - totalUsedRaw) * 100) / 100;
    const currentStock = Math.max(0, currentStockRaw);
    const stockDrift = currentStockRaw < 0 ? Math.abs(currentStockRaw) : 0;

    return NextResponse.json({
      purchases,
      adjustments,
      remainingByPurchase,
      currentStock,
      /** Tubes recorded as used beyond recorded purchases (0 when records balance). */
      stockDrift,
      totalPurchased,
      totalAdjustments,
      totalUsed,
      // Last-60-day stats — apples-to-apples for burn rate
      recentSessionsLast60d,
      recentUsedLast60d,
      burnPerSession,
    });
  } catch (error) {
    // 503, never a lying 200 + zero stock (CLAUDE.md: lying empty state is
    // forbidden) — a confident "0 tubes on hand" on a broken backend reads
    // as "time to reorder". Clients guard on res.ok.
    console.error('GET birds error:', error);
    return NextResponse.json({ error: 'Failed to load bird inventory' }, { status: 503 });
  }
}

export async function POST(req: NextRequest) {
  if (!(await isAdminAuthedWithMember(req)).authed) return unauthorized();

  try {
    const body = await req.json();
    const name = typeof body.name === 'string' ? body.name.trim().slice(0, 100) : '';
    const tubes = typeof body.tubes === 'number' ? body.tubes : 0;
    const totalCost = typeof body.totalCost === 'number' ? body.totalCost : 0;
    const date = typeof body.date === 'string' ? body.date.slice(0, 10) : new Date().toISOString().slice(0, 10);

    if (!name) return NextResponse.json({ error: 'Shuttle name required' }, { status: 400 });
    if (tubes <= 0) return NextResponse.json({ error: 'Tubes must be greater than 0' }, { status: 400 });
    if (totalCost <= 0) return NextResponse.json({ error: 'Cost must be greater than 0' }, { status: 400 });

    const purchase: Record<string, unknown> = {
      id: randomBytes(12).toString('hex'),
      name,
      tubes,
      totalCost: Math.round(totalCost * 100) / 100,
      costPerTube: Math.round((totalCost / tubes) * 100) / 100,
      date,
      createdAt: new Date().toISOString(),
    };

    // Optional fields
    if (typeof body.speed === 'number' && body.speed > 0) {
      purchase.speed = body.speed;
    }
    if (typeof body.qualityRating === 'number' && body.qualityRating >= 1 && body.qualityRating <= 5) {
      purchase.qualityRating = Math.round(body.qualityRating);
    }
    if (typeof body.notes === 'string' && body.notes.trim()) {
      purchase.notes = body.notes.trim().slice(0, 500);
    }

    const container = getContainer('birds');
    const { resource } = await container.items.create(purchase);
    return NextResponse.json(resource, { status: 201 });
  } catch (error) {
    console.error('POST birds error:', error);
    return NextResponse.json({ error: 'Failed to add purchase' }, { status: 500 });
  }
}

export async function DELETE(req: NextRequest) {
  if (!(await isAdminAuthedWithMember(req)).authed) return unauthorized();

  try {
    const body = await req.json();
    const { id } = body;
    if (typeof id !== 'string') {
      return NextResponse.json({ error: 'ID required' }, { status: 400 });
    }

    const container = getContainer('birds');
    await container.item(id, id).delete();
    return NextResponse.json({ success: true });
  } catch (error) {
    console.error('DELETE birds error:', error);
    return NextResponse.json({ error: 'Failed to delete' }, { status: 500 });
  }
}

export async function PATCH(req: NextRequest) {
  if (!(await isAdminAuthedWithMember(req)).authed) return unauthorized();

  try {
    const body = await req.json();
    const { id } = body;
    if (typeof id !== 'string') {
      return NextResponse.json({ error: 'ID required' }, { status: 400 });
    }

    const container = getContainer('birds');
    const { resource: existing } = await container.item(id, id).read();
    if (!existing) {
      return NextResponse.json({ error: 'Purchase not found' }, { status: 404 });
    }

    const updated = { ...existing };

    if (typeof body.name === 'string') {
      const name = body.name.trim().slice(0, 100);
      if (!name) return NextResponse.json({ error: 'Name cannot be empty' }, { status: 400 });
      updated.name = name;
    }
    if (typeof body.tubes === 'number') {
      if (body.tubes <= 0) return NextResponse.json({ error: 'Tubes must be greater than 0' }, { status: 400 });
      updated.tubes = body.tubes;
    }
    if (typeof body.totalCost === 'number') {
      if (body.totalCost <= 0) return NextResponse.json({ error: 'Cost must be greater than 0' }, { status: 400 });
      updated.totalCost = Math.round(body.totalCost * 100) / 100;
    }
    if (typeof body.date === 'string') {
      updated.date = body.date.slice(0, 10);
    }

    // Recalculate costPerTube only when cost inputs change
    if (typeof body.tubes === 'number' || typeof body.totalCost === 'number') {
      updated.costPerTube = Math.round((updated.totalCost / updated.tubes) * 100) / 100;
    }

    // Optional fields — set value or clear with null
    if ('speed' in body) {
      updated.speed = (typeof body.speed === 'number' && body.speed > 0) ? body.speed : undefined;
    }
    if ('qualityRating' in body) {
      updated.qualityRating = (typeof body.qualityRating === 'number' && body.qualityRating >= 1 && body.qualityRating <= 5)
        ? Math.round(body.qualityRating) : undefined;
    }
    if ('notes' in body) {
      updated.notes = (typeof body.notes === 'string' && body.notes.trim())
        ? body.notes.trim().slice(0, 500) : undefined;
    }

    const { resource } = await container.items.upsert(updated);
    return NextResponse.json(resource);
  } catch (error) {
    console.error('PATCH birds error:', error);
    return NextResponse.json({ error: 'Failed to update purchase' }, { status: 500 });
  }
}
