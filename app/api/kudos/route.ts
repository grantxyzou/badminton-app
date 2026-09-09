import { NextRequest, NextResponse } from 'next/server';
import { randomBytes } from 'crypto';
import { getContainer, ensureContainer, getActiveSessionId } from '@/lib/cosmos';
import { groupScope } from '@/lib/groupScope';
import { resolveGroupId, noActiveSession } from '@/lib/groupContext';
import { isAdminAuthed, verifyMemberAuth } from '@/lib/auth';
import { isFlagOn } from '@/lib/flags';
import { getClientIp, checkRateLimit } from '@/lib/rateLimit';
import { aggregateKudos, isKudosTag, normalizeNote, isoWeekKey, visibleNotes, type KudosDoc } from '@/lib/kudos';
import { SKILLS } from '@/lib/assessment';
import { resolveActiveSubject } from '@/lib/memberResolve';
import { playedTogetherIn, playedTogetherRecently } from '@/lib/kudosEligibility';

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

/** A skill key must name a real assessment skill. Anything else is dropped
 *  rather than stored, so a structured field never holds free text. */
const SKILL_KEYS = new Set(SKILLS.map((sk) => sk.key));
function isSkillKey(x: unknown): x is string {
  return typeof x === 'string' && SKILL_KEYS.has(x);
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
    const scope = groupScope(resolveGroupId(req));
    const sessionId = typeof body.sessionId === 'string' && body.sessionId && isAdminAuthed(req)
      ? body.sessionId
      : await getActiveSessionId(scope.groupId);
    if (!sessionId) return noActiveSession();

    /* Co-play proof: you can only kudos someone you actually played with —
       now across the recent sessions rather than only the active one. An admin
       may still pin a specific session (rule 7), in which case that one is
       checked on its own. */
    const eligible = typeof body.sessionId === 'string' && body.sessionId && isAdminAuthed(req)
      ? await playedTogetherIn(scope.groupId, rater.name, recipientName, sessionId)
      : await playedTogetherRecently(scope.groupId, rater.name, recipientName, sessionId);
    if (!eligible) {
      return NextResponse.json({ error: 'not_co_player' }, { status: 403 });
    }

    const recipient = await resolveActiveSubject(recipientName);
    const container = getContainer('kudos');
    const createdAt = new Date().toISOString();

    /* ONE OF EACH TAG PER (rater, recipient, ISO WEEK).
       It used to be per SESSION, which stopped being a limit at all once
       eligibility left the session behind: "per session" then meant "per
       whichever session happens to be active", so advancing reset it. A week
       is the club's natural cadence and cannot be reset by an admin action.

       The mock store ignores the WHERE (it filters by PARAMETER NAME, not
       SQL), so the keys are JS-filtered for mock/real parity. */
    const week = isoWeekKey(createdAt);
    const { resources: existing } = await container.items
      .query({
        query: 'SELECT c.recipientMemberId, c.raterMemberId, c.tag, c.createdAt FROM c WHERE c.recipientMemberId = @rid AND c.raterMemberId = @raterId AND c.tag = @tag',
        parameters: [
          { name: '@rid', value: recipient.memberId },
          { name: '@raterId', value: rater.memberId },
          { name: '@tag', value: body.tag },
        ],
      })
      .fetchAll();
    const dupe = (existing as { recipientMemberId?: string; raterMemberId?: string; tag?: string; createdAt?: string }[])
      .some((d) => d.recipientMemberId === recipient.memberId && d.raterMemberId === rater.memberId
        && d.tag === body.tag && typeof d.createdAt === 'string' && isoWeekKey(d.createdAt) === week);
    if (dupe) return NextResponse.json({ error: 'already_sent' }, { status: 409 });

    /* The note is OPTIONAL and, when present, SIGNED — see the exception
       documented on KudosDoc. `normalizeNote` returns undefined for blank, so
       an empty box never becomes a signed empty line. The skill is only kept
       when it names a real assessment skill; anything else is dropped rather
       than stored as free text under a structured field. */
    const note = normalizeNote(body.note);
    const skillKey = note && isSkillKey(body.skillKey) ? body.skillKey : undefined;

    const doc: KudosDoc = {
      id: randomBytes(16).toString('hex'),
      recipientMemberId: recipient.memberId,
      recipientName: recipient.name,
      raterMemberId: rater.memberId,
      raterName: rater.name,
      sessionId,
      tag: body.tag,
      ...(note ? { note } : {}),
      ...(skillKey ? { skillKey } : {}),
      createdAt,
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
    const subject = await resolveActiveSubject(name);
    /* `raterName` is selected here, which is a DELIBERATE change and the only
       place it is read back. `visibleNotes` is what makes it safe: it drops
       every kudos without a note, so a bare tag can never become attributable
       — see the exception documented on KudosDoc. `raterMemberId` is still
       never selected at all. */
    const { resources } = await getContainer('kudos').items
      .query({
        query: 'SELECT c.tag, c.recipientMemberId, c.note, c.skillKey, c.raterName, c.createdAt FROM c WHERE c.recipientMemberId = @rid',
        parameters: [{ name: '@rid', value: subject.memberId }],
      })
      .fetchAll();
    // Mock store ignores the WHERE → JS-filter by recipient.
    const mine = (resources as KudosDoc[]).filter((d) => d.recipientMemberId === subject.memberId);
    return NextResponse.json({ kudos: aggregateKudos(mine), notes: visibleNotes(mine) });
  } catch (error) {
    console.error('GET kudos error:', error);
    return NextResponse.json({ error: 'load_failed' }, { status: 500 });
  }
}
