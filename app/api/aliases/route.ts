import { NextRequest, NextResponse } from 'next/server';
import { getContainer } from '@/lib/cosmos';
import { isAdminAuthed, unauthorized } from '@/lib/auth';
import { randomBytes } from 'crypto';

export const dynamic = 'force-dynamic';

export async function GET(req: NextRequest) {
  if (!isAdminAuthed(req)) return unauthorized();
  try {
    const container = getContainer('aliases');
    const { resources } = await container.items
      .query({ query: 'SELECT * FROM c ORDER BY c.appName ASC' })
      .fetchAll();
    return NextResponse.json(resources);
  } catch (error) {
    console.error('GET aliases error:', error);
    return NextResponse.json([]);
  }
}

export async function POST(req: NextRequest) {
  if (!isAdminAuthed(req)) return unauthorized();
  try {
    const body = await req.json();
    const appName = typeof body.appName === 'string' ? body.appName.trim().slice(0, 50) : '';
    const etransferName = typeof body.etransferName === 'string' ? body.etransferName.trim().slice(0, 50) : '';
    if (!appName || !etransferName) {
      return NextResponse.json({ error: 'Both names required' }, { status: 400 });
    }
    const alias = {
      id: randomBytes(12).toString('hex'),
      appName,
      etransferName,
    };
    const container = getContainer('aliases');
    const { resource } = await container.items.create(alias);
    return NextResponse.json(resource, { status: 201 });
  } catch (error) {
    console.error('POST alias error:', error);
    return NextResponse.json({ error: 'Failed to create alias' }, { status: 500 });
  }
}

export async function PATCH(req: NextRequest) {
  if (!isAdminAuthed(req)) return unauthorized();
  try {
    const body = await req.json();
    const { id } = body;
    if (typeof id !== 'string') {
      return NextResponse.json({ error: 'Invalid request' }, { status: 400 });
    }
    const container = getContainer('aliases');
    const { resource: existing } = await container.item(id, id).read();
    if (!existing) {
      return NextResponse.json({ error: 'Alias not found' }, { status: 404 });
    }
    const updates: Record<string, string> = {};
    if (typeof body.appName === 'string') updates.appName = body.appName.trim().slice(0, 50);
    if (typeof body.etransferName === 'string') updates.etransferName = body.etransferName.trim().slice(0, 50);
    const { resource: updated } = await container.items.upsert({ ...existing, ...updates });
    return NextResponse.json(updated);
  } catch (error) {
    console.error('PATCH alias error:', error);
    return NextResponse.json({ error: 'Failed to update alias' }, { status: 500 });
  }
}

export async function DELETE(req: NextRequest) {
  if (!isAdminAuthed(req)) return unauthorized();
  try {
    const body = await req.json();
    const { id } = body;
    if (typeof id !== 'string') {
      return NextResponse.json({ error: 'Invalid request' }, { status: 400 });
    }
    const container = getContainer('aliases');
    await container.item(id, id).delete();
    return NextResponse.json({ success: true });
  } catch (error) {
    console.error('DELETE alias error:', error);
    return NextResponse.json({ error: 'Failed to delete alias' }, { status: 500 });
  }
}
