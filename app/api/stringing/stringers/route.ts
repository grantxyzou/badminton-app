/**
 * GET /api/stringing/stringers — who can be assigned a job.
 *
 * Members with `canString`, which is deliberately NOT `role === 'admin'`.
 * Stringing and administering are different jobs, and requiring admin to do
 * the first meant handing over the second.
 *
 * Returns names and ids only. This is a picker feed, not a member dump.
 */
import { NextRequest, NextResponse } from 'next/server';
import { getContainer } from '@/lib/cosmos';
import { isAdminAuthed } from '@/lib/auth';
import { isFlagOn } from '@/lib/flags';
import { getClientIp, checkRateLimit } from '@/lib/rateLimit';
import type { Member } from '@/lib/types';

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
    const { resources } = await getContainer('members')
      .items.query<Member>({ query: 'SELECT * FROM c WHERE c.canString = true', parameters: [] })
      .fetchAll();

    /* Re-filtered in JS. The mock store matches on parameter NAMES and this
       query binds none, so `c.canString = true` is invisible to it and every
       member comes back — which would put the whole club in the assign
       picker. Production Cosmos honours the WHERE; the test environment needs
       this line. Same hazard, same shape, as the admin push query. */
    const stringers = resources
      .filter((m) => m.canString === true && m.active !== false)
      .map((m) => ({ id: m.id, name: m.name }))
      .sort((a, b) => a.name.localeCompare(b.name));

    return NextResponse.json({ stringers });
  } catch (err) {
    console.error('GET /api/stringing/stringers failed:', err);
    return NextResponse.json({ error: 'read_failed' }, { status: 503 });
  }
}
