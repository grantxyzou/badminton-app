import { NextRequest, NextResponse } from 'next/server';
import { resolveGroupId } from '@/lib/groupContext';
import { getClientIp, checkRateLimit } from '@/lib/rateLimit';
import { requireMember } from '@/lib/auth';
import { clubTensionFor } from '@/lib/clubTension';
import { readClubGearDocs } from '@/lib/clubGearDocs';

/**
 * The tension band the club strings one racket frame at: `{ sampleSize, low,
 * high }`, or `band: null` below the cohort minimum. A range and a count,
 * never who — and built only from frame, string and tension (lib/clubTension).
 */

export const dynamic = 'force-dynamic';

export async function GET(req: NextRequest) {
  const ip = getClientIp(req);
  if (!checkRateLimit(`stats-club-tension:${ip}`, 30, 60 * 1000)) {
    return NextResponse.json({ error: 'rate_limited' }, { status: 429 });
  }
  const gate = await requireMember(req);
  if (!gate.ok) return gate.response;

  const frame = new URL(req.url).searchParams.get('frame')?.trim().slice(0, 120) ?? '';
  if (!frame) return NextResponse.json({ error: 'frame_required' }, { status: 400 });

  try {
    const docs = await readClubGearDocs(resolveGroupId(req));
    return NextResponse.json({ band: clubTensionFor(docs, frame) });
  } catch (error) {
    console.error('GET stats/club/tension error:', error);
    return NextResponse.json({ error: 'load_failed' }, { status: 500 });
  }
}
