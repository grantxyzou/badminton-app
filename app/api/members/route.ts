import { NextRequest, NextResponse } from 'next/server';
import { getContainer } from '@/lib/cosmos';
import { isAdminAuthed, unauthorized } from '@/lib/auth';
import { randomBytes } from 'crypto';

export async function GET(req: NextRequest) {
  try {
    const isAdmin = isAdminAuthed(req);
    const includeInactive = new URL(req.url).searchParams.get('all') === 'true' && isAdmin;
    const container = getContainer('members');
    const { resources } = await container.items
      .query({
        query: includeInactive
          ? 'SELECT * FROM c ORDER BY c.name ASC'
          : 'SELECT * FROM c WHERE c.active = true ORDER BY c.name ASC',
      })
      .fetchAll();
    // Non-admin: only return names (no stats or IDs)
    if (!isAdmin) {
      return NextResponse.json(resources.map((m: { name: string; active: boolean }) => ({ name: m.name, active: m.active })));
    }
    return NextResponse.json(resources);
  } catch (error) {
    console.error('GET members error:', error);
    return NextResponse.json([]);
  }
}

export async function POST(req: NextRequest) {
  if (!isAdminAuthed(req)) return unauthorized();
  try {
    const body = await req.json();
    const trimmedName = typeof body.name === 'string' ? body.name.trim() : '';
    if (!trimmedName) {
      return NextResponse.json({ error: 'Name required' }, { status: 400 });
    }
    if (trimmedName.length > 50) {
      return NextResponse.json({ error: 'Name too long (max 50 chars)' }, { status: 400 });
    }

    const container = getContainer('members');

    // Check for existing member with same name (case-insensitive)
    const { resources: existing } = await container.items
      .query({
        query: 'SELECT * FROM c WHERE LOWER(c.name) = LOWER(@name)',
        parameters: [{ name: '@name', value: trimmedName }],
      })
      .fetchAll();

    if (existing.length > 0) {
      // If inactive, reactivate instead of creating duplicate
      const inactive = existing.find((m: { active?: boolean }) => m.active === false);
      if (inactive) {
        const reactivated = { ...inactive, active: true };
        const { resource } = await container.items.upsert(reactivated);
        return NextResponse.json(resource, { status: 200 });
      }
      return NextResponse.json({ error: 'Member already exists' }, { status: 409 });
    }

    const member = {
      id: randomBytes(12).toString('hex'),
      name: trimmedName,
      stage: undefined,
      sessionCount: 0,
      lastSeen: undefined,
      createdAt: new Date().toISOString(),
      active: true,
    };

    const { resource } = await container.items.create(member);
    return NextResponse.json(resource, { status: 201 });
  } catch (error) {
    console.error('POST members error:', error);
    return NextResponse.json({ error: 'Failed to create member' }, { status: 500 });
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

    const container = getContainer('members');
    const { resource: existing } = await container.item(id, id).read();
    if (!existing) {
      return NextResponse.json({ error: 'Member not found' }, { status: 404 });
    }

    const updates: Record<string, unknown> = {};
    if (typeof body.name === 'string') updates.name = body.name.trim().slice(0, 50);
    if (typeof body.stage === 'number') updates.stage = Math.max(1, Math.min(4, body.stage));
    if (body.stage === null) updates.stage = undefined;
    if (typeof body.active === 'boolean') updates.active = body.active;

    const { resource: updated } = await container.items.upsert({ ...existing, ...updates });
    return NextResponse.json(updated);
  } catch (error) {
    console.error('PATCH members error:', error);
    return NextResponse.json({ error: 'Failed to update member' }, { status: 500 });
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

    const container = getContainer('members');

    if (body.hard === true) {
      await container.item(id, id).delete();
      return NextResponse.json({ success: true });
    }

    // Soft delete — set active: false
    const { resource: existing } = await container.item(id, id).read();
    if (!existing) {
      return NextResponse.json({ error: 'Member not found' }, { status: 404 });
    }
    const { resource: updated } = await container.items.upsert({ ...existing, active: false });
    return NextResponse.json(updated);
  } catch (error) {
    console.error('DELETE members error:', error);
    return NextResponse.json({ error: 'Failed to delete member' }, { status: 500 });
  }
}
