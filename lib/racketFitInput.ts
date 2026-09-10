import { getContainer } from './cosmos';
import { buildProfile } from './racketProfile';
import { activeRacket, rackets } from './activeRacket';
import { fitLevel, isScorable, canon, type FitInput } from './racketFit';
import type { CatalogItem, PlayerGear } from './types';
import type { Rating } from './assessment';

/**
 * The fit engine's view of a member, built ONCE for both routes that score:
 * `GET /api/recommend` (what the member sees) and `GET /api/admin/fit-preview`
 * (what the owner and the stringer rate the golden set against). Two copies
 * meant the preview could score an input production never produced, and the
 * golden test would pass for an engine members never see.
 *
 * The anchor is the ACTIVE racket, and only when its catalogId resolves to a
 * scorable row; every other racket in the bag, and a free-text one, is
 * excluded by id or by normalised label.
 */
export function buildFitInput(
  gear: PlayerGear | null,
  ratings: Rating[],
  catalogRackets: CatalogItem[],
): FitInput {
  const profile = buildProfile({ ratings, gear });
  const active = activeRacket(gear);
  const anchorRow = active?.catalogId ? catalogRackets.find((r) => r.id === active.catalogId) ?? null : null;
  const owned = rackets(gear).filter((i) => !i.retiredAt);
  return {
    anchor: anchorRow && isScorable(anchorRow) ? anchorRow : null,
    ownedIds: new Set(owned.map((i) => i.catalogId).filter((id): id is string => typeof id === 'string')),
    ownedLabels: new Set(owned.map((i) => canon(i.label)).filter(Boolean)),
    goal: gear?.fitGoal,
    swing: gear?.fitSwing,
    armComfort: gear?.fitArmComfort,
    grip: gear?.fitGrip,
    format: gear?.playFormat ?? 'both',
    budgetMaxCad: typeof gear?.budgetMaxCad === 'number' ? gear.budgetMaxCad : undefined,
    level: profile ? fitLevel(profile) : null,
    hasRatings: ratings.length > 0,
  };
}

/**
 * The gear doc, or null when it does not exist. A real-Cosmos 404 is "no
 * gear yet"; ANY other failure throws, so a flaky read cannot become a
 * confident "owns nothing" (the lying-empty-state rule — it would re-enable
 * recommending a racket the member already owns).
 */
export async function readGearOrNull(memberId: string): Promise<PlayerGear | null> {
  try {
    const { resource } = await getContainer('playerGear').item(`gear-${memberId}`, memberId).read();
    return (resource as PlayerGear | undefined) ?? null;
  } catch (err) {
    const code = (err as { code?: number | string })?.code;
    if (code !== 404 && code !== '404') throw err;
    return null;
  }
}
