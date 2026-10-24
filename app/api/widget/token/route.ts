/**
 * POST /api/widget/token — the app, signed in, mints the pass the home-screen
 * widget uses (docs/plans/native-widgets.md).
 *
 * The widget cannot read the WebView's cookies, so the app asks for this pass
 * and hands it to the widget's own storage. It is a `'widget'`-audience token:
 * refused as either session cookie, read only by the `/api/widget` routes. The
 * app re-mints it on every open, so it lapses only on a phone whose app has
 * not been opened for the pass's sixty days.
 *
 * `DELETE` is the sign-out half (security review, 2026-10-24): the pass is
 * stateless, so clearing the device copy could not stop one already copied
 * off it. The membership (the Member doc with groups off) is stamped with the
 * instant, and `requireWidgetMember` refuses any pass minted earlier. The next
 * sign-in mints a pass dated after it. Another phone of the same person is
 * caught too, until its app re-mints — which a tap on its widget forces.
 */
import { NextRequest, NextResponse } from 'next/server';
import { getClientIp, checkRateLimit } from '@/lib/rateLimit';
import { mintWidgetToken, requireMember } from '@/lib/auth';
import { getContainer } from '@/lib/cosmos';
import { revokeWidgetPasses } from '@/lib/groups';
import { groupsOn } from '@/lib/groupRoutes';
import type { Member } from '@/lib/types';

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

export async function DELETE(req: NextRequest) {
  const ip = getClientIp(req);
  if (!checkRateLimit(`widget-token:${ip}`, 20, 60 * 1000)) {
    return NextResponse.json({ error: 'rate_limited' }, { status: 429 });
  }

  const gate = await requireMember(req);
  if (!gate.ok) return gate.response;

  const at = new Date().toISOString();
  try {
    if (groupsOn()) {
      await revokeWidgetPasses(gate.member.groupId, gate.member.memberId, at);
    } else {
      const item = getContainer('members').item(gate.member.memberId, gate.member.memberId);
      const { resource } = await item.read<Member>();
      if (resource) await item.replace({ ...resource, widgetPassNotBefore: at });
    }
    return NextResponse.json({ ok: true, revokedAt: at }, { headers: { 'Cache-Control': 'no-store' } });
  } catch (error) {
    console.error('DELETE widget/token error:', error);
    return NextResponse.json({ error: 'revoke_failed' }, { status: 503 });
  }
}
