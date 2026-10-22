/**
 * GET /api/widget — everything the home-screen widget draws
 * (docs/plans/native-widgets.md).
 *
 * The widget runs outside the WebView and has no cookies, so it authenticates
 * with its own bearer pass (`POST /api/widget/token`). The pass names a
 * person and a group; `requireWidgetMember` re-reads the membership, so a
 * removed member's widget stops getting data on its next refresh.
 *
 * A failed read answers 503, never a default body: the widget then keeps what
 * it last showed under its "Updated" time instead of drawing a confident $0.
 */
import { NextRequest, NextResponse } from 'next/server';
import { getClientIp, checkRateLimit } from '@/lib/rateLimit';
import { requireWidgetMember, widgetSnapshot } from '@/lib/widget';

export const dynamic = 'force-dynamic';

export async function GET(req: NextRequest) {
  const ip = getClientIp(req);
  if (!checkRateLimit(`widget:${ip}`, 60, 60 * 1000)) {
    return NextResponse.json({ error: 'rate_limited' }, { status: 429 });
  }

  const member = await requireWidgetMember(req);
  if (!member) return NextResponse.json({ error: 'widget_signed_out' }, { status: 401 });

  try {
    const snapshot = await widgetSnapshot(member);
    return NextResponse.json(snapshot, { headers: { 'Cache-Control': 'no-store' } });
  } catch (error) {
    console.error('GET widget error:', error);
    return NextResponse.json({ error: 'read_failed' }, { status: 503 });
  }
}
