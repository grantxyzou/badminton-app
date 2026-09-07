/**
 * GET  /api/admin/access-requests — who is waiting to be let in.
 * POST /api/admin/access-requests — approve or decline one, by name.
 *
 * Approval is deliberately BLIND: no device string, no IP, no location. Those
 * would be theatre — Grant has no way to verify any of them, and showing
 * unverifiable detail next to an approve button makes a decision feel checked
 * when it was not. What actually secures this is that he knows his club and the
 * request arrives while the person is usually standing in front of him.
 *
 * The safety net is elsewhere: the request is device-bound by a secret, so
 * approving lets in the person who ASKED and nobody else, and it expires in an
 * hour.
 */
import { NextRequest, NextResponse } from 'next/server';
import { getContainer } from '@/lib/cosmos';
import { isAdminAuthed, isAdminAuthedWithMember } from '@/lib/auth';
import { getClientIp, checkRateLimit } from '@/lib/rateLimit';
import { isPending } from '@/lib/accessRequest';
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
        query: 'SELECT * FROM c WHERE IS_DEFINED(c.accessRequest)',
        parameters: [],
      })
      .fetchAll();

    /* Re-filtered in JS. The mock store ignores the WHERE clause entirely — it
       matches on parameter NAMES, and this query binds none — so the predicate
       above is production-only and this line is what actually holds under
       test. Expiry has to be evaluated here regardless: it is a timestamp
       comparison, not a field the query can express. */
    const waiting = resources
      .filter((m) => isPending(m.accessRequest))
      .map((m) => ({ name: m.name, at: m.accessRequest!.expiresAt }))
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
  const name = body && typeof body.name === 'string' ? body.name.trim() : '';
  const decision = body?.decision;
  if (!name || (decision !== 'approve' && decision !== 'decline')) {
    return NextResponse.json({ error: 'invalid_request' }, { status: 400 });
  }

  try {
    const container = getContainer('members');
    const { resources } = await container.items
      .query<Member>({
        query: 'SELECT * FROM c WHERE c.name = @name',
        parameters: [{ name: '@name', value: name }],
      })
      .fetchAll();

    // Re-check in JS: the mock store's `@name` filter is case-insensitive and
    // this is an authorisation decision, so the exact row is worth confirming.
    const member = resources.find((m) => m.name === name && isPending(m.accessRequest));
    if (!member) {
      return NextResponse.json({ error: 'not_found' }, { status: 404 });
    }

    if (decision === 'approve') {
      await container.items.upsert({
        ...member,
        accessRequest: { ...member.accessRequest!, approvedAt: Date.now() },
      });
    } else {
      // Declining removes the request outright. The asking device then polls
      // into `none` and is told to try again or find Grant in person — there
      // is no "you were refused" state, because there is nothing useful to do
      // with one.
      const { accessRequest: _dropped, ...rest } = member;
      await container.items.upsert(rest);
    }

    return NextResponse.json({ ok: true });
  } catch (err) {
    console.error('POST /api/admin/access-requests failed:', err);
    return NextResponse.json({ error: 'write_failed' }, { status: 503 });
  }
}
