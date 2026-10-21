'use client';

import { birdReorder, type BirdReorder } from './birdRunway';
import { useEffect, useState } from 'react';
import { isNoActiveSession } from '@/lib/apiFetch';
import { sharedFetch } from '@/lib/sharedRead';
import { isDormant, type DormantInput } from '@/lib/dormant';
import { dueFor, todayIso } from '@/lib/stringingDue';

const BASE = process.env.NEXT_PUBLIC_BASE_PATH ?? '';

export interface AdminNeedsYou {
  /**
   * How many actionable admin signals are live, or `null` while loading and on
   * failure. `null` is deliberately NOT `0`: an admin reading "all clear" off a
   * dead fetch is the lying-empty-state pattern this repo has a rule against
   * (see CLAUDE.md). Callers must render nothing rather than a zero.
   */
  needsYou: number | null;
  /**
   * The bench's half of the count, for the row that opens it: requests nobody
   * has taken, and jobs past their ready-by date. `null` while loading, on
   * failure, and when the stringing flag is off (the route 404s) — which is
   * not a failed check, just no bench.
   */
  stringing: { waiting: number; late: number } | null;
  /**
   * What the count is made of, so the Command Center can LIST it — Profile
   * says "3 need you" and the admin should land on the three, not hunt for
   * them. `null` exactly when `needsYou` is.
   */
  breakdown: { unpaid: number; birds: BirdReorder | null; dormant: number } | null;
  loadError: boolean;
}

export type BenchRow = { stringerId: string | null; status: string; readyBy: string | null; paidAt: string | null };

/**
 * The bench's two actionable counts. Unclaimed = requested and nobody's; late =
 * past readyBy with WORK still to do. A `ready` or `picked_up` job is never
 * late: the work is done, and a paid racket nobody has collected is the
 * player's delay, not the stringer's (`dueFor` alone would call a PAID ready
 * job overdue — it only exempts the unpaid one). Shared with the Command
 * Center's bench row so the two cannot disagree about what "waiting" means.
 */
const WORK_DONE = new Set(['ready', 'picked_up']);
export function benchSignals(rows: BenchRow[], today = todayIso()): { waiting: number; late: number } {
  return {
    waiting: rows.filter((j) => j.stringerId === null && j.status === 'requested').length,
    late: rows.filter((j) => !WORK_DONE.has(j.status) && dueFor(j, today).tone === 'overdue').length,
  };
}

/**
 * The three signals that used to headline `AdminConsoleHero` as "X things need
 * you", without the card around them. Profile now shows the count on a single
 * row, so the stat tiles — and the `/api/session` fetch that fed their
 * date/capacity/deadline subtitle — are gone; the remaining three endpoints are
 * exactly the three the count is computed from.
 *
 * Signals, unchanged from the hero so the number means the same thing:
 *   - anyone unpaid in the active session
 *   - bird stock at or under four sessions of burn
 *   - any dormant member
 *   - a stringing request nobody has taken, or a job past its ready-by date
 *     (audit 2026-10-11: three unclaimed requests and a job two days late
 *     read as "1 need you", because nothing counted the bench)
 */
/** `refreshKey` re-reads, for the Command Center after a payment or a move on the bench. */
export function useAdminNeedsYou(enabled: boolean, refreshKey = 0): AdminNeedsYou {
  const [needsYou, setNeedsYou] = useState<number | null>(null);
  const [stringing, setStringing] = useState<AdminNeedsYou['stringing']>(null);
  const [breakdown, setBreakdown] = useState<AdminNeedsYou['breakdown']>(null);
  const [loadError, setLoadError] = useState(false);

  // Inlined into the effect rather than hoisted into a `useCallback` the effect
  // then calls. Nothing outside this hook ever invoked it, and the indirection
  // was what tripped `react-hooks/set-state-in-effect`: the rule cannot see
  // through the callback to tell that every `setState` here sits behind an
  // `await`, so it reported a synchronous cascade that never existed. Inlining
  // makes the timing visible to the rule and buys real cancellation, which the
  // callback version never had — a slow response could land after unmount.
  useEffect(() => {
    if (!enabled) return;
    let cancelled = false;

    void (async () => {
      try {
        // The stat tiles read the birds and the roster, and the bench menu row
        // reads the jobs, in the same commit as this card; `sharedFetch` makes
        // that one request each while it is in flight (lib/sharedRead.ts).
        // Nothing else on the screen asks for the whole-history players path.
        const [playersRes, birdsRes, membersRes, benchRes] = await Promise.all([
          fetch(`${BASE}/api/players?all=true`, { cache: 'no-store' }),
          sharedFetch('/api/birds'),
          sharedFetch('/api/members'),
          sharedFetch('/api/stringing/jobs'),
        ]);
        if (cancelled) return;
        // A new group has no session yet: nobody can be unpaid, and that is
        // an answer, not a failed check.
        const noSession = await isNoActiveSession(playersRes);
        if (cancelled) return;
        if ((!playersRes.ok && !noSession) || !birdsRes.ok || !membersRes.ok) {
          setLoadError(true);
          setNeedsYou(null);
          setStringing(null);
          setBreakdown(null);
          return;
        }
        const players = noSession
          ? []
          : ((await playersRes.json()) as Array<{ paid?: boolean; removed?: boolean; waitlisted?: boolean }>);
        const birds = (await birdsRes.json()) as { currentStock?: number; burnPerSession?: number };
        const members = (await membersRes.json()) as DormantInput[];
        /* The bench FAILS OPEN. A 404 is the stringing flag off (no bench,
           not a failed read); any other failure — the route shares a per-IP
           limit with every member's Home card, so a 429 on gym wifi is
           plausible — leaves the bench UNKNOWN (`stringing: null`) rather
           than nulling the three signals that were fine (final review). */
        let benchRows: BenchRow[] | null = null;
        if (benchRes.ok) {
          try {
            benchRows = ((await benchRes.json()) as { jobs?: BenchRow[] }).jobs ?? [];
          } catch {
            benchRows = null;
          }
        }
        if (cancelled) return;

        const active = players.filter((p) => !p.removed && !p.waitlisted);
        const unpaid = active.filter((p) => p.paid !== true).length;

        // Burn rate comes from the API on a last-60d window, so stock and burn
        // span the same window (see the mixed-window gotcha in CLAUDE.md).
        const stock = birds?.currentStock ?? 0;
        const burn = birds?.burnPerSession ?? 0;
        // No burn data is "unknown", not "fine" — but it is also not an action,
        // so it does not count. An empty cupboard always does (lib/birdRunway).
        const reorder = birds ? birdReorder(stock, burn) : null;
        const birdsLow = reorder === 'now' || reorder === 'soon';

        const dormant = Array.isArray(members) ? members.filter((m) => isDormant(m)).length : 0;

        const bench = benchRows ? benchSignals(benchRows) : null;
        setStringing(bench);
        setBreakdown({ unpaid, birds: reorder, dormant });

        setNeedsYou(
          [unpaid > 0, birdsLow, dormant > 0, bench !== null && bench.waiting + bench.late > 0]
            .filter(Boolean).length,
        );
        // Profile now shows a failure, so a success on a later run (the row
        // re-enabled after a sign-in) must clear an earlier one.
        setLoadError(false);
      } catch {
        if (cancelled) return;
        setLoadError(true);
        setNeedsYou(null);
        setStringing(null);
        setBreakdown(null);
      }
    })();

    return () => {
      cancelled = true;
    };
  }, [enabled, refreshKey]);

  return { needsYou, stringing, breakdown, loadError };
}
