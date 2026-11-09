import { RACKET_LOOKS, racketGround } from '@/lib/racketLook';

/**
 * A member's picture: a racket from the catalog, drawn from the image already
 * rendered for it (`public/rackets/<id>.webp`, `racketSrc`), or one of the six
 * logo-shuttle "birdies" (`public/brand/birdies/<colour>.webp`, drawn by
 * `scripts/make-birdie-avatars.mjs`). Absent means the initial, which is what
 * every member had before this existed.
 *
 * The racket id is resolved when the member SAVES — "my racket" is copied, not
 * followed — so a roster needs one `members` read, never a gear read per name.
 * It is never set on anyone's behalf: club gear is cohort-gated for privacy
 * (`CLUB_GEAR_MIN_COHORT`), so a racket becomes a public picture only when its
 * owner picks it. A tagged union, so older code meeting a kind it does not know
 * reads it as no picture (`normalizeAvatar`) and shows the initial.
 */
export type MemberAvatar =
  | { kind: 'racket'; racketId: string }
  | { kind: 'birdie'; colour: BirdieColour };

/** The birdie colours, in the order the picker shows them. */
export const BIRDIE_COLOURS = ['green', 'yellow', 'pink', 'blue', 'purple', 'orange'] as const;
export type BirdieColour = (typeof BIRDIE_COLOURS)[number];

export function isBirdieColour(c: unknown): c is BirdieColour {
  return typeof c === 'string' && (BIRDIE_COLOURS as readonly string[]).includes(c);
}

/**
 * A birdie's picture. Served from the app's own `public/` (not `assetUrl`, whose
 * storage container holds only the racket and string renders), ~3 KB each.
 */
export function birdieSrc(colour: BirdieColour): string {
  return `${process.env.NEXT_PUBLIC_BASE_PATH ?? ''}/brand/birdies/${colour}.webp`;
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
  const { kind, racketId, colour } = raw as { kind?: unknown; racketId?: unknown; colour?: unknown };
  if (kind === 'racket' && isRacketAvatarId(racketId)) return { kind: 'racket', racketId };
  if (kind === 'birdie' && isBirdieColour(colour)) return { kind: 'birdie', colour };
  return undefined;
}

/** Two pictures are the same choice (null is the initial). */
export function sameAvatar(a: MemberAvatar | null, b: MemberAvatar | null): boolean {
  if (a === null || b === null) return a === b;
  if (a.kind === 'racket' && b.kind === 'racket') return a.racketId === b.racketId;
  if (a.kind === 'birdie' && b.kind === 'birdie') return a.colour === b.colour;
  return false;
}

/** A stable key for a picture (React keys, the picker). */
export function avatarKey(a: MemberAvatar | null): string {
  if (!a) return 'initial';
  return a.kind === 'racket' ? `racket:${a.racketId}` : `birdie:${a.colour}`;
}

/** Read-tolerant: a stored value that no longer validates renders as the initial. */
export function normalizeAvatar(raw: unknown): MemberAvatar | null {
  return parseAvatar(raw) ?? null;
}

/**
 * The circle behind a racket: light behind a dark frame, dark behind a light
 * one. The rule lives beside the paint it reads (`racketGround` in
 * `lib/racketLook.ts`), where `scripts/make-racket-avatars.mjs` can import it
 * to bake the same ground into each avatar image.
 */
export function racketAvatarGround(racketId: string): string {
  return racketGround(racketId === DEFAULT_RACKET_ID ? null : racketId);
}

/** Every racket a shuffle may land on. */
export function racketAvatarIds(): string[] {
  return Object.keys(RACKET_LOOKS);
}
