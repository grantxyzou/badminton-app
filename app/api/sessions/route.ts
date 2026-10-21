import { NextRequest, NextResponse } from 'next/server';
import { groupScope } from '@/lib/groupScope';
import { resolveGroupId } from '@/lib/groupContext';
import { isAdminAuthed, unauthorized } from '@/lib/auth';
import { SESSION_CALENDAR_LIMIT } from '@/lib/sessionCalendar';
import type { Session } from '@/lib/types';

export const dynamic = 'force-dynamic';

/** What the two consumers read from a row, and nothing else. */
type SessionListRow = Pick<
  Session,
  'id' | 'datetime' | 'title' | 'courts' | 'costPerCourt' | 'birdUsages' | 'birdUsage' | 'settled' | 'eTransferRecipient'
>;

/**
 * The fields the list's consumers read — the Payments card (`id`, `datetime`,
 * `settled`, `eTransferRecipient`, and the cost inputs `buildReceiptInput`
 * recomputes an unsettled session from) and the bird-usage assign sheet
 * (`id`, `datetime`, `title`, the usages). Everything else on a session doc
 * — the invite list, the advance snapshot, the anomaly lists, the sign-up
 * stamps — rode along on every open of the picker and was never read.
 */
const SESSION_LIST_SELECT =
  'c.id, c.datetime, c.title, c.courts, c.costPerCourt, c.birdUsages, c.birdUsage, c.settled, c.eTransferRecipient';

/**
 * GET /api/sessions — admin-only list of the club's sessions, newest first,
 * for the Payments card's session picker and the bird-usage assign sheet.
 *
 * Bounded to `SESSION_CALENDAR_LIMIT` in SQL — the same cap the calendar's
 * owing dots read under (`/api/sessions/history?counts=1`), so the two
 * agree on which sessions exist. The JS sort + slice stays because the mock
 * store ignores ORDER BY / LIMIT (same contract as sessions/recent).
 */
export async function GET(req: NextRequest) {
  if (!isAdminAuthed(req)) return unauthorized();

  try {
    // The accessor excludes the group's pointer doc and BPM's legacy
    // 'current-session' doc from every sessions list.
    const rows = await groupScope(resolveGroupId(req)).query<SessionListRow>('sessions', {
      select: SESSION_LIST_SELECT,
      orderBy: 'c.id DESC',
      limit: SESSION_CALENDAR_LIMIT,
    });
    const resources = rows
      .sort((a, b) => (a.id < b.id ? 1 : a.id > b.id ? -1 : 0))
      .slice(0, SESSION_CALENDAR_LIMIT);
    return NextResponse.json(resources);
  } catch (error) {
    // 503, not `[]` with a 200 — an outage must look like one.
    console.error('GET sessions error:', error);
    return NextResponse.json({ error: 'read_failed' }, { status: 503 });
  }
}
