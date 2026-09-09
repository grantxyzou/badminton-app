import { NextRequest, NextResponse } from 'next/server';
import { getActiveSessionId } from '@/lib/cosmos';
import { groupScope } from '@/lib/groupScope';
import { resolveGroupId, noActiveSession } from '@/lib/groupContext';
import { isAdminAuthedWithMember, unauthorized } from '@/lib/auth';

export const dynamic = 'force-dynamic';

/**
 * Atomic per-anomaly dismissal — appends a single anomaly code to the
 * active session's `anomaliesDismissed` array.
 *
 * Replaces the previous read-modify-write-via-PUT pattern in AnomalyFeed,
 * which had a session-doc-wipe footgun: if the GET in the read step failed
 * (transient 500 / network), the subsequent PUT would write
 * `{ anomaliesDismissed: [...] }` over the entire session doc, blowing
 * away datetime / maxPlayers / etc.
 *
 * This endpoint reads-then-writes server-side (still a small race vs.
 * concurrent admin edits, but the window is microseconds vs. the multi-
 * round-trip client version, AND we never write fields we didn't read).
 */
export async function POST(req: NextRequest) {
  if (!(await isAdminAuthedWithMember(req)).authed) return unauthorized();

  let code: string;
  try {
    const body = await req.json();
    if (typeof body?.code !== 'string' || body.code.length === 0 || body.code.length > 50) {
      return NextResponse.json({ error: 'Invalid code' }, { status: 400 });
    }
    code = body.code;
  } catch {
    return NextResponse.json({ error: 'Invalid request' }, { status: 400 });
  }

  try {
    const scope = groupScope(resolveGroupId(req));
    const sessionId = await getActiveSessionId(scope.groupId);
    if (!sessionId) return noActiveSession();
    const existing = await scope.read<{ id: string; anomaliesDismissed?: unknown }>('sessions', sessionId, sessionId);
    if (!existing) {
      return NextResponse.json({ error: 'No active session' }, { status: 404 });
    }
    const current: string[] = Array.isArray(existing.anomaliesDismissed) ? (existing.anomaliesDismissed as string[]) : [];
    if (current.includes(code)) {
      return NextResponse.json({ anomaliesDismissed: current });
    }
    const next = [...current, code];
    const updated = await scope.upsert('sessions', { ...existing, anomaliesDismissed: next });
    const result = (updated ?? { anomaliesDismissed: next }) as { anomaliesDismissed?: string[] };
    return NextResponse.json({ anomaliesDismissed: result.anomaliesDismissed ?? next });
  } catch (error) {
    console.error('POST /api/session/dismiss-anomaly error:', error);
    return NextResponse.json({ error: 'Failed to dismiss anomaly' }, { status: 500 });
  }
}
