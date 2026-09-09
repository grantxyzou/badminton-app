import { NextRequest, NextResponse } from 'next/server';
import { groupScope } from '@/lib/groupScope';
import { resolveGroupId } from '@/lib/groupContext';
import { isAdminAuthed, isAdminAuthedWithMember, unauthorized } from '@/lib/auth';
import { randomBytes } from 'crypto';
import type { Alias } from '@/lib/types';

export const dynamic = 'force-dynamic';

// An alias maps a club's sign-up name to an e-transfer name — payment data
// (security rule 10), and a CLUB's payment data: every read and write here is
// scoped to the group, so one club's mappings never reach another's admin.

export async function GET(req: NextRequest) {
  if (!isAdminAuthed(req)) return unauthorized();
  try {
    const resources = await groupScope(resolveGroupId(req)).query<Alias>('aliases', { orderBy: 'c.appName ASC' });
    return NextResponse.json(resources);
  } catch (error) {
    // Surface the failure (503) instead of a lying 200 + empty list — an admin
    // must not see "no aliases" (e-transfer name mappings) when the read
    // actually failed (CLAUDE.md: "Lying empty state is forbidden"). Consumers
    // already guard on res.ok.
    console.error('GET aliases error:', error);
    return NextResponse.json({ error: 'Failed to load aliases' }, { status: 503 });
  }
}

export async function POST(req: NextRequest) {
  if (!(await isAdminAuthedWithMember(req)).authed) return unauthorized();
  try {
    const body = await req.json();
    const appName = typeof body.appName === 'string' ? body.appName.trim().slice(0, 50) : '';
    const etransferName = typeof body.etransferName === 'string' ? body.etransferName.trim().slice(0, 50) : '';
    if (!appName || !etransferName) {
      return NextResponse.json({ error: 'Both names required' }, { status: 400 });
    }
    const alias: Alias = {
      id: randomBytes(12).toString('hex'),
      appName,
      etransferName,
    };
    const resource = await groupScope(resolveGroupId(req)).create('aliases', alias);
    return NextResponse.json(resource, { status: 201 });
  } catch (error) {
    console.error('POST alias error:', error);
    return NextResponse.json({ error: 'Failed to create alias' }, { status: 500 });
  }
}

export async function PATCH(req: NextRequest) {
  if (!(await isAdminAuthedWithMember(req)).authed) return unauthorized();
  try {
    const body = await req.json();
    const { id } = body;
    if (typeof id !== 'string') {
      return NextResponse.json({ error: 'Invalid request' }, { status: 400 });
    }
    const scope = groupScope(resolveGroupId(req));
    const existing = await scope.read<Alias>('aliases', id);
    if (!existing) {
      return NextResponse.json({ error: 'Alias not found' }, { status: 404 });
    }
    const updates: Record<string, string> = {};
    if (typeof body.appName === 'string') updates.appName = body.appName.trim().slice(0, 50);
    if (typeof body.etransferName === 'string') updates.etransferName = body.etransferName.trim().slice(0, 50);
    const updated = await scope.upsert('aliases', { ...existing, ...updates });
    return NextResponse.json(updated);
  } catch (error) {
    console.error('PATCH alias error:', error);
    return NextResponse.json({ error: 'Failed to update alias' }, { status: 500 });
  }
}

export async function DELETE(req: NextRequest) {
  if (!(await isAdminAuthedWithMember(req)).authed) return unauthorized();
  try {
    const body = await req.json();
    const { id } = body;
    if (typeof id !== 'string') {
      return NextResponse.json({ error: 'Invalid request' }, { status: 400 });
    }
    // A miss is a 404, not a green 200: the accessor only deletes a row it
    // verified belongs to this group.
    const removed = await groupScope(resolveGroupId(req)).remove('aliases', id);
    if (!removed) return NextResponse.json({ error: 'Alias not found' }, { status: 404 });
    return NextResponse.json({ success: true });
  } catch (error) {
    console.error('DELETE alias error:', error);
    return NextResponse.json({ error: 'Failed to delete alias' }, { status: 500 });
  }
}
