/**
 * POST /api/widget/join — "Join" on the widget; DELETE — its "Undo"
 * (docs/plans/native-widgets.md).
 *
 * Neither decides anything itself. Each re-enters `POST` / `DELETE
 * /api/players` AS the member the widget pass names, with a five-minute
 * member cookie the server builds and never sends anywhere. So a tap on the
 * widget passes exactly the checks a tap on Home's button does — sign-ups
 * open, the deadline, capacity, the soft hold, the late-cancel fee — and
 * there is one sign-up rule, not two.
 *
 * Both answer with the fresh snapshot on success, so the widget redraws from
 * the server's answer and never from a guess: it shows "You're in" only once
 * the sign-up route has said yes.
 */
import { NextRequest, NextResponse } from 'next/server';
import { getClientIp, checkRateLimit } from '@/lib/rateLimit';
import { memberCookieHeaderFor, type MemberSession } from '@/lib/auth';
import { requireWidgetMember, widgetSnapshot } from '@/lib/widget';
import { POST as signUp, DELETE as cancel } from '@/app/api/players/route';

export const dynamic = 'force-dynamic';

/** The same request, re-addressed to the sign-up route and carrying the member. */
function asMember(req: NextRequest, member: MemberSession, method: 'POST' | 'DELETE', body: unknown): NextRequest {
  const headers = new Headers({ 'content-type': 'application/json', cookie: memberCookieHeaderFor(member) });
  // The per-IP limiters inside the sign-up route key on the caller's address.
  for (const name of ['x-forwarded-for', process.env.TRUSTED_IP_HEADER]) {
    const value = name ? req.headers.get(name) : null;
    if (name && value) headers.set(name, value);
  }
  return new NextRequest(new URL('/bpm/api/players', req.url), { method, headers, body: JSON.stringify(body) });
}

async function relay(res: Response, member: MemberSession): Promise<NextResponse> {
  if (!res.ok) {
    const { error } = (await res.json().catch(() => ({}))) as { error?: string };
    return NextResponse.json({ error: error ?? 'failed' }, { status: res.status });
  }
  try {
    return NextResponse.json({ ok: true, snapshot: await widgetSnapshot(member) }, { headers: { 'Cache-Control': 'no-store' } });
  } catch {
    // The action landed; only the redraw failed. The widget refreshes itself.
    return NextResponse.json({ ok: true, snapshot: null }, { headers: { 'Cache-Control': 'no-store' } });
  }
}

async function gate(req: NextRequest, key: string) {
  const ip = getClientIp(req);
  if (!checkRateLimit(`${key}:${ip}`, 20, 60 * 1000)) {
    return { response: NextResponse.json({ error: 'rate_limited' }, { status: 429 }) };
  }
  const member = await requireWidgetMember(req);
  if (!member) return { response: NextResponse.json({ error: 'widget_signed_out' }, { status: 401 }) };
  return { member };
}

export async function POST(req: NextRequest) {
  const g = await gate(req, 'widget-join');
  if (!g.member) return g.response;
  const body = (await req.json().catch(() => ({}))) as { waitlist?: unknown };
  const res = await signUp(asMember(req, g.member, 'POST', { waitlist: body.waitlist === true }));
  return relay(res, g.member);
}

export async function DELETE(req: NextRequest) {
  const g = await gate(req, 'widget-undo');
  if (!g.member) return g.response;
  // The cancel route finds the row by name and then checks the caller owns it
  // (by memberId), so the verified roster name is all it needs.
  const res = await cancel(asMember(req, g.member, 'DELETE', { name: g.member.name }));
  return relay(res, g.member);
}
