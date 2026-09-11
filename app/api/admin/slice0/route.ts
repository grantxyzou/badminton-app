import { NextRequest, NextResponse } from 'next/server';
import { getContainer, ensureContainer, sessionIdFromDate } from '@/lib/cosmos';
import { groupScope } from '@/lib/groupScope';
import { resolveGroupId } from '@/lib/groupContext';
import { isAdminAuthed, unauthorized } from '@/lib/auth';
import { getClientIp, checkRateLimit } from '@/lib/rateLimit';
import { PICK_KINDS, isCheckInSource } from '@/lib/events';
import { SKILLS } from '@/lib/assessment';
import { rosterMembers } from '@/lib/roster';

export const dynamic = 'force-dynamic';

/** Thresholds straight from docs/plans/value-hub-slice-0.md. */
const REC_THRESHOLD = 0.4;
const GAME_THRESHOLD = 0.3;

/**
 * The date the 4-week kill-criterion clock restarted. See the note on `since`
 * in GET below — this is the default measurement window, and reading the
 * criterion against anything earlier is measuring a surface that wasn't there.
 */
const CLOCK_RESTART = '2026-08-16';

const norm = (s: string) => s.trim().toLowerCase();

/** `session-YYYY-MM-DD` sorts lexically, so a date cutoff is a string compare. */
// Per group: a prefixed group's ids sort BEFORE the bare `session-` prefix, so
// a bare cutoff would exclude every one of that group's sessions.
const sessionCutoff = (sinceDate: string, groupId: string) => sessionIdFromDate(sinceDate, groupId);

/**
 * Value-Hub Slice-0 kill-criterion readout.
 *
 * The criterion is: "after 4 weeks live … if <40% of dogfooders interact with
 * the rec card more than once, AND <30% log a game, the slice is killed."
 * Nothing in the app could answer either half — there is no analytics anywhere
 * in the repo, and the rec card had no interactive affordance at all — so the
 * gate has sat undecidable while blocking Tracks 1–4. This reads both halves
 * off real data and states the verdict rather than leaving it to be eyeballed.
 *
 * Read-only, so the cheap sync `isAdminAuthed` is correct here (CLAUDE.md:
 * mutating routes re-check the role, read-only ones don't pay the Cosmos read).
 */
