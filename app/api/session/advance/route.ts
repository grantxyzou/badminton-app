import { NextRequest, NextResponse } from 'next/server';
import { getActiveSessionId, setActiveSessionId, sessionIdFromDate } from '@/lib/cosmos';
import { groupScope } from '@/lib/groupScope';
import { resolveGroupId } from '@/lib/groupContext';
import { isAdminAuthedWithMember, unauthorized } from '@/lib/auth';
import { toValidIso } from '@/app/api/session/route';
import { resolveBirdUsages } from '@/lib/birdWrite';
import { costSplit } from '@/lib/sessionCost';
import { detectSettingsDrift, deadlineOffsetHours } from '@/lib/anomalies';
import type { BirdUsage, Player, Session } from '@/lib/types';

export const dynamic = 'force-dynamic';

/**
 * Calculate hours before session start that signup was opened.
 * If no signupOpen marker exists, defaults to 0 (opened at session start).
 * This is a placeholder — the actual implementation would need timestamps
 * from when signup was toggled on, which aren't currently tracked.
 */
function calculateSignupOpensOffset(_session: unknown): number {
  // TODO: implement signup-open timestamp tracking if needed for audits
  // For now, default to 0 (signup opened immediately at session start)
  return 0;
}

/** Frozen snapshot of the outgoing session's settings, stored on advance. */
type PrevSnapshot = {
  courtCount: number;
  costPerCourt: number;
  maxPlayers: number;
  /** `null` = recorded as having no deadline. Before 2026-10-21 this wrote
   *  `0` for none, which `detectSettingsDrift` still reads as none. */
  deadlineOffsetHours: number | null;
  signupOpensOffsetHours: number;
};

