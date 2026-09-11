import { NextRequest, NextResponse } from 'next/server';
import { randomBytes } from 'crypto';
import { ensureContainer, getActiveSessionId } from '@/lib/cosmos';
import { groupScope } from '@/lib/groupScope';
import { resolveGroupId, noActiveSession } from '@/lib/groupContext';
import { isAdminAuthed, verifyMemberAuth, ownsNameOrAdmin } from '@/lib/auth';
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

    const recipient = await resolveActiveSubject(resolveGroupId(req), recipientName);
    const createdAt = new Date().toISOString();

    /* ONE OF EACH TAG PER (rater, recipient, ISO WEEK).
       It used to be per SESSION, which stopped being a limit at all once
       eligibility left the session behind: "per session" then meant "per
       whichever session happens to be active", so advancing reset it. A week
       is the club's natural cadence and cannot be reset by an admin action.

       The mock store filters by PARAMETER NAME, not SQL — `@recipientMemberId`
       and `@raterMemberId` are names it knows — and the keys are JS-filtered
       for mock/real parity either way. */
    const week = isoWeekKey(createdAt);
    const existing = await scope.query<{ recipientMemberId?: string; raterMemberId?: string; tag?: string; createdAt?: string }>('kudos', {
      select: 'c.recipientMemberId, c.raterMemberId, c.tag, c.createdAt',
      where: 'c.recipientMemberId = @recipientMemberId AND c.raterMemberId = @raterMemberId AND c.tag = @tag',
      params: [
        { name: '@recipientMemberId', value: recipient.memberId },
        { name: '@raterMemberId', value: rater.memberId },
        { name: '@tag', value: body.tag },
      ],
    });
    const dupe = existing
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
    await scope.create('kudos', doc);
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

  const name = new URL(req.url).searchParams.get('name')?.trim().slice(0, 50) ?? '';
  if (!name) return NextResponse.json({ error: 'name_required' }, { status: 400 });

  // Private: own this name (member cookie) or admin. Same posture as /level.
  // Through the shared helper, not a local copy of it — an inlined gate is
  // invisible to the grep that asks which name-keyed reads are unguarded, and
  // three of these had drifted into three separate spellings of one rule.
  if (!ownsNameOrAdmin(req, name)) {
    return NextResponse.json({ error: 'forbidden' }, { status: 403 });
  }

  try {
    await ensureKudos();
    const subject = await resolveActiveSubject(resolveGroupId(req), name);
    /* `raterName` is selected here, which is a DELIBERATE change and the only
       place it is read back. `visibleNotes` is what makes it safe: it drops
       every kudos without a note, so a bare tag can never become attributable
       — see the exception documented on KudosDoc. `raterMemberId` is still
       never selected at all. */
    const resources = await groupScope(resolveGroupId(req)).query<KudosDoc>('kudos', {
      select: 'c.tag, c.recipientMemberId, c.note, c.skillKey, c.raterName, c.createdAt',
      where: 'c.recipientMemberId = @recipientMemberId',
      params: [{ name: '@recipientMemberId', value: subject.memberId }],
    });
    // JS-filtered by recipient too, for mock/real parity.
    const mine = resources.filter((d) => d.recipientMemberId === subject.memberId);
    return NextResponse.json({ kudos: aggregateKudos(mine), notes: visibleNotes(mine) });
  } catch (error) {
    console.error('GET kudos error:', error);
    return NextResponse.json({ error: 'load_failed' }, { status: 500 });
  }
}
