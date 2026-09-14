/**
 * GET  /api/admin/access-requests — who is waiting to be let in.
 * POST /api/admin/access-requests — let one request in, or clear a person's.
 *
 * Approval is deliberately BLIND: no device string, no IP, no location. Those
 * would be theatre — Grant has no way to verify any of them, and showing
 * unverifiable detail next to an approve button makes a decision feel checked
 * when it was not. What actually secures this is that he knows his club and the
 * request arrives while the person is usually standing in front of him.
 *
 * The safety net is elsewhere: each request is device-bound by a secret, so
 * approving lets in the device that ASKED and nobody else, and it expires in an
 * hour.
 *
 * TWO REQUESTS FOR ONE PERSON CANNOT BE APPROVED (security finding F2).
 * Blind approval is only safe when there is exactly one thing to approve. If a
 * stranger asked under Lin's name as well, the two rows are indistinguishable —
 * by design, per the paragraph above — so an approve button on either is a coin
 * flip over who gets Lin's account. The list says how many devices asked, and
 * the only action on more than one is to clear them all and have the person ask
 * again. Counted over OPEN requests, approved-but-unclaimed included: a second
 * ask landing in the seconds between Grant's tap and Lin's phone collecting it
 * must not read as a fresh single request.
 */
import { NextRequest, NextResponse } from 'next/server';
import { getContainer } from '@/lib/cosmos';
import { isAdminAuthed, isAdminAuthedWithMember } from '@/lib/auth';
import { getClientIp, checkRateLimit } from '@/lib/rateLimit';
import { openRequests, pendingRequests } from '@/lib/accessRequest';
import { updateAccessRequests } from '@/lib/accessRequestStore';
import type { Member } from '@/lib/types';

export const dynamic = 'force-dynamic';

const HOUR_MS = 60 * 60 * 1000;

export async function GET(req: NextRequest) {
  const ip = getClientIp(req);
  if (!checkRateLimit(`access-list:${ip}`, 120, HOUR_MS)) {
    return NextResponse.json({ error: 'rate_limited' }, { status: 429 });
  }
  // Read-only: the cheap sync check (cookie signature + expiry), per the
  // documented split.
  if (!isAdminAuthed(req)) {
    return NextResponse.json({ error: 'unauthorized' }, { status: 401 });
  }

  try {
    const { resources } = await getContainer('members')
      .items.query<Member>({
        // Both fields: a doc written before one-per-device still carries the
        // single `accessRequest`, and Cosmos would not return it otherwise.
        query: 'SELECT * FROM c WHERE IS_DEFINED(c.accessRequest) OR IS_DEFINED(c.accessRequests)',
        parameters: [],
      })
      .fetchAll();

    /* Re-filtered in JS. The mock store ignores the WHERE clause entirely — it
       matches on parameter NAMES, and this query binds none — so the predicate
       above is production-only and this line is what actually holds under
       test. Expiry has to be evaluated here regardless: it is a timestamp
       comparison, not a field the query can express. */
    const waiting = resources
      .map((m) => ({ m, open: openRequests(m), pending: pendingRequests(m) }))
      .filter(({ pending }) => pending.length > 0)
      .map(({ m, open, pending }) => ({
        memberId: m.id,
        name: m.name,
        at: Math.min(...pending.map((r) => r.expiresAt)),
        count: open.length,
        // Only a lone request is approvable, so only a lone request has an id
        // to approve by.
        requestId: open.length === 1 ? pending[0].id : null,
      }))
      .sort((a, b) => a.at - b.at);

    return NextResponse.json({ requests: waiting });
  } catch (err) {
    console.error('GET /api/admin/access-requests failed:', err);
    return NextResponse.json({ error: 'read_failed' }, { status: 503 });
  }
}

export async function POST(req: NextRequest) {
  const ip = getClientIp(req);
  if (!checkRateLimit(`access-approve:${ip}`, 60, HOUR_MS)) {
    return NextResponse.json({ error: 'rate_limited' }, { status: 429 });
  }
  // Mutating: re-reads the member and re-checks the role, so a demotion takes
  // effect immediately.
  const admin = await isAdminAuthedWithMember(req);
  if (!admin.authed) {
    return NextResponse.json({ error: 'unauthorized' }, { status: 401 });
  }

  const body = await req.json().catch(() => null);
  const memberId = body && typeof body.memberId === 'string' ? body.memberId : '';
  const requestId = body && typeof body.requestId === 'string' ? body.requestId : '';
  const decision = body?.decision;
  if (
    !memberId ||
    (decision !== 'approve' && decision !== 'decline') ||
    (decision === 'approve' && !requestId)
  ) {
    return NextResponse.json({ error: 'invalid_request' }, { status: 400 });
  }

  try {
    let refusal: 'not_found' | 'several_requests' | null = null;

    const result = await updateAccessRequests(memberId, (open) => {
      if (decision === 'decline') {
        // Declining clears every open request for the person. The asking
        // devices then poll into `none` and are told to try again or find
        // Grant in person — there is no "you were refused" state, because
        // there is nothing useful to do with one.
        if (open.length === 0) { refusal = 'not_found'; return null; }
        return [];
      }
      const target = open.find((r) => r.id === requestId && r.approvedAt === undefined);
      if (!target) { refusal = 'not_found'; return null; }
      // Re-checked at write time, not trusted from the list the admin saw: a
      // second ask may have landed since.
      if (open.length > 1) { refusal = 'several_requests'; return null; }
      return [{ ...target, approvedAt: Date.now() }];
    });

    if (refusal === 'several_requests') {
      return NextResponse.json({ error: 'several_requests' }, { status: 409 });
    }
    if (!result) {
      return NextResponse.json({ error: 'not_found' }, { status: 404 });
    }
    return NextResponse.json({ ok: true });
  } catch (err) {
    console.error('POST /api/admin/access-requests failed:', err);
    return NextResponse.json({ error: 'write_failed' }, { status: 503 });
  }
}
