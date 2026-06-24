import type { Session } from './types';
import { normalizeBirdUsages, totalBirdCost } from './birdUsages';

function round2(n: number): number {
  return Math.round(n * 100) / 100;
}

/**
 * Court + bird cost totals for a session — the single source of the "what did
 * this session cost" math. One place so the three callers can never disagree:
 *   - `POST /api/session/settle` freezes these into the `SettledSnapshot`;
 *   - `GET /api/players/unpaid` uses `totalCost` to compute a per-person share
 *     for sessions that were never settled (no frozen `owedAmount`);
 *   - any future cost display.
 *
 * Tolerates the legacy single-object `birdUsage` shape via `normalizeBirdUsages`.
 * Missing court inputs → 0 (you can't owe a share of an unpriced session).
 */
export function sessionCostTotals(
  session:
    | Pick<Session, 'costPerCourt' | 'courts' | 'birdUsage' | 'birdUsages'>
    | null
    | undefined,
): { courtTotal: number; birdTotal: number; totalCost: number } {
  const courtTotal = round2((session?.costPerCourt ?? 0) * (session?.courts ?? 0));
  const birdTotal = totalBirdCost(normalizeBirdUsages(session));
  const totalCost = round2(courtTotal + birdTotal);
  return { courtTotal, birdTotal, totalCost };
}
