/**
 * The racket picture a stringing email shows, found the bench's way
 * (`components/stringing/useHoleLookup.ts`): the job's free-text label matched
 * exactly against the catalog's "Brand Model". Nothing is stored on the job,
 * so the bench and the email read the same rule and cannot disagree.
 *
 * A catalog racket with a render shows its own; any other label shows the
 * matte black `_unknown`. A failed catalog read shows NO picture rather than
 * the black one, which would say "we don't know this racket" about a racket
 * we do know.
 */
import { catalogByCategory } from './catalogQuery';
import { racketIdForLabel, racketIdsByTallyKey } from './gearSetup';
import { racketPictureUrl } from './emailLayout';
import type { CatalogItem } from './types';

export async function racketPictureFor(racketLabel: string, origin: string | null): Promise<string | null> {
  if (!origin) return null;
  try {
    const rackets = await catalogByCategory<CatalogItem>('racket');
    return racketPictureUrl(origin, racketIdForLabel(racketLabel, racketIdsByTallyKey(rackets)));
  } catch (err) {
    console.error('[email] racket catalog read failed; the email goes without a picture:', err);
    return null;
  }
}
