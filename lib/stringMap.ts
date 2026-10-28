/**
 * The geometry of the "Strings in stock" map (docs/design/strings-shelf-spec.md):
 * each string a dot, durability along the bottom, and up the side whichever
 * rating the member picked — power, control or feel (`MapAxis` in
 * `lib/stringShelf.ts`). The geometry does not care which: it takes a value.
 *
 * Pure and import-free on purpose — the card is a client component, and this
 * is the part a test can pin: the domain, where the dots land, and where the
 * labels go. Label WIDTHS come from the caller (the card measures them in its
 * own font), so nothing here touches the DOM.
 */

/** Fewer plotted strings than this and the card shows the list only. */
export const MIN_PLOTTED = 3;
/** The narrowest span an axis is allowed, in rating points. */
export const MIN_SPAN = 4;
/** Strings on the same point fan out horizontally this far apart, in px. */
export const SAME_POINT_SPREAD = 10;
/** The visible dot. */
export const DOT_PX = 14;
/** A dot standing for several strings on one point, big enough for its count. */
export const CLUSTER_PX = 22;
/** How far a zoomed cluster's strings sit from its centre, in px. */
export const RING_RADIUS = 52;
/** Between a dot and its label. */
export const LABEL_GAP = 2;

export interface Domain {
  min: number;
  max: number;
}

/**
 * `[min − 1, max + 1]` of the plotted values, widened evenly to at least
 * `MIN_SPAN`. The low end is clamped at 0; the high end may pass 10, which
 * leaves room for a label beside the top dot.
 */
export function axisDomain(values: readonly number[]): Domain {
  if (values.length === 0) return { min: 0, max: MIN_SPAN };
  let min = Math.min(...values) - 1;
  let max = Math.max(...values) + 1;
  if (max - min < MIN_SPAN) {
    const extra = (MIN_SPAN - (max - min)) / 2;
    min -= extra;
    max += extra;
  }
  if (min < 0) {
    max += -min;
    min = 0;
  }
  return { min, max };
}

export function canPlot(plottedCount: number): boolean {
  return plottedCount >= MIN_PLOTTED;
}

export interface MapInput {
  /** Up the side: the picked axis's rating. */
  value: number;
  durability: number;
}

export interface Point {
  x: number;
  y: number;
}

/**
 * Pixel centres inside a `width` × `height` plot, in input order. x is
 * durability (right lasts longer), y is the picked axis (up is more). Strings on an
 * identical point spread `SAME_POINT_SPREAD` apart around it, in input order,
 * so neither hides the other.
 */
export function dotPositions(items: readonly MapInput[], width: number, height: number): Point[] {
  const x = axisDomain(items.map((i) => i.durability));
  const y = axisDomain(items.map((i) => i.value));
  const raw = items.map((i) => ({
    x: ((i.durability - x.min) / (x.max - x.min)) * width,
    y: height - ((i.value - y.min) / (y.max - y.min)) * height,
  }));
  const groups = new Map<string, number[]>();
  items.forEach((i, n) => {
    const key = `${i.durability}|${i.value}`;
    groups.set(key, [...(groups.get(key) ?? []), n]);
  });
  for (const members of groups.values()) {
    if (members.length < 2) continue;
    const start = -((members.length - 1) * SAME_POINT_SPREAD) / 2;
    members.forEach((n, k) => {
      raw[n] = { x: raw[n].x + start + k * SAME_POINT_SPREAD, y: raw[n].y };
    });
  }
  return raw;
}

export interface Rect {
  x: number;
  y: number;
  w: number;
  h: number;
}

export type LabelSide = 'right' | 'left' | 'above' | 'below';
export interface PlacedLabel extends Rect {
  side: LabelSide;
}

const SIDES: LabelSide[] = ['right', 'left', 'above', 'below'];

function rectFor(dot: Point, w: number, h: number, side: LabelSide, size = DOT_PX): PlacedLabel {
  const r = size / 2 + LABEL_GAP;
  switch (side) {
    case 'right': return { side, x: dot.x + r, y: dot.y - h / 2, w, h };
    case 'left': return { side, x: dot.x - r - w, y: dot.y - h / 2, w, h };
    case 'above': return { side, x: dot.x - w / 2, y: dot.y - r - h, w, h };
    case 'below': return { side, x: dot.x - w / 2, y: dot.y + r, w, h };
  }
}

