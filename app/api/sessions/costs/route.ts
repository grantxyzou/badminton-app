import { NextRequest, NextResponse } from 'next/server';
import { groupScope } from '@/lib/groupScope';
import { resolveGroupId } from '@/lib/groupContext';
import { isAdminAuthedWithMember, unauthorized } from '@/lib/auth';

export const dynamic = 'force-dynamic';

/**
 * Returns deduplicated recent costPerCourt values (admin-only). What the club
 * pays for a court, so the admin is re-read on every call: the cookie alone
 * kept answering a demoted or removed admin for its 30 days.
 */
export async function GET(req: NextRequest) {
  if (!(await isAdminAuthedWithMember(req)).authed) return unauthorized();

  try {
    const resources = await groupScope(resolveGroupId(req)).query<{ costPerCourt: number }>('sessions', {
      select: 'c.costPerCourt',
      where: 'IS_NUMBER(c.costPerCourt) AND c.costPerCourt > 0',
      orderBy: 'c.id DESC',
      limit: 10,
    });

    const valid = resources.filter((r: Record<string, unknown>) => typeof r.costPerCourt === 'number' && r.costPerCourt > 0);
    const unique = Array.from(new Set(valid.map((r: { costPerCourt: number }) => r.costPerCourt))).sort((a, b) => a - b);
    return NextResponse.json({ costs: unique });
  } catch (error) {
    // Surface the failure (503) instead of a lying 200 + empty list — a 200
    // here reads as "no prior costs to suggest" when the read actually failed
    // (CLAUDE.md: "Lying empty state is forbidden"). Consumers guard on res.ok.
    console.error('GET sessions/costs error:', error);
    return NextResponse.json({ error: 'Failed to load costs' }, { status: 503 });
  }
}
