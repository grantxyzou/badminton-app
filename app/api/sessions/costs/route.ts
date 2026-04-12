import { NextRequest, NextResponse } from 'next/server';
import { getContainer, POINTER_ID } from '@/lib/cosmos';
import { isAdminAuthed, unauthorized } from '@/lib/auth';

export const dynamic = 'force-dynamic';

/** Returns deduplicated recent costPerCourt values (admin-only). */
export async function GET(req: NextRequest) {
  if (!isAdminAuthed(req)) return unauthorized();

  try {
    const container = getContainer('sessions');
    const { resources } = await container.items
      .query({
        query: 'SELECT c.costPerCourt FROM c WHERE c.id != @pointerId AND c.id != @legacyId AND IS_NUMBER(c.costPerCourt) AND c.costPerCourt > 0 ORDER BY c.id DESC OFFSET 0 LIMIT 10',
        parameters: [
          { name: '@pointerId', value: POINTER_ID },
          { name: '@legacyId', value: 'current-session' },
        ],
      })
      .fetchAll();

    const valid = resources.filter((r: Record<string, unknown>) => typeof r.costPerCourt === 'number' && r.costPerCourt > 0);
    const unique = Array.from(new Set(valid.map((r: { costPerCourt: number }) => r.costPerCourt))).sort((a, b) => a - b);
    return NextResponse.json({ costs: unique });
  } catch (error) {
    console.error('GET sessions/costs error:', error);
    return NextResponse.json({ costs: [] });
  }
}
