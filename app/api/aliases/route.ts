import { NextRequest, NextResponse } from 'next/server';
import { groupScope } from '@/lib/groupScope';
import { resolveGroupId } from '@/lib/groupContext';
import { isAdminAuthed, isAdminAuthedWithMember, unauthorized } from '@/lib/auth';
import { createAlias, readAlias, readAliases, removeAlias, updateAlias } from '@/lib/aliases';

export const dynamic = 'force-dynamic';

// An alias maps a club's sign-up name to an e-transfer name — payment data
// (security rule 10), and a CLUB's payment data: every read and write here is
// scoped to the group, so one club's mappings never reach another's admin.
// Where a row lives (a `kind: 'alias'` doc in `clubSettings`) is lib/aliases.ts.

export async function GET(req: NextRequest) {
  if (!isAdminAuthed(req)) return unauthorized();
  try {
    return NextResponse.json(await readAliases(groupScope(resolveGroupId(req))));
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
    const resource = await createAlias(groupScope(resolveGroupId(req)), { appName, etransferName });
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
    const existing = await readAlias(scope, id);
    if (!existing) {
      return NextResponse.json({ error: 'Alias not found' }, { status: 404 });
    }
    const updates: Record<string, string> = {};
    if (typeof body.appName === 'string') updates.appName = body.appName.trim().slice(0, 50);
    if (typeof body.etransferName === 'string') updates.etransferName = body.etransferName.trim().slice(0, 50);
    // `replace`, never `upsert`: a row deleted between the read and the write
    // stays deleted and the admin sees a 404 rather than a resurrection.
    const updated = await updateAlias(scope, { ...existing, ...updates });
    if (!updated) return NextResponse.json({ error: 'Alias not found' }, { status: 404 });
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
    // A miss is a 404, not a green 200: only a row verified to be this
    // group's alias is deleted.
    const removed = await removeAlias(groupScope(resolveGroupId(req)), id);
    if (!removed) return NextResponse.json({ error: 'Alias not found' }, { status: 404 });
    return NextResponse.json({ success: true });
  } catch (error) {
    console.error('DELETE alias error:', error);
    return NextResponse.json({ error: 'Failed to delete alias' }, { status: 500 });
  }
}
