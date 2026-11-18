/**
 * The racket the strings map is matched to, as remembered on THIS phone
 * (docs/plans/map-racket-choice.md, Decision 1). A view setting, like the
 * map's axis: it is not the racket in play and is saved nowhere else.
 *
 * The value is a bag item id. The server checks it against the caller's own
 * bag on every read, so a stale or foreign value answers for the racket in
 * play, and the card then forgets it.
 */
const KEY = 'bpm:strings-racket';

export function readMapRacket(): string | null {
  try {
    return localStorage.getItem(KEY) || null;
  } catch {
    return null;
  }
}

export function writeMapRacket(id: string | null): void {
  try {
    if (id) localStorage.setItem(KEY, id);
    else localStorage.removeItem(KEY);
  } catch {
    /* private mode: the choice lasts the visit */
  }
}
