import { activeRacket } from './activeRacket';
import { CLUB_GEAR_MIN_COHORT } from './clubGear';
import type { GearItem, PlayerGear } from './types';

/**
 * "The club strings this frame 24–27 lb": the range of tensions members
 * playing one racket frame have on it now.
 *
 * READS ONLY THE FRAME, THE STRING AND THE TENSION. The fit answers live on the
 * same document — swing, grip, an arm that gets sore — and the fit profile
 * promises the club tally "only ever sees the frame, never your arm history".
 * The input type below cannot carry them.
 *
 * Below `CLUB_GEAR_MIN_COHORT` there is no band at all, for the same reason
 * the gear tally drops small entries: a range drawn from two people is a
 * person's tension.
 */

export type TensionDoc = Pick<PlayerGear, 'items' | 'activeRacketId'>;

export interface ClubTensionBand {
  sampleSize: number;
  low: number;
  high: number;
  /** The members' average, to the half pound. */
  mean: number;
}

/** The tension on the string a member has on now: the newest live string. */
function currentTension(doc: TensionDoc): number | null {
  let latest: GearItem | null = null;
  for (const i of doc.items ?? []) {
    if (i && !i.retiredAt && i.category === 'string') latest = i;
  }
  return typeof latest?.tensionLbs === 'number' ? latest.tensionLbs : null;
}

/** Every frame's band at once, keyed by catalog id. */
export function tallyClubTension(docs: TensionDoc[]): Map<string, ClubTensionBand> {
  const samples = new Map<string, number[]>();
  for (const doc of docs) {
    const frame = activeRacket(doc as PlayerGear)?.catalogId;
    const lbs = currentTension(doc);
    if (!frame || lbs === null) continue;
    samples.set(frame, [...(samples.get(frame) ?? []), lbs]);
  }
  const bands = new Map<string, ClubTensionBand>();
  for (const [frame, values] of samples) {
    if (values.length < CLUB_GEAR_MIN_COHORT) continue;
    const mean = Math.round((values.reduce((a, b) => a + b, 0) / values.length) * 2) / 2;
    bands.set(frame, { sampleSize: values.length, low: Math.min(...values), high: Math.max(...values), mean });
  }
  return bands;
}

export function clubTensionFor(docs: TensionDoc[], frameId: string): ClubTensionBand | null {
  return tallyClubTension(docs).get(frameId) ?? null;
}