export async function GET(req: NextRequest) {
  const ip = getClientIp(req);
  if (!checkRateLimit(`slice0:${ip}`, 30, 60 * 60 * 1000)) {
    return NextResponse.json({ error: 'rate_limited' }, { status: 429 });
  }
  if (!isAdminAuthed(req)) return unauthorized();

  // Default cutoff is 2026-08-16, when the 4-week clock RESTARTED — not the
  // v1.7 promotion (2026-06-13) when Slice-0 nominally went live.
  //
  // The Equipment register had been parked under the assessment spine since
  // v1.7, so the rec card rendered on NEITHER deployment for that whole period
  // and the criterion was measuring an invisible surface. Defaulting to the
  // earlier date sweeps ~2 months in which the feature could not be used,
  // which mechanically drags `recRate` toward zero and manufactures a `kill`
  // verdict — retiring work on evidence that was never capable of being
  // positive. A metric with a misleading default is worse than no metric: it
  // is confidently wrong in one predictable direction.
  //
  // `?since=` still accepts any date, so the older window remains queryable as
  // a historical baseline; it just isn't what you get by accident.
  const sinceParam = new URL(req.url).searchParams.get('since')?.slice(0, 10) ?? '';
  const since = /^\d{4}-\d{2}-\d{2}$/.test(sinceParam) ? sinceParam : CLOCK_RESTART;

  try {
    // --- Denominator: who actually turned up. -------------------------------
    // Attendance, not membership: `members.active` is an admin soft-delete flag
    // rather than an activity signal and would overcount badly. Mirrors the
    // filtering in app/api/stats/partners/route.ts — the mock store ignores the
    // SQL predicate, so the cutoff and `removed` filter are re-applied in JS to
    // keep mock and prod identical.
    const scope = groupScope(resolveGroupId(req));
    const cutoff = sessionCutoff(since, scope.groupId);
    const playerRows = await scope.query<{ sessionId?: unknown; name?: unknown; removed?: unknown }>('players', {
      select: 'c.sessionId, c.name, c.removed',
      where: 'c.sessionId >= @cutoff',
      params: [{ name: '@cutoff', value: cutoff }],
    });
    const cohort = new Set<string>();
    for (const row of playerRows) {
      if (typeof row.name !== 'string' || typeof row.sessionId !== 'string') continue;
      if (row.removed === true || row.sessionId < cutoff) continue;
      cohort.add(norm(row.name));
    }

    // --- Half 1: rec-card repeat engagement. --------------------------------
    // "More than once" is why `events` stores one doc per interaction instead
    // of upserting a latest-state row.
    //
    // THIS NUMBER UNDERCOUNTS IF ANYONE HAS DELETED THEIR ACCOUNT.
    // `DELETE /api/members/me` purges a member's `events` outright (see the
    // note on the `events` entry in lib/memberPurge.ts), so their taps leave
    // with them and this reads lower than what actually happened. That is the
    // intended trade — a smaller true number beats a larger false one — but
    // read a disappointing result here as "engagement, minus anyone who left"
    // before concluding the feature failed.
    let repeatTappers = 0;
    let anyTappers = 0;

    // --- The fit engine's feedback loop, tallied in the same pass. -----------
    // `served` is written server-side by /api/recommend on every fit pick
    // RETURNED (one per request — a format tap re-serves), so it is the
    // denominator and is NOT engagement: `engagedMembers` counts only members
    // who added, tried or rated, which is what the plan's review gate reads.
    interface PickEvent { memberId?: string; kind: string; catalogId?: string; engineVersion?: string; rating?: string }
    type VersionRow = { served: number; servedMembers: number; added: number; tried: number; ratedUp: number; ratedDown: number };
    const picks: { engineVersions: Record<string, VersionRow>; byCatalogId: Record<string, { added: number; tried: number; up: number; down: number }>; engagedMembers: number } =
      { engineVersions: {}, byCatalogId: {}, engagedMembers: 0 };
    const servedBy = new Map<string, Set<string>>();
    const engaged = new Set<string>();
    const tallyPick = (e: PickEvent, memberKey: string) => {
      const v = typeof e.engineVersion === 'string' ? e.engineVersion : 'unknown';
      const row = (picks.engineVersions[v] ??= { served: 0, servedMembers: 0, added: 0, tried: 0, ratedUp: 0, ratedDown: 0 });
      if (e.kind === 'pick_served') { row.served += 1; (servedBy.get(v) ?? servedBy.set(v, new Set()).get(v)!).add(memberKey); return; }
      engaged.add(memberKey);
      if (e.kind === 'pick_added') row.added += 1;
      if (e.kind === 'pick_tried') row.tried += 1;
      if (e.kind === 'pick_rated') { if (e.rating === 'up') row.ratedUp += 1; else if (e.rating === 'down') row.ratedDown += 1; }
      if (typeof e.catalogId === 'string') {
        const c = (picks.byCatalogId[e.catalogId] ??= { added: 0, tried: 0, up: 0, down: 0 });
        if (e.kind === 'pick_added') c.added += 1;
        if (e.kind === 'pick_tried') c.tried += 1;
        if (e.kind === 'pick_rated' && e.rating === 'up') c.up += 1;
        if (e.kind === 'pick_rated' && e.rating === 'down') c.down += 1;
      }
    };
    // --- The skill funnel's denominator: the ROSTER, not attendance. --------
    // Every other rate on this route is denominated on who turned up since the
    // cutoff. That frame has now misled three separate readings: 7/17 reads as
    // 41% where 7/56 is 12.5%; the rec-card rate "fell" 0.25 -> 0.176 purely
    // because the cohort grew 12 -> 17 while repeat tappers held at 3; and the
    // games 0/12 was read as disinterest for weeks when it was an empty picker.
    //
    // Attendance is not the question this block asks. Someone who skipped three
    // weeks still has the app on their phone and is exactly the person we want
    // to give a reason to open it. THE TWO DENOMINATORS ARE NOT COMPARABLE —
    // `cohortSize` is attendance, `skill.rosterSize` is the roster, and the
    // response names both so nobody divides across them by accident.
    const rosterNames = new Set<string>();
    const idToName = new Map<string, string>();
    try {
      for (const entry of await rosterMembers(scope.groupId)) {
        const nm = norm(String(entry.member?.name ?? ''));
        if (!nm) continue;
        rosterNames.add(nm);
        if (typeof entry.member?.id === 'string') idToName.set(entry.member.id, nm);
      }
    } catch (err) {
      console.warn('slice0: roster read failed (skill block will report zero):', err);
    }

    /**
     * One key space for a person across two containers.
     *
     * `events` keys by `memberId` when it has one and falls back to the name;
     * `assessments` carries both. `resolveActiveSubject` can mint a name-derived
     * id, so the same human can hold an assessment under one and events under
     * the other. Resolving everything to the roster's normalised NAME is what
     * puts all four ratios on one denominator. Anyone not on the roster returns
     * null and is dropped — not counted, not denominated.
     */
    const rosterKey = (memberId?: unknown, name?: unknown): string | null => {
      if (typeof memberId === 'string') {
        const byId = idToName.get(memberId);
        if (byId) return byId;
      }
      const byName = norm(String(name ?? ''));
      return byName && rosterNames.has(byName) ? byName : null;
    };

    const statsOpeners = new Set<string>();
    const checkInOpeners = new Set<string>();
    const openBySource: Record<string, number> = { strip: 0, trend: 0, learn: 0, unknown: 0 };

    try {
      await ensureContainer('events', '/memberId');
      // ONE cross-partition scan of `events` for the window, shared with the
      // fit engine's feedback tally below — it is partitioned by /memberId, so
      // a date-range read fans out across every partition, and it grows by one
      // row per racket pick served.
      // The GROUP's events: Slice-0 is a per-club readout.
      const events = await scope.query<Partial<PickEvent> & Record<string, unknown>>('events', {
        select: 'c.memberId, c.name, c.kind, c.at, c.catalogId, c.engineVersion, c.rating, c.source',
        where: 'c.at >= @since',
        params: [{ name: '@since', value: since }],
      });
      const taps = new Map<string, number>();
      for (const e of events) {
        if (typeof e?.kind !== 'string' || typeof e.at !== 'string' || e.at < since) continue;
        const key = typeof e.memberId === 'string' ? e.memberId : norm(String(e.name ?? ''));
        if (!key) continue;
        if (e.kind === 'rec_card_tap') taps.set(key, (taps.get(key) ?? 0) + 1);
        if ((PICK_KINDS as readonly string[]).includes(e.kind)) tallyPick(e as PickEvent, key);

        // --- Skill funnel. Denominated on the ROSTER, so an event from someone
        // who is not on it is dropped rather than counted against a
        // denominator they are not in.
        if (e.kind === 'stats_open' || e.kind === 'checkin_open') {
          const rk = rosterKey(e.memberId, e.name);
          if (rk) {
            // Each kind names itself. An `else` here would bind to "not
            // stats_open" rather than to `checkin_open`, so the day a third
            // kind joins the guard above it would be silently counted as a
            // check-in open — a misclassification that reads as real data.
            if (e.kind === 'stats_open') statsOpeners.add(rk);
            if (e.kind === 'checkin_open') {
              checkInOpeners.add(rk);
              const src = isCheckInSource(e.source) ? e.source : 'unknown';
              openBySource[src] = (openBySource[src] ?? 0) + 1;
            }
          }
        }
      }
      anyTappers = taps.size;
      repeatTappers = [...taps.values()].filter((n) => n > 1).length;
    } catch (err) {
      // Container may not exist yet on a deployment that hasn't taken a tap.
      console.warn('slice0: events read failed (treating as zero):', err);
    }

    // --- Half 2: game logging. ----------------------------------------------
    // `loggedBy` comes from the member_session cookie server-side, so it isn't
    // client-spoofable. Cross-partition, same shape as levelStore.fetchAllGames.
    const loggers = new Set<string>();
    try {
      await ensureContainer('gameResults', '/sessionId');
      const games = await scope.query<{ loggedBy?: unknown; loggedAt?: unknown }>('gameResults', {
        select: 'c.loggedBy, c.loggedAt',
        where: 'c.loggedAt >= @since',
        params: [{ name: '@since', value: since }],
      });
      for (const g of games) {
        if (typeof g?.loggedBy !== 'string' || typeof g.loggedAt !== 'string') continue;
        if (g.loggedAt < since) continue;
        loggers.add(norm(g.loggedBy));
      }
    } catch (err) {
      console.warn('slice0: games read failed (treating as zero):', err);
    }

    // --- Secondary signal: saved a racket. ----------------------------------
    // Free to compute and a stronger statement of intent than a tap, so it's
    // worth having alongside the criterion even though it isn't part of it.
    let racketSavers = 0;
    try {
      await ensureContainer('playerGear', '/memberId');
      const { resources: gear } = await getContainer('playerGear').items
        .query({ query: 'SELECT c.memberId, c.name, c.items FROM c' })
        .fetchAll();
      // NARROWED TO THE ROSTER, like every other count on this page.
      //
      // `playerGear` is PERSON-scoped (lib/containers.ts), so a raw read is
      // correct and `groupScope` would be wrong — but a club AGGREGATE over a
      // person container has to be narrowed, exactly as the `assessments` block
      // below and `stats/club/gear` already are. Without this, `racketSavers`
      // counted every saved racket in the DEPLOYMENT: one club's number moved
      // when a stranger in another club saved a racket, and the figure only
      // ever read as "suspiciously healthy" rather than as wrong.
      //
      // `c.name` is in the projection for the same reason `rosterKey` takes
      // one: a row whose `memberId` predates the migration is matched by name.
      const savers = new Set<string>();
      for (const g of gear) {
        if (!Array.isArray(g?.items)) continue;
        if (!g.items.some((i: { category?: string }) => i?.category === 'racket')) continue;
        const rk = rosterKey(g?.memberId, g?.name);
        // Not on this roster: not counted, and not denominated either.
        if (rk) savers.add(rk);
      }
      racketSavers = savers.size;
    } catch (err) {
      console.warn('slice0: gear read failed (treating as zero):', err);
    }

    // --- Check-in completions: read the CONTAINER, not a beacon. ------------
    // There is deliberately no `checkin_saved` event. Completions are already
    // stored per member with full history and a `takenAt`, so a beacon would be
    // a second, lossier bookkeeping of a fact we already hold — blind to every
    // check-in taken before the beacon shipped, and droppable by a `keepalive`
    // fetch whose 201 nobody waits for.
    //
    // `assessments` is PERSON-scoped (lib/containers.ts), so a raw read is
    // correct here and `groupScope` would be wrong — but a club AGGREGATE over
    // a person container MUST be narrowed to the roster, which `rosterKey` does.
    let everCheckedIn = 0;
    let repeatCheckedIn = 0;
    let checkedInWindow = 0;
    let partialSaves = 0;
    try {
      await ensureContainer('assessments', '/memberId');
      const { resources: rows } = await getContainer('assessments').items
        .query({ query: 'SELECT c.memberId, c.name, c.takenAt, c.ratings FROM c' })
        .fetchAll();
      const allTime = new Map<string, number>();
      const inWindow = new Set<string>();
      for (const a of rows) {
        const rk = rosterKey(a?.memberId, a?.name);
        if (!rk) continue;
        allTime.set(rk, (allTime.get(rk) ?? 0) + 1);
        if (typeof a?.takenAt === 'string' && a.takenAt >= since) {
          inWindow.add(rk);
          const rated = a?.ratings && typeof a.ratings === 'object' ? Object.keys(a.ratings).length : 0;
          if (rated > 0 && rated < SKILLS.length) partialSaves += 1;
        }
      }
      everCheckedIn = allTime.size;
      repeatCheckedIn = [...allTime.values()].filter((n) => n > 1).length;
      checkedInWindow = inWindow.size;
    } catch (err) {
      console.warn('slice0: assessments read failed (treating as zero):', err);
    }

    for (const [v, members] of servedBy) picks.engineVersions[v].servedMembers = members.size;
    picks.engagedMembers = engaged.size;

    const denominator = cohort.size;
    const rate = (n: number) => (denominator > 0 ? Math.round((n / denominator) * 1000) / 1000 : 0);

    // A ratio on an empty denominator is NULL, never 0. A confident zero there
    // is the lying-empty-state rule in metric form: it points the reader at a
    // stage that has not been reached rather than at the one that has. `verdict`
    // below already models this; these mirror it.
    const rosterSize = rosterNames.size;
    const ratio = (n: number, d: number) => (d > 0 ? Math.round((n / d) * 1000) / 1000 : null);
    const recRate = rate(repeatTappers);
    const gameRate = rate(loggers.size);

    // The written criterion kills only when BOTH halves miss. With no cohort
    // there is nothing to judge — report `null` rather than a confident "kill",
    // which would be the lying-empty-state failure in metric form.
    const verdict = denominator === 0
      ? null
      : recRate < REC_THRESHOLD && gameRate < GAME_THRESHOLD
        ? 'kill'
        : 'keep';

    return NextResponse.json({
      since,
      cohortSize: denominator,
      /**
       * The skill funnel. NOTE THE DENOMINATOR: `rosterSize`, not `cohortSize`.
       * These four ratios are not comparable with `recCard` / `games` above,
       * which are denominated on attendance since the cutoff.
       *
       * `statsOpeners` is a FLOOR, not a count. Both beacons need a
       * `member_session` cookie, and a member whose 30-day cookie lapsed still
       * sees the whole Stats tab (its reads are name-keyed) while recording
       * nothing. Unknown is not known-false: read a low number as "at least
       * this many", never as "only this many".
       *
       * `openBySource` counts EVENTS; `checkInOpeners` counts MEMBERS. One
       * person opening the check-in three times from the strip is 3 and 1.
       */
      skill: {
        rosterSize,
        statsOpeners: statsOpeners.size,
        checkInOpeners: checkInOpeners.size,
        openBySource,
        checkedInWindow,
        everCheckedIn,
        repeatCheckedIn,
        partialSaves,
        rates: {
          reach: ratio(statsOpeners.size, rosterSize),
          entry: ratio(checkInOpeners.size, statsOpeners.size),
          finish: ratio(checkedInWindow, checkInOpeners.size),
          repeat: ratio(repeatCheckedIn, rosterSize),
        },
      },
      recCard: {
        anyTappers,
        repeatTappers,
        rate: recRate,
        threshold: REC_THRESHOLD,
        passes: recRate >= REC_THRESHOLD,
      },
      games: {
        loggers: loggers.size,
        rate: gameRate,
        threshold: GAME_THRESHOLD,
        passes: gameRate >= GAME_THRESHOLD,
      },
      racketSavers,
      picks,
      verdict,
    });
  } catch (error) {
    console.error('GET admin/slice0 error:', error);
    return NextResponse.json({ error: 'read_failed' }, { status: 500 });
  }
}
