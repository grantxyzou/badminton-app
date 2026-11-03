/**
 * GET /api/stringing/stringers — who can be assigned a job.
 *
 * Members who string FOR THIS CLUB (`listStringers`, lib/roster.ts), which is
 * deliberately NOT `role === 'admin'`. Stringing and administering are
 * different jobs, and requiring admin to do the first meant handing over the
 * second.
 *
 * Returns names and ids only. This is a picker feed, not a member dump.
 */
import { NextRequest, NextResponse } from 'next/server';
import { isAdminAuthed } from '@/lib/auth';
import { isFlagOn } from '@/lib/flags';
import { getClientIp, checkRateLimit } from '@/lib/rateLimit';
import { resolveGroupId } from '@/lib/groupContext';
import { listStringers } from '@/lib/roster';

export const dynamic = 'force-dynamic';

const HOUR_MS = 60 * 60 * 1000;

export async function GET(req: NextRequest) {
  if (!isFlagOn('NEXT_PUBLIC_FLAG_STRINGING')) {
    return NextResponse.json({ error: 'not_found' }, { status: 404 });
  }
  const ip = getClientIp(req);
  if (!checkRateLimit(`stringers:${ip}`, 120, HOUR_MS)) {
    return NextResponse.json({ error: 'rate_limited' }, { status: 429 });
  }
  // Read-only: the cheap sync check, per the documented split.
  if (!isAdminAuthed(req)) {
    return NextResponse.json({ error: 'unauthorized' }, { status: 401 });
  }

  try {
    const stringers = await listStringers(resolveGroupId(req));
    return NextResponse.json({ stringers });
  } catch (err) {
    console.error('GET /api/stringing/stringers failed:', err);
    return NextResponse.json({ error: 'read_failed' }, { status: 503 });
  }
}
