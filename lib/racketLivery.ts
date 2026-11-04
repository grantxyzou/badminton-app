/**
 * A catalog racket's real paint, matched to photos of it — the "accurate"
 * render (`docs/plans/racket-fidelity.md`). Where `lib/racketLook.ts` gives a
 * model three colours, a livery says WHERE each colour sits: up the head, on
 * which side, in which bands and slashes, and down the shaft to the handle,
 * plus the finish and the head's measured shape. `lib/racketModel.ts` paints
 * it as vertex colours, so the list images and the live 3D viewer read the
 * same spec.
 *
 * Every entry was laid out by eye from retailer or maker photos of that
 * racket, never traced. The maker's logos and wordmarks are left off on
 * purpose: they are the maker's marks, and a likeness does not need them.
 *
 * ANGLES are degrees round the head as you look at the string face: 0 is the
 * right-hand widest point, 90 the crown, ±180 the left-hand widest point, -90
 * the throat. HEIGHTS run 0 (throat) to 1 (crown) on the head, and 0 (handle
 * end) to 1 (the throat) on the shaft.
 *
 * Pure data and pure maths, no three.js, so it can be imported anywhere.
 */

/** One colour, or colour stops along a 0–1 run: `[[0, '#000'], [1, '#fff']]`. */
export type Stops = string | ReadonlyArray<readonly [number, string]>;

/** A colour laid over an arc of the head, from one angle to another
 *  (counter-clockwise; `from > to` wraps through ±180). */
export interface LiveryBand {
  from: number;
  to: number;
  colour: string;
  /** Edge softness in degrees (default 3). */
  soft?: number;
}

/** A thin painted slash across the frame at one angle. */
export interface LiveryMark {
  at: number;
  colour: string;
  /** Width in degrees (default 2). */
  width?: number;
}

/** The head's outline as measured from a face-on photo. */
export interface LiveryShape {
  /** Outer width ÷ outer length of the head (the frame included). */
  ratio: number;
  /** Where the head is widest, as a fraction of its length from the crown. */
  widest: number;
  /** How square the crown runs: 2 is an ellipse, higher is boxier (1.8–3.2). */
  nTop?: number;
  /** How square the lower lobe runs into the throat (1.6–3). */
  nBot?: number;
}

export type LiveryFinish = 'gloss' | 'matte' | 'metallic' | 'pearl';

export interface Livery {
  /** Where the reference photos came from (a domain), so an entry can be checked. */
  source: string;
  /** The head, throat (0) to crown (1). On a split livery, the RIGHT half. */
  head: Stops;
  /** The left half, when the two halves are painted differently. */
  left?: Stops;
  bands?: readonly LiveryBand[];
  marks?: readonly LiveryMark[];
  /** The T-joint. Default: the head's colour at the throat. */
  throat?: string;
  /** The shaft, handle end (0) to the throat (1). */
  shaft: Stops;
  /** The tapered cone where the shaft enters the handle. Default: the shaft's handle end. */
  cone?: string;
  butt?: string;
  buttTrim?: string;
  /** The ring at the top of the grip. Default: the cone. */
  collar?: string;
  grip: string;
  grommets?: string;
  strings?: string;
  finish?: LiveryFinish;
  shape?: LiveryShape;
}

const HEX = /^#[0-9a-f]{6}$/i;

/** Every colour a livery names, for validation. */
export function liveryColours(l: Livery): string[] {
  const stops = (s: Stops | undefined) => (s === undefined ? [] : typeof s === 'string' ? [s] : s.map(([, c]) => c));
  return [
    ...stops(l.head), ...stops(l.left), ...stops(l.shaft),
    ...(l.bands ?? []).map((b) => b.colour), ...(l.marks ?? []).map((m) => m.colour),
    ...[l.throat, l.cone, l.butt, l.buttTrim, l.collar, l.grip, l.grommets, l.strings].filter((c): c is string => c !== undefined),
  ];
}

/** Problems with a livery, or an empty list. */
export function liveryProblems(l: Livery): string[] {
  const out: string[] = [];
  for (const c of liveryColours(l)) if (!HEX.test(c)) out.push(`colour ${c}`);
  const runs = [l.head, l.left, l.shaft].filter((s): s is Exclude<Stops, string> => s !== undefined && typeof s !== 'string');
  for (const s of runs) {
    if (s.length === 0) out.push('empty stops');
    for (let i = 0; i < s.length; i++) {
      if (s[i][0] < 0 || s[i][0] > 1) out.push(`stop ${s[i][0]} outside 0–1`);
      if (i > 0 && s[i][0] < s[i - 1][0]) out.push('stops out of order');
    }
  }
  for (const b of l.bands ?? []) if (Math.abs(b.from) > 180 || Math.abs(b.to) > 180) out.push(`band ${b.from}..${b.to}`);
  for (const m of l.marks ?? []) if (Math.abs(m.at) > 180) out.push(`mark ${m.at}`);
  if (l.shape) {
    const { ratio, widest, nTop = 2.3, nBot = 2.1 } = l.shape;
    if (ratio < 0.7 || ratio > 0.86) out.push(`ratio ${ratio}`);
    if (widest < 0.45 || widest > 0.68) out.push(`widest ${widest}`);
    if (nTop < 1.6 || nTop > 3.4 || nBot < 1.5 || nBot > 3.2) out.push('squareness');
  }
  if (!l.source) out.push('no source');
  return out;
}

