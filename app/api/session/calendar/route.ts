import { NextRequest, NextResponse } from 'next/server';
import { getActiveSessionId } from '@/lib/cosmos';
import { groupScope } from '@/lib/groupScope';
import { resolveGroupId, noActiveSession } from '@/lib/groupContext';
import { requireMember } from '@/lib/auth';
import { checkRateLimit, getClientIp } from '@/lib/rateLimit';
import { outboundOriginOrNull } from '@/lib/appOrigin';
import { APP_NAME } from '@/lib/brand';
import { buildIcs, sessionCalendarEvent } from '@/lib/calendarEvent';

interface SessionDoc {
  id: string;
  title?: string;
  datetime: string;
  endDatetime?: string;
  locationName?: string;
  locationAddress?: string;
}

/**
 * This week's session as one calendar event (docs/plans/add-to-calendar.md).
 *
 * A real URL answering `text/calendar`, opened by the "Add to calendar" button
 * on the web: iOS shows its own "Add to Calendar" sheet for it, Android's
 * browser hands the file to the calendar app. `inline`, because `attachment`
 * sends iOS to Files instead. The store app uses the native plugin and never
 * reaches here (its Browser sheet would carry no cookie).
 */
export async function GET(req: NextRequest) {
  if (!checkRateLimit(`session-calendar:${getClientIp(req)}`, 30, 60_000)) {
    return NextResponse.json({ error: 'Too many requests' }, { status: 429 });
  }
  const gate = await requireMember(req);
  if (!gate.ok) return gate.response;
  try {
    const scope = groupScope(resolveGroupId(req));
    const sessionId = await getActiveSessionId(scope.groupId);
    if (!sessionId) return noActiveSession();
    const session = await scope.read<SessionDoc>('sessions', sessionId, sessionId);
    const origin = outboundOriginOrNull();
    const evt = session && sessionCalendarEvent(session, {
      fallbackTitle: `${APP_NAME} badminton`,
      url: origin ? `${origin}/bpm/` : undefined,
      host: origin ? new URL(origin).host : undefined,
    });
    if (!evt) return noActiveSession();
    return new NextResponse(buildIcs(evt), {
      headers: {
        'Content-Type': 'text/calendar; charset=utf-8',
        'Content-Disposition': 'inline; filename="badminton.ics"',
        'Cache-Control': 'no-store',
      },
    });
  } catch (error) {
    console.error('GET session calendar error:', error);
    return NextResponse.json({ error: 'read_failed' }, { status: 503 });
  }
}
