import { NextRequest, NextResponse } from 'next/server';
import { randomBytes } from 'crypto';
import { getContainer, ensureContainer, getActiveSessionId } from '@/lib/cosmos';
import { isAdminAuthed, verifyMemberAuth } from '@/lib/auth';
import { isFlagOn } from '@/lib/flags';
import { getClientIp, checkRateLimit } from '@/lib/rateLimit';
import { aggregateKudos, isKudosTag, type KudosDoc } from '@/lib/kudos';

export const dynamic = 'force-dynamic';

let ready: Promise<void> | null = null;
function ensureKudos(): Promise<void> {
  if (!ready) {
    ready = ensureContainer('kudos', '/recipientMemberId').catch((err) => {
      ready = null;
      throw err;
    });
  }
  return ready;
}

interface SubjectRef {
  memberId: string;
  name: string;
}

/** Name → subject id (members directory canonical, name-fallback otherwise). */
async function resolveSubject(name: string): Promise<SubjectRef> {
  const trimmed = name.trim();
  try {
    const { resources } = await getContainer('members')
      .items.query({
        query: 'SELECT * FROM c WHERE LOWER(c.name) = @name',
        parameters: [{ name: '@name', value: trimmed.toLowerCase() }],
      })
      .fetchAll();
    const member = resources[0] as { id?: string } | undefined;
    if (member?.id) return { memberId: member.id, name: trimmed };
  } catch {
    /* fall through */
  }
  return { memberId: `name:${trimmed.toLowerCase()}`, name: trimmed };
}

/**
 * Did `a` and `b` (case-insensitive names) play the same session? True if both
 * are non-removed in the session's roster, OR they appear together in any game.
 * Reuses existing co-attendance data — no new tracking.
 */
async function playedTogether(aName: string, bName: string, sessionId: string): Promise<boolean> {
  const a = aName.trim().toLowerCase();
  const b = bName.trim().toLowerCase();
  // NOTE: the mock store ignores @sid in the WHERE, so we JS-filter by sessionId
  // (same convention as the rest of the codebase — keeps mock/real parity).
  try {
    const { resources: roster } = await getContainer('players').items
      .query({
        query: 'SELECT c.name, c.removed, c.sessionId FROM c WHERE c.sessionId = @sid',
        parameters: [{ name: '@sid', value: sessionId }],
      })
      .fetchAll();
    const present = new Set(
      (roster as { name?: string; removed?: boolean; sessionId?: string }[])
        .filter((p) => p && p.sessionId === sessionId && p.removed !== true && typeof p.name === 'string')
        .map((p) => (p.name as string).trim().toLowerCase()),
    );
    if (present.has(a) && present.has(b)) return true;
  } catch {
    /* fall through to games check */
  }
  try {
    await ensureContainer('gameResults', '/sessionId');
    const { resources: games } = await getContainer('gameResults').items
      .query({
        query: 'SELECT c.teamA, c.teamB, c.sessionId FROM c WHERE c.sessionId = @sid',
        parameters: [{ name: '@sid', value: sessionId }],
      })
      .fetchAll();
    for (const g of games as { teamA?: string[]; teamB?: string[]; sessionId?: string }[]) {
      if (g.sessionId !== sessionId) continue;
      const all = new Set([...(g.teamA ?? []), ...(g.teamB ?? [])].map((n) => String(n).trim().toLowerCase()));
      if (all.has(a) && all.has(b)) return true;
    }
  } catch {
    /* fall through */
  }
  return false;
}