export async function POST(req: NextRequest) {
  if (!(await isAdminAuthedWithMember(req)).authed) return unauthorized();

  try {
    const body = await req.json();
    const datetime = toValidIso(body.datetime);
    if (!datetime) {
      return NextResponse.json({ error: 'datetime required' }, { status: 400 });
    }

    const groupId = resolveGroupId(req);
    const newId = sessionIdFromDate(datetime, groupId);
    // `null` is legitimate here and only here: a NEW group's first-ever
    // advance has no current session, so there is nothing to snapshot.
    const currentId = await getActiveSessionId(groupId);

    if (newId === currentId) {
      return NextResponse.json({ error: 'Session already active for this date' }, { status: 409 });
    }

    const scope = groupScope(groupId);

    // A date whose session already EXISTS is refused, not overwritten. The
    // write below is an upsert of a fresh doc, so re-advancing to an archived
    // date (a typo, or "go back a week") used to replace that doc wholesale:
    // its `settled` snapshot vanished while its player rows kept their frozen
    // amounts, and the balance card re-read those rows as an unsettled live
    // share. Same-date is already caught above; this catches every other.
    const clash = await scope.read<Session>('sessions', newId, newId);
    if (clash) {
      return NextResponse.json({ error: 'session_exists', sessionId: newId }, { status: 409 });
    }

    const currentSession = currentId ? await scope.read<Session>('sessions', currentId, currentId) : undefined;

    // Snapshot previous session's cost-per-person for the payment reminder
    let prevSessionDate: string | undefined;
    let prevCostPerPerson: number | undefined;
    let prevSnapshot: PrevSnapshot | undefined = undefined;
    const anomaliesAtAdvance: import('@/lib/anomalies').AnomalyCode[] = [];

    if (currentSession) {
      // Build the frozen snapshot of current session's settings
      prevSnapshot = {
        courtCount: currentSession.courts ?? 0,
        costPerCourt: currentSession.costPerCourt ?? 0,
        maxPlayers: currentSession.maxPlayers ?? 0,
        // The same function the drift check reads the NEW session with, so
        // the two sides of that comparison cannot be computed two ways.
        deadlineOffsetHours: deadlineOffsetHours(currentSession),
        signupOpensOffsetHours: calculateSignupOpensOffset(currentSession),
      };

      // Prefer the frozen settle snapshot when present — it's the canonical
      // cost-per-person at the moment the admin closed the books, immune to
      // any retro edits to courts/birds since. Falls back to the live
      // `costSplit` for a session that was never settled — EVERY row of it,
      // because the split drops the removed and waitlisted itself and must
      // see a `resplit` cover; dividing by the active count here was a
      // denominator the receipt did not share (2026-10-21).
      if (currentSession.settled) {
        prevCostPerPerson = currentSession.settled.costPerPerson;
        prevSessionDate = currentSession.datetime;
      } else {
        const prevPlayers = await scope.query<Player>('players', {
          where: 'c.sessionId = @sessionId',
          params: [{ name: '@sessionId', value: currentSession.id }],
        });
        const { costPerPerson } = costSplit(currentSession, prevPlayers.filter((p) => p.sessionId === currentSession.id));
        if (costPerPerson > 0) {
          prevCostPerPerson = costPerPerson;
          prevSessionDate = currentSession.datetime;
        }
      }

      // Detect anomalies: settings drift between advances
      const newCostPerCourt = typeof body.costPerCourt === 'number' ? Math.max(0, Math.min(500, body.costPerCourt)) : (currentSession.costPerCourt ?? 0);
      const newCourts = Math.max(1, Math.min(20, parseInt(body.courts, 10) || 2));
      const newMaxPlayers = Math.max(1, Math.min(100, parseInt(body.maxPlayers, 10) || 12));

      /* ONE IMPLEMENTATION OF DRIFT, NOT TWO.
         These three comparisons used to be written out here, duplicating
         `detectSettingsDrift` — and the copies drifted apart exactly as you
         would expect. When the deadline check was added to the shared
         function, THIS path would still have missed it, which is the path that
         actually stamps `anomaliesAtAdvance` on the new session. That is how
         the 2026-09-03 session came to close sign-ups a day early with only
         `max_players_changed` recorded against it. Same family as the ten
         copy-pasted member resolvers that `lib/memberResolve.ts` exists to
         prevent. */
      anomaliesAtAdvance.push(
        ...detectSettingsDrift(
          {
            costPerCourt: newCostPerCourt,
            courts: newCourts,
            maxPlayers: newMaxPlayers,
            datetime,
            deadline: toValidIso(body.deadline),
          } as Session,
          prevSnapshot,
        ),
      );

      // long_break: gap between previous session start and new session start > 21 days
      if (currentSession.datetime) {
        const prevStartMs = new Date(currentSession.datetime).getTime();
        const newStartMs = new Date(datetime).getTime();
        if (Number.isFinite(prevStartMs) && Number.isFinite(newStartMs)
            && (newStartMs - prevStartMs) > 21 * 86_400_000) {
          anomaliesAtAdvance.push('long_break');
        }
      }
    }

    // Resolve any bird tubes the admin chose to load into the new session,
    // through the SAME shared contract PUT /api/session uses (validate → dedup
    // → drop tubes:0 → batch-read → snapshot). Previously this silently dropped
    // invalid/unknown entries where PUT 400s — now both reject identically, so
    // a carried-forward typo surfaces instead of quietly losing tubes.
    const resolvedBirds = await resolveBirdUsages(body.birdUsages, scope);
    if (!resolvedBirds.ok) {
      return NextResponse.json({ error: resolvedBirds.error }, { status: resolvedBirds.status });
    }
    const birdUsages: BirdUsage[] = resolvedBirds.usages;

    const newSession = {
      id: newId,
      sessionId: newId,
      title: String(body.title ?? '').trim().slice(0, 100) || 'Weekly Badminton Session',
      locationName: String(body.locationName ?? '').trim().slice(0, 200),
      locationAddress: String(body.locationAddress ?? '').trim().slice(0, 300),
      datetime,
      endDatetime: toValidIso(body.endDatetime),
      deadline: toValidIso(body.deadline),
      courts: Math.max(1, Math.min(20, parseInt(body.courts, 10) || 2)),
      maxPlayers: Math.max(1, Math.min(100, parseInt(body.maxPlayers, 10) || 12)),
      signupOpen: false,
      ...(typeof body.costPerCourt === 'number' ? { costPerCourt: Math.max(0, Math.min(500, body.costPerCourt)) } : {}),
      ...(birdUsages.length > 0 ? { birdUsages } : {}),
      ...(prevSessionDate ? { prevSessionDate } : {}),
      ...(prevCostPerPerson ? { prevCostPerPerson } : {}),
      ...(prevSnapshot ? { prevSnapshot, anomaliesAtAdvance } : {}),
    };

    await scope.upsert('sessions', newSession);
    await setActiveSessionId(groupId, newId);

    return NextResponse.json(newSession, { status: 201 });
  } catch (error) {
    console.error('POST advance error:', error);
    return NextResponse.json({ error: 'Failed to advance session' }, { status: 500 });
  }
}
