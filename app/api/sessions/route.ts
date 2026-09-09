import { NextRequest, NextResponse } from 'next/server';
import { SESSION_ID } from '@/lib/cosmos';
import { groupScope } from '@/lib/groupScope';
import { resolveGroupId } from '@/lib/groupContext';
import { isAdminAuthed, unauthorized } from '@/lib/auth';

export const dynamic = 'force-dynamic';

export async function GET(req: NextRequest) {
  if (!isAdminAuthed(req)) return unauthorized();

  try {
    // The group's pointer doc is excluded by the accessor; the legacy
    // 'current-session' doc (BPM's pre-pointer default) is excluded here, as
    // every list has always done.
    const resources = await groupScope(resolveGroupId(req)).query('sessions', {
      where: 'c.id != @legacyId',
      params: [{ name: '@legacyId', value: SESSION_ID }],
      orderBy: 'c.id DESC',
    });
    return NextResponse.json(resources);
  } catch (error) {
    console.error('GET sessions error:', error);
    return NextResponse.json([]);
  }
}
