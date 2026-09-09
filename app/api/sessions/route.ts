import { NextRequest, NextResponse } from 'next/server';
import { groupScope } from '@/lib/groupScope';
import { resolveGroupId } from '@/lib/groupContext';
import { isAdminAuthed, unauthorized } from '@/lib/auth';

export const dynamic = 'force-dynamic';

export async function GET(req: NextRequest) {
  if (!isAdminAuthed(req)) return unauthorized();

  try {
    // The accessor excludes the group's pointer doc and BPM's legacy
    // 'current-session' doc from every sessions list.
    const resources = await groupScope(resolveGroupId(req)).query('sessions', { orderBy: 'c.id DESC' });
    return NextResponse.json(resources);
  } catch (error) {
    console.error('GET sessions error:', error);
    return NextResponse.json([]);
  }
}
