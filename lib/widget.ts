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
import type { Player, Session } from './types';

/**
 * What the home-screen widget shows (docs/plans/native-widgets.md): this
 * week's session and your place in it, your balance, and your level.
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

export interface WidgetSnapshot {
  v: 1;
  name: string;
  generatedAt: string;
  session: WidgetSession | null;
  owed: { total: number; lines: number; since: string | null };
  level: WidgetLevel | null;
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

/** The bearer pass, then the same membership re-read the cookie routes make. */
export async function requireWidgetMember(
  req: NextRequest,
): Promise<(MemberSession & { role: MembershipRole }) | null> {
  const session = verifyWidgetToken(req);
  if (!session) return null;
  return activeMemberFor(session);
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

  const [[session, rows], owed, level] = await Promise.all([sessionRead, owedRead, levelPart(member.memberId)]);

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
  };
}