export async function POST(req: NextRequest) {
  const ip = getClientIp(req);
  if (!checkRateLimit(`kudos:${ip}`, 20, 60 * 1000)) {
    return NextResponse.json({ error: 'rate_limited' }, { status: 429 });
  }
  if (!isFlagOn('NEXT_PUBLIC_FLAG_KUDOS')) {
    return NextResponse.json({ error: 'not_found' }, { status: 404 });
  }

  // Identity-bound (rule 12): the rater is the cookie holder, never the body.
  // No admin-on-behalf — kudos is inherently first-person.
  const rater = verifyMemberAuth(req);
  if (!rater) return NextResponse.json({ error: 'unauthorized' }, { status: 401 });

  try {
    await ensureKudos();
    const body = await req.json();
    const recipientName = typeof body.recipientName === 'string' ? body.recipientName.trim().slice(0, 50) : '';
    if (!recipientName) return NextResponse.json({ error: 'recipient_required' }, { status: 400 });
    if (!isKudosTag(body.tag)) return NextResponse.json({ error: 'invalid_tag' }, { status: 400 });

    // No self-kudos.
    if (recipientName.toLowerCase() === rater.name.trim().toLowerCase()) {
      return NextResponse.json({ error: 'no_self_kudos' }, { status: 403 });
    }

    // sessionId override is admin-only (rule 7); otherwise the active session.
    const sessionId = typeof body.sessionId === 'string' && body.sessionId && isAdminAuthed(req)
      ? body.sessionId
      : await getActiveSessionId();

    // Co-play proof: you can only kudos someone you actually played with.
    if (!(await playedTogether(rater.name, recipientName, sessionId))) {
      return NextResponse.json({ error: 'not_co_player' }, { status: 403 });
    }

    const recipient = await resolveSubject(recipientName);
    const container = getContainer('kudos');

    // One of each tag per (rater, recipient, session). The mock store ignores
    // the WHERE, so JS-filter the four keys (mock/real parity).
    const { resources: existing } = await container.items
      .query({
        query: 'SELECT c.recipientMemberId, c.raterMemberId, c.sessionId, c.tag FROM c WHERE c.recipientMemberId = @rid AND c.raterMemberId = @raterId AND c.sessionId = @sid AND c.tag = @tag',
        parameters: [
          { name: '@rid', value: recipient.memberId },
          { name: '@raterId', value: rater.memberId },
          { name: '@sid', value: sessionId },
          { name: '@tag', value: body.tag },
        ],
      })
      .fetchAll();
    const dupe = (existing as { recipientMemberId?: string; raterMemberId?: string; sessionId?: string; tag?: string }[])
      .some((d) => d.recipientMemberId === recipient.memberId && d.raterMemberId === rater.memberId
        && d.sessionId === sessionId && d.tag === body.tag);
    if (dupe) return NextResponse.json({ error: 'already_sent' }, { status: 409 });

    const doc: KudosDoc = {
      id: randomBytes(16).toString('hex'),
      recipientMemberId: recipient.memberId,
      recipientName: recipient.name,
      raterMemberId: rater.memberId,
      raterName: rater.name,
      sessionId,
      tag: body.tag,
      createdAt: new Date().toISOString(),
    };
    await container.items.create(doc);
    // Echo back only non-sensitive fields (never the rater identity).
    return NextResponse.json({ ok: true, tag: doc.tag, recipientName: doc.recipientName }, { status: 201 });
  } catch (error) {
    console.error('POST kudos error:', error);
    return NextResponse.json({ error: 'save_failed' }, { status: 500 });
  }
}

export async function GET(req: NextRequest) {
  const ip = getClientIp(req);
  if (!checkRateLimit(`kudos-get:${ip}`, 60, 60 * 1000)) {
    return NextResponse.json({ error: 'rate_limited' }, { status: 429 });
  }
  if (!isFlagOn('NEXT_PUBLIC_FLAG_KUDOS')) {
    return NextResponse.json({ error: 'not_found' }, { status: 404 });
  }

  const name = new URL(req.url).searchParams.get('name')?.trim().slice(0, 50) ?? '';
  if (!name) return NextResponse.json({ error: 'name_required' }, { status: 400 });

  // Private: own this name (member cookie) or admin. Same posture as /level.
  const member = verifyMemberAuth(req);
  const ownsName = member?.name?.trim().toLowerCase() === name.toLowerCase();
  if (!ownsName && !isAdminAuthed(req)) {
    return NextResponse.json({ error: 'forbidden' }, { status: 403 });
  }

  try {
    await ensureKudos();
    const subject = await resolveSubject(name);
    const { resources } = await getContainer('kudos').items
      .query({
        query: 'SELECT c.tag, c.recipientMemberId FROM c WHERE c.recipientMemberId = @rid',
        parameters: [{ name: '@rid', value: subject.memberId }],
      })
      .fetchAll();
    // Mock store ignores the WHERE → JS-filter by recipient. Counts only —
    // rater identities never leave the server.
    const mine = (resources as { tag: string; recipientMemberId?: string }[])
      .filter((d) => d.recipientMemberId === subject.memberId);
    return NextResponse.json({ kudos: aggregateKudos(mine) });
  } catch (error) {
    console.error('GET kudos error:', error);
    return NextResponse.json({ error: 'load_failed' }, { status: 500 });
  }
}