function overlaps(a: Rect, b: Rect): boolean {
  return a.x < b.x + b.w && b.x < a.x + a.w && a.y < b.y + b.h && b.y < a.y + a.h;
}

function inside(r: Rect, width: number, height: number): boolean {
  return r.x >= 0 && r.y >= 0 && r.x + r.w <= width && r.y + r.h <= height;
}

/**
 * Where each dot's label goes, or `null` for a label that does not fit.
 *
 * The selected string is placed first, then the rest in input order. Each
 * tries right, left, above, then below its dot and takes the first spot that
 * stays inside the plot and covers no dot and no label already placed. A
 * label with no spot is hidden — the dot keeps its accessible name, and the
 * panel names it once it is picked. The SELECTED label is always shown: with
 * no clean spot it takes the first one inside the plot, else it is clamped in.
 */
export function placeLabels(input: {
  dots: readonly Point[];
  widths: readonly number[];
  labelHeight: number;
  width: number;
  height: number;
  selected: number | null;
  /** Each dot's diameter, when they differ (a cluster is bigger). */
  sizes?: readonly number[];
  /** Dots that want no label (a cluster shows its count instead). */
  unlabelled?: readonly boolean[];
  /** Space nothing may cover, e.g. the plot's corner hint. */
  reserved?: readonly Rect[];
}): (PlacedLabel | null)[] {
  const { dots, widths, labelHeight: h, width, height, selected } = input;
  const size = (i: number) => input.sizes?.[i] ?? DOT_PX;
  const dotRects: Rect[] = [
    ...dots.map((d, i) => ({ x: d.x - size(i) / 2, y: d.y - size(i) / 2, w: size(i), h: size(i) })),
    ...(input.reserved ?? []),
  ];
  const out: (PlacedLabel | null)[] = dots.map(() => null);
  const placed: Rect[] = [];
  const order = selected !== null && selected >= 0 && selected < dots.length
    ? [selected, ...dots.map((_, i) => i).filter((i) => i !== selected)]
    : dots.map((_, i) => i);

  for (const i of order) {
    if (input.unlabelled?.[i] && i !== selected) continue;
    const candidates = SIDES.map((side) => rectFor(dots[i], widths[i], h, side, size(i)));
    let pick = candidates.find((r) => inside(r, width, height) && !dotRects.some((d) => overlaps(r, d)) && !placed.some((p) => overlaps(r, p))) ?? null;
    if (!pick && i === selected) {
      pick = candidates.find((r) => inside(r, width, height)) ?? clampInto(candidates[0], width, height);
    }
    if (pick) {
      out[i] = pick;
      placed.push(pick);
    }
  }
  return out;
}

function clampInto(r: PlacedLabel, width: number, height: number): PlacedLabel {
  return {
    ...r,
    x: Math.max(0, Math.min(width - r.w, r.x)),
    y: Math.max(0, Math.min(height - r.h, r.y)),
  };
}

/** Strings that share one point on the map: their indices, in input order. */
export interface Cluster {
  key: string;
  members: number[];
}

/**
 * Strings with IDENTICAL scores, grouped (Grant, on the crowded map: "How do we
 * handel large list of maps? they overlapp"). Spreading them 10px apart stopped
 * two dots hiding each other and still left five labels fighting for one
 * spot; one dot with its count, opened by a tap, does not.
 */
export function clusterPoints(items: readonly MapInput[]): Cluster[] {
  const byKey = new Map<string, number[]>();
  items.forEach((i, n) => {
    const key = `${i.durability}|${i.value}`;
    byKey.set(key, [...(byKey.get(key) ?? []), n]);
  });
  return [...byKey.entries()].map(([key, members]) => ({ key, members }));
}

/**
 * A zoomed cluster's strings, evenly round a ring centred in the plot,
 * starting at the top and going clockwise. One string sits at the centre.
 */
export function ringPositions(count: number, width: number, height: number, radius = RING_RADIUS): Point[] {
  const cx = width / 2;
  const cy = height / 2;
  if (count <= 1) return [{ x: cx, y: cy }];
  return Array.from({ length: count }, (_, i) => {
    const angle = -Math.PI / 2 + (i * 2 * Math.PI) / count;
    return { x: cx + radius * Math.cos(angle), y: cy + radius * Math.sin(angle) };
  });
}
