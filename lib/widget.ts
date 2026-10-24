import type { NextRequest } from 'next/server';
import { activeMemberFor, verifyWidgetToken, type MemberSession } from './auth';
import type { MembershipRole } from './types';
import { getContainer, ensureContainer, getActiveSessionId } from './cosmos';
import { groupScope } from './groupScope';
import { compareBySignup } from './capacity';
import { defaultMaxPlayers } from './defaults';
import { resolveIdentity } from './playerIdentity';
import { computeOwed } from './owedBalance';
import { stringingTotal } from './stringingBilling';
import { summarizeAssessmentTrend, type Phase, type StoredAssessment } from './assessment';
import { playerStageFor, playerStageIndex, type PlayerStage } from './stringing';
import { lastStrungFromJobs, restringDueWeeks, weeksSince, RESTRING_AFTER_WEEKS } from './restring';
import { isArchived, benchOrder } from './stringingOrder';
import type { Player, Session, StringingJob } from './types';

/**
 * What the home-screen widget shows (docs/plans/native-widgets.md): this
 * week's session and your place in it, your balance, your level, and your
 * racket when the shop has it or has had it.
 *
 * ONE read for the widget, made with the widget's own pass. Every number in it
 * comes from the helper Home already uses for the same number — the owed total
 * from `computeOwed`, the level from `summarizeAssessmentTrend` — so the widget
 * and the app cannot disagree about money or a level.
 */

export interface WidgetSession {
  id: string;
  datetime: string;
  endDatetime: string | null;
  /** Absent `signupOpen` means open (the app-wide rule). */
  signupOpen: boolean;
  deadline: string | null;
  /** Sign-ups are past their deadline. */
  closed: boolean;
  settled: boolean;
  max: number;
  inCount: number;
  waitingCount: number;
  me: 'in' | 'waitlist' | 'out';
  /** 1-based, only while `me` is `'waitlist'`. */
  waitlistPosition: number | null;
}

export interface WidgetLevel {
  overall: number;
  phase: Phase | null;
  phaseLabel: string | null;
  prevOverall: number | null;
  prevAt: string | null;
  delta: number | null;
  /** Oldest first, at most `LEVEL_HISTORY` check-ins. */
  history: number[];
  workOn: string | null;
}

/**
 * The racket on the bench, in the PLAYER's vocabulary — the stage, never the
 * bench status, and no price at all (the widget shows no money for stringing;
 * the balance already carries what is due).
 */
export interface WidgetStringingJob {
  id: string;
  jobNo: string;
  racketLabel: string;
  stringLabel: string;
  tensionMains: number;
  tensionCrosses: number;
  stage: PlayerStage;
  /** Index into `PLAYER_TRACK`: how far along the four-step bar is. */
  stageIndex: number;
  readyBy: string | null;
}

/**
 * The large widget's third section (Grant, 2026-10-23: "a third section about
 * stringing. Active job show progress. When a job is done … show a restring in
 * X weeks? and why?"). By TIME, never by sessions: play outside BPM is
 * invisible to us, so a session count would undercount it.
 */
export interface WidgetStringing {
  /** The racket on the bench — the job Home's card leads with — or null. */
  job: WidgetStringingJob | null;
  /** When the shop last strung for this member (`lib/restring.ts`). */
  lastStrungAt: string | null;
  weeksSince: number | null;
  /** `afterWeeks` or more since, with no racket in: "Consider a restring". */
  due: boolean;
  /** The club's interval, so the widget can draw the bar filling by date. */
  afterWeeks: number;
}

export interface WidgetSnapshot {
  v: 1;
  name: string;
  generatedAt: string;
  session: WidgetSession | null;
  owed: { total: number; lines: number; since: string | null };
  level: WidgetLevel | null;
  /** Null when there is nothing to say: never used the shop and nothing in. */
  stringing: WidgetStringing | null;
}

export const LEVEL_HISTORY = 6;

/** The Stats tab's own words for a phase (messages `stats…phase`). English:
 *  the widget is English-only, like push payloads, for the same reason — there
 *  is no per-member locale to choose from. */
