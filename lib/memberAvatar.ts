import { RACKET_LOOKS, racketLook } from '@/lib/racketLook';

/**
 * A member's picture: a racket from the catalog, drawn from the image already
 * rendered for it (`public/rackets/<id>.webp`, `racketSrc`). Absent means the
 * initial, which is what every member had before this existed.
 *
 * The racket id is resolved when the member SAVES — "my racket" is copied, not
 * followed — so a roster needs one `members` read, never a gear read per name.
 * It is never set on anyone's behalf: club gear is cohort-gated for privacy
 * (`CLUB_GEAR_MIN_COHORT`), so a racket becomes a public picture only when its
 * owner picks it. Shaped as a tagged object so a photo can be a second kind.
 */
export interface MemberAvatar {
  kind: 'racket';
  racketId: string;
}

/** The id for a racket with no catalog look (a typed-in one). */
export const DEFAULT_RACKET_ID = '_default';

export function isRacketAvatarId(id: unknown): id is string {
  return typeof id === 'string' && (id === DEFAULT_RACKET_ID || Object.prototype.hasOwnProperty.call(RACKET_LOOKS, id));
}

/**
 * Parse what a client sent. `null` clears the picture; anything malformed is
 * `undefined`, which the route answers with a 400.
 */
export function parseAvatar(raw: unknown): MemberAvatar | null | undefined {
  if (raw === null) return null;
  if (!raw || typeof raw !== 'object') return undefined;
  const { kind, racketId } = raw as { kind?: unknown; racketId?: unknown };
  if (kind !== 'racket' || !isRacketAvatarId(racketId)) return undefined;
  return { kind: 'racket', racketId };
}

/** Read-tolerant: a stored value that no longer validates renders as the initial. */
export function normalizeAvatar(raw: unknown): MemberAvatar | null {
  return parseAvatar(raw) ?? null;
}

function luminance(hex: string): number {
  const m = /^#([0-9a-f]{6})$/i.exec(hex);
  if (!m) return 0;
  const n = parseInt(m[1], 16);
  const [r, g, b] = [(n >> 16) & 255, (n >> 8) & 255, n & 255].map((c) => c / 255);
  return 0.2126 * r + 0.7152 * g + 0.0722 * b;
}

/* Two fixed grounds, not the per-name colour: the name colours are mid-dark and
   swallowed dark frames and pale ones alike ("the background is making the
   racket not seen", Grant). The racket is the identity here, so its ground is
   chosen for contrast with its own frame paint. */
/* eslint-disable no-restricted-syntax -- fixed grounds for a painted image, not theme colours */
const LIGHT_GROUND = '#eef0f2';
const DARK_GROUND = '#1c2024';
/* eslint-enable no-restricted-syntax */

/** The circle behind a racket: light behind a dark frame, dark behind a light one. */
export function racketAvatarGround(racketId: string): string {
  const look = racketLook(racketId === DEFAULT_RACKET_ID ? null : racketId);
  return luminance(look.frame) > 0.5 ? DARK_GROUND : LIGHT_GROUND;
}

/** Every racket a shuffle may land on. */
export function racketAvatarIds(): string[] {
  return Object.keys(RACKET_LOOKS);
}
