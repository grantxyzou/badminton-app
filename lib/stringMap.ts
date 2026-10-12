/**
 * The geometry of the "Strings we offer" map (docs/design/strings-shelf-spec.md):
 * each string a dot, power up the side, durability along the bottom.
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
  power: number;
  durability: number;
}

export interface Point {
  x: number;
  y: number;
}

/**
 * Pixel centres inside a `width` × `height` plot, in input order. x is
 * durability (right lasts longer), y is power (up hits harder). Strings on an
 * identical point spread `SAME_POINT_SPREAD` apart around it, in input order,
 * so neither hides the other.
 */
export function dotPositions(items: readonly MapInput[], width: number, height: number): Point[] {
  const x = axisDomain(items.map((i) => i.durability));
  const y = axisDomain(items.map((i) => i.power));
  const raw = items.map((i) => ({
    x: ((i.durability - x.min) / (x.max - x.min)) * width,
    y: height - ((i.power - y.min) / (y.max - y.min)) * height,
  }));
  const groups = new Map<string, number[]>();
  items.forEach((i, n) => {
    const key = `${i.durability}|${i.power}`;
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

function rectFor(dot: Point, w: number, h: number, side: LabelSide): PlacedLabel {
  const r = DOT_PX / 2 + LABEL_GAP;
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
}): (PlacedLabel | null)[] {
  const { dots, widths, labelHeight: h, width, height, selected } = input;
  const dotRects: Rect[] = dots.map((d) => ({ x: d.x - DOT_PX / 2, y: d.y - DOT_PX / 2, w: DOT_PX, h: DOT_PX }));
  const out: (PlacedLabel | null)[] = dots.map(() => null);
  const placed: Rect[] = [];
  const order = selected !== null && selected >= 0 && selected < dots.length
    ? [selected, ...dots.map((_, i) => i).filter((i) => i !== selected)]
    : dots.map((_, i) => i);

  for (const i of order) {
    const candidates = SIDES.map((side) => rectFor(dots[i], widths[i], h, side));
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