const PHASE_LABEL: Record<Phase, string> = {
  foundation: 'Beginner',
  exploration: 'Improver',
  switch: 'Intermediate',
  commitment: 'Advanced',
  advanced: 'Competitive',
};

/**
 * The bearer pass, then the same membership re-read the cookie routes make —
 * and the sign-out cutoff: a pass minted before the membership's
 * `widgetPassNotBefore` is refused (`DELETE /api/widget/token` stamps it).
 * Compared in whole seconds, the token's own unit, so a pass minted in the
 * same second as a sign-out (sign out, sign straight back in) still works.
 */
export async function requireWidgetMember(
  req: NextRequest,
): Promise<(MemberSession & { role: MembershipRole }) | null> {
  const session = verifyWidgetToken(req);
  if (!session) return null;
  const member = await activeMemberFor(session);
  if (!member) return null;
  if (passRevoked(session.iat, member.widgetPassNotBefore)) return null;
  const { widgetPassNotBefore: _cutoff, ...rest } = member;
  return rest;
}

/** `iat` is seconds; the cutoff an ISO instant. Unparseable cutoff = none. */
export function passRevoked(iatSeconds: number, notBefore: string | undefined): boolean {
  if (!notBefore) return false;
  const cutoffMs = Date.parse(notBefore);
  return Number.isFinite(cutoffMs) && iatSeconds < Math.floor(cutoffMs / 1000);
}

function round2(n: number): number {
  return Math.round(n * 100) / 100;
}

type Row = Pick<Player, 'id' | 'name' | 'timestamp' | 'removed' | 'waitlisted'> & { memberId?: string };

function sessionPart(session: Session, rows: Row[], member: MemberSession, now: number): WidgetSession {
  const live = rows.filter((r) => r.removed !== true);
  const inRows = live.filter((r) => r.waitlisted !== true);
  const waiting = live.filter((r) => r.waitlisted === true).sort(compareBySignup);
  const lower = member.name.trim().toLowerCase();
  // The row's memberId when it carries one; the name only for a legacy row.
  const mine = (r: Row) => (r.memberId ? r.memberId === member.memberId : r.name?.trim().toLowerCase() === lower);
  const meIn = inRows.some(mine);
  const position = waiting.findIndex(mine);
  const deadline = typeof session.deadline === 'string' && session.deadline ? session.deadline : null;
  return {
    id: session.id,
    datetime: session.datetime,
    endDatetime: session.endDatetime ?? null,
    signupOpen: session.signupOpen !== false,
    deadline,
    closed: deadline !== null && now > new Date(deadline).getTime(),
    settled: !!session.settled,
    max: session.maxPlayers ?? defaultMaxPlayers(),
    inCount: inRows.length,
    waitingCount: waiting.length,
    me: meIn ? 'in' : position >= 0 ? 'waitlist' : 'out',
    waitlistPosition: !meIn && position >= 0 ? position + 1 : null,
  };
}

async function levelPart(memberId: string): Promise<WidgetLevel | null> {
  await ensureContainer('assessments', '/memberId');
  const { resources } = await getContainer('assessments')
    .items.query({
      query: 'SELECT c.memberId, c.takenAt, c.ratings, c.overall, c.phase FROM c WHERE c.memberId = @memberId',
      parameters: [{ name: '@memberId', value: memberId }],
    })
    .fetchAll();
  const docs = (resources as (StoredAssessment & { memberId?: string })[])
    .filter((d) => d && d.memberId === memberId && typeof d.takenAt === 'string')
    .sort((a, b) => a.takenAt.localeCompare(b.takenAt));
  const trend = summarizeAssessmentTrend(docs);
  if (!trend || trend.overall === null) return null;
  const rated = docs.filter((d) => typeof d.overall === 'number');
  const prev = rated.length > 1 ? rated[rated.length - 2] : null;
  return {
    overall: round2(trend.overall),
    phase: trend.phase,
    phaseLabel: trend.phase ? PHASE_LABEL[trend.phase] : null,
    prevOverall: trend.prevOverall === null ? null : round2(trend.prevOverall),
    prevAt: prev?.takenAt ?? null,
    delta: trend.delta === null ? null : round2(trend.delta),
    history: rated.slice(-LEVEL_HISTORY).map((d) => round2(d.overall as number)),
    workOn: trend.workOn[0]?.label ?? null,
  };
}

