import type { RacketLook } from './racketLook';
import type { ItemLook } from './types';

export type { ItemLook };

/**
 * What a member may change about how their racket looks (Grant, 2026-09-14).
 *
 * THE MAKER DECIDES THE FRAME; THE MEMBER DECIDES WHAT THEY PUT ON IT. String
 * colour and overgrip colour are real choices a player makes, so every racket
 * takes them. Frame colour, paint pattern and head shape are the model's own —
 * recolouring a catalog Astrox 88D would show something that is not an Astrox
 * 88D — so only a racket typed in by name (which nobody else can describe)
 * takes those.
 *
 * Every value is from a closed palette, drawn from colours the catalog already
 * uses (the design's swatch sets), so a stored look can only ever be one the
 * UI offers.
 */

// eslint-disable-next-line no-restricted-syntax -- product paint palettes, not theme colours; they are painted onto the 3D model.
export const SWATCHES = { frame: ['#212529', '#eeedf0', '#1f3a5a', '#128182', '#b3201f', '#d9e021', '#e86fa6', '#5a3f9c'], string: ['#f2efe6', '#f2d23a', '#1a1a1a', '#3a7cc0', '#c8283c', '#e86fa6'], wrap: ['#e8e8e6', '#1a1a1a', '#d9d9d9', '#2f7bd9', '#c8285a', '#ecc20b'] } as const;

export const LOOK_PATTERNS = ['shoulder', 'tips', 'chevron', 'crown', 'plain'] as const;
export const LOOK_SHAPES = ['isometric', 'oval', 'boxy'] as const;

export type LookPattern = (typeof LOOK_PATTERNS)[number];
export type LookShape = (typeof LOOK_SHAPES)[number];

/**
 * The stored look, or null when the value is not one the UI could have sent.
 * `catalog` says whether the racket has a catalog row: a frame colour, pattern
 * or shape on one of those is refused rather than stored.
 */
export function parseItemLook(raw: unknown, catalog: boolean): ItemLook | null {
  if (!raw || typeof raw !== 'object' || Array.isArray(raw)) return null;
  const r = raw as Record<string, unknown>;
  const out: ItemLook = {};
  const colour = (key: 'string' | 'wrap' | 'frame') => {
    const v = r[key];
    if (v === undefined || v === null) return true;
    if (typeof v !== 'string' || !(SWATCHES[key] as readonly string[]).includes(v)) return false;
    out[key] = v;
    return true;
  };
  if (!colour('string') || !colour('wrap')) return null;
  const typedOnly = ['frame', 'pattern', 'shape'].some((k) => r[k] !== undefined && r[k] !== null);
  if (typedOnly && catalog) return null;
  if (!colour('frame')) return null;
  if (r.pattern !== undefined && r.pattern !== null) {
    if (!(LOOK_PATTERNS as readonly unknown[]).includes(r.pattern)) return null;
    out.pattern = r.pattern as LookPattern;
  }
  if (r.shape !== undefined && r.shape !== null) {
    if (!(LOOK_SHAPES as readonly unknown[]).includes(r.shape)) return null;
    out.shape = r.shape as LookShape;
  }
  return out;
}

export function hasItemLook(look: ItemLook | null | undefined): look is ItemLook {
  return !!look && Object.values(look).some((v) => v !== undefined);
}

/** What the 3D model paints: the model's look, the member's choices over it. */
export function modelInputs(base: RacketLook, look: ItemLook | undefined) {
  return {
    look: { frame: base.frame, accent: base.accent, grip: base.grip },
    tweaks: {
      frame: look?.frame ?? null,
      string: look?.string ?? null,
      wrap: look?.wrap ?? null,
      pattern: look?.pattern ?? base.pattern ?? 'shoulder',
      shape: look?.shape ?? base.shape ?? 'isometric',
    },
  } as const;
}