/* ── Pure colour maths, shared by the model and its tests ─────────────────── */

export type RGB = readonly [number, number, number];

export function hexToRgb(hex: string): RGB {
  const n = parseInt(hex.slice(1), 16);
  return [((n >> 16) & 255) / 255, ((n >> 8) & 255) / 255, (n & 255) / 255];
}

const mix = (a: RGB, b: RGB, t: number): RGB => [a[0] + (b[0] - a[0]) * t, a[1] + (b[1] - a[1]) * t, a[2] + (b[2] - a[2]) * t];
const smooth = (x: number, a: number, b: number) => {
  if (a === b) return x < a ? 0 : 1;
  const t = Math.min(1, Math.max(0, (x - a) / (b - a)));
  return t * t * (3 - 2 * t);
};

/** The colour of a run of stops at a position along it. */
export function sampleStops(s: Stops, at: number): RGB {
  if (typeof s === 'string') return hexToRgb(s);
  if (at <= s[0][0]) return hexToRgb(s[0][1]);
  for (let i = 1; i < s.length; i++) {
    if (at <= s[i][0]) {
      const [p0, c0] = s[i - 1];
      const [p1, c1] = s[i];
      return mix(hexToRgb(c0), hexToRgb(c1), p1 === p0 ? 1 : (at - p0) / (p1 - p0));
    }
  }
  return hexToRgb(s[s.length - 1][1]);
}

/** Signed shortest difference between two angles, in degrees. */
const angleDiff = (a: number, b: number) => ((((a - b) % 360) + 540) % 360) - 180;

/** How much a point at `deg` sits inside a band, 0–1, with soft edges. */
export function bandWeight(b: LiveryBand, deg: number): number {
  const soft = b.soft ?? 3;
  const span = ((b.to - b.from) % 360 + 360) % 360;
  const into = ((deg - b.from) % 360 + 360) % 360; // degrees past `from`, counter-clockwise
  const fromEdge = into > 180 + span / 2 ? into - 360 : into; // negative just before `from`
  return smooth(fromEdge, -soft / 2, soft / 2) * (1 - smooth(fromEdge, span - soft / 2, span + soft / 2));
}

/**
 * The head's colour at an angle and a height. `deg` as in the module header;
 * `h` 0 at the throat to 1 at the crown. Split first, then bands, then marks.
 */
export function headColour(l: Livery, deg: number, h: number): RGB {
  let c = sampleStops(l.head, h);
  if (l.left !== undefined) {
    const right = smooth(Math.cos((deg * Math.PI) / 180), -0.12, 0.12);
    c = mix(sampleStops(l.left, h), c, right);
  }
  for (const b of l.bands ?? []) {
    const w = bandWeight(b, deg);
    if (w > 0) c = mix(c, hexToRgb(b.colour), w);
  }
  for (const m of l.marks ?? []) {
    const w = Math.exp(-((angleDiff(deg, m.at) / ((m.width ?? 2) * 0.6)) ** 2));
    if (w > 0.01) c = mix(c, hexToRgb(m.colour), w);
  }
  return c;
}

/** The superellipse the model draws for a measured outline. `frameHalf` is the
 *  frame's half-width across the bed, so the OUTER outline matches the photo. */
export function shapeFromMeasure(s: LiveryShape, length: number, frameHalf: number) {
  const outerLen = length + 2 * frameHalf;
  const ryTop = s.widest * outerLen - frameHalf;
  return {
    label: 'Measured',
    rx: (s.ratio * outerLen - 2 * frameHalf) / 2,
    ryTop,
    ryBot: length - ryTop,
    nTop: s.nTop ?? 2.3,
    nBot: s.nBot ?? 2.1,
    lift: 0,
  };
}

/* eslint-disable no-restricted-syntax -- product data, not theme: these are the
   paint colours of physical rackets, as in lib/racketLook.ts. */

/**
 * Liveries by catalog id. A racket missing here keeps its three-colour look
 * from `RACKET_LOOKS`; adding one changes its list image, so re-run
 * `scripts/render-racket-images.mjs`.
 */
export const RACKET_LIVERIES: Record<string, Livery> = {
  'racket-li-ning-halbertec-9000': {
    source: 'badmintonhq.co.uk',
    head: '#8a33c8',
    left: '#3fd62a',
    bands: [
      { from: 84, to: 114, colour: '#161519', soft: 12 },
      { from: -112, to: -68, colour: '#161519', soft: 10 },
    ],
    marks: [150, 168, 200, 214, 30, 12, -18].map((at) => ({ at: at > 180 ? at - 360 : at, colour: '#161519', width: 2.2 })),
    throat: '#161519',
    shaft: [[0, '#f1f1ee'], [0.18, '#f1f1ee'], [0.38, '#161519'], [1, '#161519']],
    cone: '#f1f1ee',
    butt: '#f1f1ee',
    buttTrim: '#d9485f',
    collar: '#3fd62a',
    grip: '#f4f4f1',
    grommets: '#121214',
    strings: '#f2f0ea',
    finish: 'gloss',
    shape: { ratio: 0.774, widest: 0.578, nTop: 2.2, nBot: 1.8 },
  },
};

/* eslint-enable no-restricted-syntax */