/**
 * One partition (`/memberId`), every job archived included — archiving takes
 * a racket off the bench, it does not un-string it — so the restring clock is
 * the one Home's card keeps (`lastStrungFromJobs`). The lead job is the first
 * live, unfinished one in bench order: the racket the card's strip talks about.
 */
async function stringingPart(scope: ReturnType<typeof groupScope>, memberId: string, now: number): Promise<WidgetStringing | null> {
  const jobs = (
    await scope.query<StringingJob>('stringingJobs', {
      where: 'c.memberId = @memberId',
      params: [{ name: '@memberId', value: memberId }],
      partitionKey: memberId,
    })
  ).filter((j) => j.memberId === memberId);
  const lead = jobs
    .filter((j) => !isArchived(j) && j.status !== 'picked_up')
    .sort(benchOrder)[0];
  const lastStrungAt = lastStrungFromJobs(jobs);
  if (!lead && lastStrungAt === null) return null;
  const at = new Date(now);
  return {
    job: lead
      ? {
          id: lead.id,
          jobNo: lead.jobNo,
          racketLabel: lead.racketLabel,
          stringLabel: lead.stringLabel,
          tensionMains: lead.tensionMains,
          tensionCrosses: lead.tensionCrosses,
          stage: playerStageFor(lead.status),
          stageIndex: playerStageIndex(lead.status),
          readyBy: lead.readyBy ?? null,
        }
      : null,
    lastStrungAt,
    weeksSince: lastStrungAt === null ? null : weeksSince(lastStrungAt, at),
    // A racket on the bench is already the answer, as on Home's card.
    due: !lead && restringDueWeeks(lastStrungAt, at) !== null,
    afterWeeks: RESTRING_AFTER_WEEKS,
  };
}

/**
 * Everything the widget draws. Throws when a read fails: the route answers
 * 503 and the widget keeps what it last showed, with its "Updated" time —
 * never a confident zero (the lying-empty-state rule).
 */
export async function widgetSnapshot(member: MemberSession, now: number = Date.now()): Promise<WidgetSnapshot> {
  const scope = groupScope(member.groupId);
  const sessionId = await getActiveSessionId(scope.groupId);

  const sessionRead = sessionId
    ? Promise.all([
        scope.read<Session>('sessions', sessionId, sessionId),
        scope.query<Row>('players', {
          select: 'c.id, c.name, c.memberId, c.timestamp, c.removed, c.waitlisted',
          where: 'c.sessionId = @sessionId',
          params: [{ name: '@sessionId', value: sessionId }],
          partitionKey: sessionId,
        }),
      ])
    : Promise.resolve([undefined, []] as const);

  const owedRead = resolveIdentity({ memberId: member.memberId, name: member.name }, scope.groupId).then((identity) => {
    identity.names.add(member.name.toLowerCase());
    return computeOwed(scope, identity);
  });

  const [[session, rows], owed, level, stringing] = await Promise.all([
    sessionRead,
    owedRead,
    levelPart(member.memberId),
    stringingPart(scope, member.memberId, now),
  ]);

  const sessionsOwed = owed.sessions.reduce((sum, s) => sum + s.owedAmount, 0);
  const oldest = owed.sessions.length > 0 ? owed.sessions[owed.sessions.length - 1].date : null;

  return {
    v: 1,
    name: member.name,
    generatedAt: new Date(now).toISOString(),
    session: session && typeof session.datetime === 'string' ? sessionPart(session, rows as Row[], member, now) : null,
    owed: {
      total: round2(sessionsOwed + stringingTotal(owed.stringing)),
      lines: owed.sessions.length + owed.stringing.length,
      since: oldest,
    },
    level,
    stringing,
  };
}
