'use client';

import { useCallback, useEffect, useState } from 'react';

const BASE = process.env.NEXT_PUBLIC_BASE_PATH ?? '';

export interface AdminNeedsYou {
  /**
   * How many actionable admin signals are live, or `null` while loading and on
   * failure. `null` is deliberately NOT `0`: an admin reading "all clear" off a
   * dead fetch is the lying-empty-state pattern this repo has a rule against
   * (see CLAUDE.md). Callers must render nothing rather than a zero.
   */
  needsYou: number | null;
  loadError: boolean;
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
 */
export function useAdminNeedsYou(enabled: boolean): AdminNeedsYou {
  const [needsYou, setNeedsYou] = useState<number | null>(null);
  const [loadError, setLoadError] = useState(false);

  const load = useCallback(async () => {
    // No `setLoadError(false)` reset here: it initialises false and this runs
    // once, so the reset was dead — and being the first *synchronous* statement
    // in an effect-invoked async function, it was the one thing tripping
    // react-hooks/set-state-in-effect.
    try {
      const [playersRes, birdsRes, membersRes] = await Promise.all([
        fetch(`${BASE}/api/players?all=true`, { cache: 'no-store' }),
        fetch(`${BASE}/api/birds`, { cache: 'no-store' }),
        fetch(`${BASE}/api/members`, { cache: 'no-store' }),
      ]);
      if (!playersRes.ok || !birdsRes.ok || !membersRes.ok) {
        setLoadError(true);
        setNeedsYou(null);
        return;
      }
      const players = (await playersRes.json()) as Array<{ paid?: boolean; removed?: boolean; waitlisted?: boolean }>;
      const birds = (await birdsRes.json()) as { currentStock?: number; burnPerSession?: number };
      const members = (await membersRes.json()) as Array<{ active?: boolean; sessionCount?: number; lastSeen?: string }>;

      const active = players.filter((p) => !p.removed && !p.waitlisted);
      const unpaid = active.filter((p) => p.paid !== true).length;

      // Burn rate comes from the API on a last-60d window, so stock and burn
      // span the same window (see the mixed-window gotcha in CLAUDE.md).
      const stock = birds?.currentStock ?? 0;
      const burn = birds?.burnPerSession ?? 0;
      const weeksLeft = burn > 0 && stock > 0 ? Math.floor(stock / burn) : null;
      // No burn data is "unknown", not "fine" — but it is also not an action,
      // so it does not count. The hero said "Awaiting bird data" here; a row
      // with room for two words cannot, and a wrong count is worse than none.
      const birdsLow = weeksLeft !== null && weeksLeft <= 4;

      const sixtyDaysAgo = Date.now() - 60 * 86_400_000;
      const dormant = Array.isArray(members)
        ? members.filter((m) => {
            if (m.active === false) return false;
            if (!m.sessionCount || m.sessionCount === 0) return true;
            if (m.lastSeen) {
              const t = new Date(m.lastSeen).getTime();
              if (Number.isFinite(t) && t < sixtyDaysAgo) return true;
            }
            return false;
          }).length
        : 0;

      setNeedsYou([unpaid > 0, birdsLow, dormant > 0].filter(Boolean).length);
    } catch {
      setLoadError(true);
      setNeedsYou(null);
    }
  }, []);

  useEffect(() => {
    if (!enabled) return;
    void load();
  }, [enabled, load]);

  return { needsYou, loadError };
}
