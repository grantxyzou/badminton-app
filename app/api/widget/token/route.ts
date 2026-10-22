/**
 * POST /api/widget/token — the app, signed in, mints the pass the home-screen
 * widget uses (docs/plans/native-widgets.md).
 *
 * The widget cannot read the WebView's cookies, so the app asks for this pass
 * and hands it to the widget's own storage. It is a `'widget'`-audience token:
 * refused as either session cookie, read only by the `/api/widget` routes. The
 * app re-mints it on every open, so it lapses only on a phone whose app has
 * not been opened for the pass's sixty days.
 */
import { NextRequest, NextResponse } from 'next/server';
import { getClientIp, checkRateLimit } from '@/lib/rateLimit';
import { mintWidgetToken, requireMember } from '@/lib/auth';

export const dynamic = 'force-dynamic';

export async function POST(req: NextRequest) {
  const ip = getClientIp(req);
  if (!checkRateLimit(`widget-token:${ip}`, 20, 60 * 1000)) {
    return NextResponse.json({ error: 'rate_limited' }, { status: 429 });
  }

  const gate = await requireMember(req);
  if (!gate.ok) return gate.response;

  const { token, expiresAt } = mintWidgetToken(gate.member);
  return NextResponse.json({ token, expiresAt }, { headers: { 'Cache-Control': 'no-store' } });
}
