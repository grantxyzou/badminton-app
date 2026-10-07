import { getContainer, ensureContainer } from './cosmos';
import { groupScope } from './groupScope';
import { rosterMembers } from './roster';
import { USAGE_KINDS } from './events';
import { computeClubMetrics, type ClubMetrics, type MetricsPlayer, type MetricsSession } from './metricsMath';

/**
 * The ONE place club metrics are read (docs/plans/usage-metrics.md). The admin
 * Metrics route and the key-protected weekly report both call `clubMetrics`,
 * so the page and the report cannot disagree — the lesson `buildReceiptInput`
 * exists for.
 *
 * Throws on a failed read; callers answer 503 `read_failed`. A metric that
 * reads as zero because Cosmos was down is the lying empty state, and this is
 * the screen an admin makes decisions from.
 */

/** How far back the history reads go: a year of sessions and a month on top for the cohorts' first months. */
const HISTORY_DAYS = 400;
const DAY = 86_400_000;

export const SESSIONS_SHOWN = [8, 12, 26] as const;
export type SessionsShown = (typeof SESSIONS_SHOWN)[number];

export function parseSessionsShown(raw: string | null): SessionsShown {
  const n = Number(raw);
  return (SESSIONS_SHOWN as readonly number[]).includes(n) ? (n as SessionsShown) : 8;
}

export async function clubMetrics(groupId: string, sessionsShown: SessionsShown, now = new Date()): Promise<ClubMetrics> {
  const scope = groupScope(groupId);
  const sinceMs = now.getTime() - HISTORY_DAYS * DAY;
  const since28 = new Date(now.getTime() - 28 * DAY).toISOString();

  await Promise.all([
    ensureContainer('kudos', '/recipientMemberId'),
    ensureContainer('stringingJobs', '/memberId'),
    ensureContainer('pushSubscriptions', '/memberId'),
  ]);

  // Sessions are one doc a week, so the group's whole list is small. The
  // legacy `'current-session'` doc is a real past session for BPM.
  const sessionRows = await scope.query<{
    id?: unknown; datetime?: unknown; maxPlayers?: unknown; signupOpenedAt?: unknown; settled?: { at?: unknown } | null;
  }>('sessions', {
    select: 'c.id, c.datetime, c.maxPlayers, c.signupOpenedAt, c.settled',
    includeLegacy: true,
  });
  const sessions: MetricsSession[] = [];
  for (const s of sessionRows) {
    if (typeof s.id !== 'string' || typeof s.datetime !== 'string') continue;
    const t = Date.parse(s.datetime);
    if (!Number.isFinite(t) || t < sinceMs) continue;
    sessions.push({
      id: s.id,
      datetime: s.datetime,
      maxPlayers: typeof s.maxPlayers === 'number' ? s.maxPlayers : 0,
      signupOpenedAt: typeof s.signupOpenedAt === 'string' ? s.signupOpenedAt : undefined,
      settledAt: typeof s.settled?.at === 'string' ? s.settled.at : undefined,
    });
  }
  const sessionIds = new Set(sessions.map((s) => s.id));

  const playerRows = sessionIds.size === 0 ? [] : await scope.query<Record<string, unknown>>('players', {
    select:
      'c.sessionId, c.name, c.memberId, c.timestamp, c.waitlisted, c.removed, c.cancelledBySelf, c.paid, c.paidAt, c.writtenOff',
    where: 'ARRAY_CONTAINS(@sessionIds, c.sessionId)',
    params: [{ name: '@sessionIds', value: [...sessionIds] }],
  });
  const str = (v: unknown) => (typeof v === 'string' ? v : undefined);
  const players: MetricsPlayer[] = [];
  for (const p of playerRows) {
    // Re-checked: the mock store does not apply the ARRAY_CONTAINS.
    if (typeof p.sessionId !== 'string' || !sessionIds.has(p.sessionId) || typeof p.name !== 'string') continue;
    players.push({
      sessionId: p.sessionId,
      name: p.name,
      memberId: str(p.memberId),
      timestamp: str(p.timestamp),
      waitlisted: p.waitlisted === true,
      removed: p.removed === true,
      cancelledBySelf: p.cancelledBySelf === true,
      paid: p.paid === true,
      paidAt: str(p.paidAt),
      writtenOff: p.writtenOff === true,
    });
  }

  const roster = (await rosterMembers(groupId)).map((e) => ({
    memberId: e.member.id,
    name: e.membership?.name ?? e.member.name,
    // A backfilled membership's date is the day the migration ran, not the
    // day the person joined; their account date is the better answer.
    joinedAt:
      e.membership && e.membership.joinedVia !== 'backfill' ? e.membership.joinedAt : e.member.createdAt,
  }));

  const kudosRows = await scope.query<{ raterMemberId?: unknown; createdAt?: unknown }>('kudos', {
    select: 'c.raterMemberId, c.createdAt',
    where: 'c.createdAt >= @since',
    params: [{ name: '@since', value: since28 }],
  });
  const jobRows = await scope.query<{ memberId?: unknown; createdAt?: unknown }>('stringingJobs', {
    select: 'c.memberId, c.createdAt',
    where: 'c.createdAt >= @since',
    params: [{ name: '@since', value: since28 }],
  });
  // PERSON scoped: one doc per device, keyed by the person. Narrowed to the
  // roster inside the math, because a person can be in two clubs.
  // The usage records (docs/plans/usage-metrics.md). Bounded to 28 days and
  // three kinds; empty until usage tracking is switched on.
  await ensureContainer('events', '/memberId');
  const usageRows = await scope.query<{ memberId?: unknown; kind?: unknown; at?: unknown; tab?: unknown; via?: unknown }>('events', {
    select: 'c.memberId, c.kind, c.at, c.tab, c.via',
    where: 'c.at >= @since AND ARRAY_CONTAINS(@kinds, c.kind)',
    params: [
      { name: '@since', value: since28 },
      { name: '@kinds', value: [...USAGE_KINDS] },
    ],
  });
  const { resources: pushRows } = await getContainer('pushSubscriptions')
    .items.query<{ memberId?: unknown }>({ query: 'SELECT c.memberId FROM c' })
    .fetchAll();

  return computeClubMetrics({
    now,
    sessionsShown,
    sessions,
    players,
    roster,
    kudos: kudosRows.flatMap((r) =>
      typeof r.raterMemberId === 'string' && typeof r.createdAt === 'string'
        ? [{ raterMemberId: r.raterMemberId, createdAt: r.createdAt }]
        : [],
    ),
    stringingJobs: jobRows.flatMap((r) =>
      typeof r.memberId === 'string' && typeof r.createdAt === 'string' ? [{ memberId: r.memberId, createdAt: r.createdAt }] : [],
    ),
    pushSubscriptions: pushRows.flatMap((r) => (typeof r.memberId === 'string' ? [{ memberId: r.memberId }] : [])),
    // Re-checked in the math (window, roster); the mock store applies no WHERE.
    usageEvents: usageRows.flatMap((r) =>
      typeof r.memberId === 'string' && typeof r.kind === 'string' && typeof r.at === 'string' &&
      (USAGE_KINDS as readonly string[]).includes(r.kind)
        ? [{
            memberId: r.memberId,
            kind: r.kind,
            at: r.at,
            ...(typeof r.tab === 'string' ? { tab: r.tab } : {}),
            ...(typeof r.via === 'string' ? { via: r.via } : {}),
          }]
        : [],
    ),
  });
}
