import { NextRequest, NextResponse } from 'next/server';
import { getContainer, ensureContainer } from '@/lib/cosmos';
import { isAdminAuthed, unauthorized } from '@/lib/auth';
import { getClientIp, checkRateLimit } from '@/lib/rateLimit';

export const dynamic = 'force-dynamic';

/** Thresholds straight from docs/plans/value-hub-slice-0.md. */
const REC_THRESHOLD = 0.4;
const GAME_THRESHOLD = 0.3;

const norm = (s: string) => s.trim().toLowerCase();

/** `session-YYYY-MM-DD` sorts lexically, so a date cutoff is a string compare. */
const sessionCutoff = (sinceDate: string) => `session-${sinceDate}`;

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

  // Default cutoff is the v1.7 promotion, when Slice-0 nominally went live.
  const sinceParam = new URL(req.url).searchParams.get('since')?.slice(0, 10) ?? '';
  const since = /^\d{4}-\d{2}-\d{2}$/.test(sinceParam) ? sinceParam : '2026-06-13';

  try {
    // --- Denominator: who actually turned up. -------------------------------
    // Attendance, not membership: `members.active` is an admin soft-delete flag
    // rather than an activity signal and would overcount badly. Mirrors the
    // filtering in app/api/stats/partners/route.ts — the mock store ignores the
    // SQL predicate, so the cutoff and `removed` filter are re-applied in JS to
    // keep mock and prod identical.
    const cutoff = sessionCutoff(since);
    const { resources: playerRows } = await getContainer('players').items
      .query({
        query: 'SELECT c.sessionId, c.name, c.removed FROM c WHERE c.sessionId >= @cutoff',
        parameters: [{ name: '@cutoff', value: cutoff }],
      })
      .fetchAll();
    const cohort = new Set<string>();
    for (const row of playerRows) {
      if (typeof row.name !== 'string' || typeof row.sessionId !== 'string') continue;
      if (row.removed === true || row.sessionId < cutoff) continue;
      cohort.add(norm(row.name));
    }

    // --- Half 1: rec-card repeat engagement. --------------------------------
    // "More than once" is why `events` stores one doc per interaction instead
    // of upserting a latest-state row.
    let repeatTappers = 0;
    let anyTappers = 0;
    try {
      await ensureContainer('events', '/memberId');
      const { resources: events } = await getContainer('events').items
        .query({
          query: 'SELECT c.memberId, c.name, c.kind, c.at FROM c WHERE c.at >= @since',
          parameters: [{ name: '@since', value: since }],
        })
        .fetchAll();
      const taps = new Map<string, number>();
      for (const e of events) {
        if (e?.kind !== 'rec_card_tap' || typeof e.at !== 'string' || e.at < since) continue;
        const key = typeof e.memberId === 'string' ? e.memberId : norm(String(e.name ?? ''));
        if (!key) continue;
        taps.set(key, (taps.get(key) ?? 0) + 1);
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
      const { resources: games } = await getContainer('gameResults').items
        .query({
          query: 'SELECT c.loggedBy, c.loggedAt FROM c WHERE c.loggedAt >= @since',
          parameters: [{ name: '@since', value: since }],
        })
        .fetchAll();
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
        .query({ query: 'SELECT c.memberId, c.items FROM c' })
        .fetchAll();
      racketSavers = gear.filter((g) =>
        Array.isArray(g?.items) && g.items.some((i: { category?: string }) => i?.category === 'racket'),
      ).length;
    } catch (err) {
      console.warn('slice0: gear read failed (treating as zero):', err);
    }

    const denominator = cohort.size;
    const rate = (n: number) => (denominator > 0 ? Math.round((n / denominator) * 1000) / 1000 : 0);
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
      verdict,
    });
  } catch (error) {
    console.error('GET admin/slice0 error:', error);
    return NextResponse.json({ error: 'read_failed' }, { status: 500 });
  }
}
