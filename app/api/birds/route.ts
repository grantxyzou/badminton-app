import { NextRequest, NextResponse } from 'next/server';
import { getContainer } from '@/lib/cosmos';
import { randomBytes } from 'crypto';
import { isAdminAuthed, unauthorized } from '@/lib/auth';

export async function GET(req: NextRequest) {
  if (!isAdminAuthed(req)) return unauthorized();

  try {
    const container = getContainer('birds');
    const { resources } = await container.items
      .query({ query: 'SELECT * FROM c ORDER BY c.date DESC' })
      .fetchAll();

    // Compute current stock: total purchased - total used across sessions
    const totalPurchased = resources.reduce((sum: number, p: { tubes: number }) => sum + p.tubes, 0);

    const sessionsContainer = getContainer('sessions');
    const { resources: sessions } = await sessionsContainer.items
      .query({ query: 'SELECT c.birdUsage FROM c WHERE IS_DEFINED(c.birdUsage)' })
      .fetchAll();
    const totalUsed = sessions.reduce(
      (sum: number, s: { birdUsage?: { tubes: number } }) => sum + (s.birdUsage?.tubes ?? 0),
      0,
    );

    return NextResponse.json({
      purchases: resources,
      currentStock: totalPurchased - totalUsed,
      totalPurchased,
      totalUsed,
    });
  } catch (error) {
    console.error('GET birds error:', error);
    return NextResponse.json({ purchases: [], currentStock: 0 });
  }
}

export async function POST(req: NextRequest) {
  if (!isAdminAuthed(req)) return unauthorized();

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
  if (!isAdminAuthed(req)) return unauthorized();

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
