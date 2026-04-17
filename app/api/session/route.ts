import { NextRequest, NextResponse } from 'next/server';
import { getContainer, getActiveSessionId, POINTER_ID, DEFAULT_SESSION } from '@/lib/cosmos';
import { isAdminAuthed, unauthorized } from '@/lib/auth';
import type { BirdUsage } from '@/lib/types';

export const dynamic = 'force-dynamic';

export async function GET() {
  try {
    const sessionId = await getActiveSessionId();
    const container = getContainer('sessions');
    const { resources } = await container.items
      .query({
        query: 'SELECT * FROM c WHERE c.id = @id',
        parameters: [{ name: '@id', value: sessionId }],
      })
      .fetchAll();
    const session = resources.find((r) => r.id !== POINTER_ID);
    return NextResponse.json(session ?? { ...DEFAULT_SESSION, id: sessionId, sessionId });
  } catch (error) {
    console.error('GET session error:', error);
    return NextResponse.json(DEFAULT_SESSION);
  }
}

export function toValidIso(val: unknown): string {
  const s = String(val ?? '').slice(0, 30);
  return s && !isNaN(Date.parse(s)) ? s : '';
}

export async function PUT(req: NextRequest) {
  if (!isAdminAuthed(req)) return unauthorized();

  try {
    const body = await req.json();
    const sessionId = await getActiveSessionId();

    const session = {
      id: sessionId,
      sessionId,
      title: String(body.title ?? '').trim().slice(0, 100),
      locationName: String(body.locationName ?? '').trim().slice(0, 200),
      locationAddress: String(body.locationAddress ?? '').trim().slice(0, 300),
      datetime: toValidIso(body.datetime),
      endDatetime: toValidIso(body.endDatetime),
      deadline: toValidIso(body.deadline),
      courts: Math.max(1, Math.min(20, parseInt(body.courts, 10) || 2)),
      maxPlayers: Math.max(1, Math.min(100, parseInt(body.maxPlayers, 10) || 12)),
      signupOpen: typeof body.signupOpen === 'boolean' ? body.signupOpen : undefined,
      costPerCourt: typeof body.costPerCourt === 'number' ? Math.max(0, Math.min(500, body.costPerCourt)) : undefined,
      showCostBreakdown: typeof body.showCostBreakdown === 'boolean' ? body.showCostBreakdown : undefined,
    };

    // Handle bird usages — array of { purchaseId, tubes }. Each entry is
    // looked up live so cost snapshots are authoritative.
    let birdUsages: BirdUsage[] | undefined = undefined;
    if (Array.isArray(body.birdUsages)) {
      const entries: BirdUsage[] = [];
      const birdsContainer = getContainer('birds');
      for (const entry of body.birdUsages) {
        const tubes = Number(entry?.tubes);
        if (!Number.isFinite(tubes) || tubes <= 0 || tubes > 100) {
          return NextResponse.json({ error: 'Bird tubes must be between 0 and 100' }, { status: 400 });
        }
        // Multiple of 0.25 — rejects 0.33, 1.7, etc.
        if (Math.round(tubes * 4) !== tubes * 4) {
          return NextResponse.json({ error: 'Bird tubes must be in 0.25 increments' }, { status: 400 });
        }
        const purchaseId = entry?.purchaseId;
        if (typeof purchaseId !== 'string' || !purchaseId) {
          return NextResponse.json({ error: 'Bird purchase must be selected' }, { status: 400 });
        }
        const { resource: purchase } = await birdsContainer.item(purchaseId, purchaseId).read();
        if (!purchase) {
          return NextResponse.json({ error: 'Selected bird purchase not found' }, { status: 404 });
        }
        entries.push({
          purchaseId: purchase.id,
          purchaseName: purchase.name,
          tubes,
          costPerTube: purchase.costPerTube,
          totalBirdCost: Math.round(tubes * purchase.costPerTube * 100) / 100,
        });
      }
      birdUsages = entries;
    }

    const sessionData: Record<string, unknown> = { ...session };
    if (birdUsages !== undefined) {
      sessionData.birdUsages = birdUsages;
      // Drop legacy single-object field so it doesn't linger alongside the array.
      // Cosmos upsert replaces the whole doc, so simply omitting would also work,
      // but setting undefined makes the intent explicit.
    }

    const container = getContainer('sessions');
    const { resource } = await container.items.upsert(sessionData);
    return NextResponse.json(resource);
  } catch (error) {
    console.error('PUT session error:', error);
    return NextResponse.json({ error: 'Failed to update session' }, { status: 500 });
  }
}
