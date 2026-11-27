import { isConventionalPair } from './stringing';
import { colourIdOf, comboParts, type CustomColour, type ReelColourId } from './stringPalette';

/**
 * A job's two sides, mains and crosses, read off its one stored spec
 * (`docs/plans/stringing-jobs-list.md`; Grant's canvas, 2026-11-16: "M and C
 * always vertical stack with the icon + tension + string"). A job stores ONE
 * string label and ONE colour: a hybrid is written "<mains> / <crosses>" in
 * the label, a two-colour set "<mains>/<crosses>" in the colour (the palette's
 * own reading, `colourIdOf`). Pure, so the bench row and its tests agree.
 */
export interface JobSide {
  string: string;
  /** A single reel colour id, or null when the job names none (or one we cannot read). */
  colour: ReelColourId | null;
  tension: number;
}

export interface JobSides {
  mains: JobSide;
  crosses: JobSide;
  /** The player chose the pair: crosses other than the usual mains + 2 (`isConventionalPair`). */
  customTension: boolean;
  /** A different string on the crosses. */
  customStrings: boolean;
}

/** " / " with spaces splits a hybrid; a bare "/" is part of a name ("Li-Ning No.1/2" stays whole). */
const HYBRID = ' / ';
/** " · " before a colour at the end of a bench-typed label. */
const LABEL_COLOUR = ' · ';

/** One side's string and colour, without its tension. */
export type SideString = Pick<JobSide, 'string' | 'colour'>;

/**
 * The strings on a job's two sides, read off its label and colour: the ONE
 * reading of a hybrid, shared by the bench row (`jobSides`) and the stock
 * count (`summarizeStringStock`), so the shelf takes string off the same two
 * strings the stringer is shown. `hybrid` is a different string on each side.
 */
export function splitSides(
  stringLabel: string,
  stringColor: string | null | undefined,
  customs: readonly CustomColour[] = [],
): { mains: SideString; crosses: SideString; hybrid: boolean } {
  // A job added on the bench has no colour field; its label may end in one
  // ("BG80 · white"). Read it only when it names a colour we know, and drop
  // it from the string's name so the pill does not say it twice.
  let label = stringLabel.trim();
  let labelColour: ReelColourId | null = null;
  const dot = label.lastIndexOf(LABEL_COLOUR);
  if (dot > 0) {
    const tail = colourIdOf(label.slice(dot + LABEL_COLOUR.length).trim(), customs);
    if (tail) { labelColour = tail; label = label.slice(0, dot).trim(); }
  }
  const at = label.indexOf(HYBRID);
  const mainsString = at > 0 ? label.slice(0, at).trim() : label;
  const crossesString = at > 0 ? label.slice(at + HYBRID.length).trim() || mainsString : mainsString;

  const id = colourIdOf(stringColor ?? null, customs) ?? labelColour;
  const parts = id ? comboParts(id) : null;
  const mainsColour: ReelColourId | null = parts ? parts.mains : id;
  const crossesColour: ReelColourId | null = parts ? parts.crosses : id;

  return {
    mains: { string: mainsString, colour: mainsColour },
    crosses: { string: crossesString, colour: crossesColour },
    hybrid: mainsString.toLowerCase() !== crossesString.toLowerCase(),
  };
}

export function jobSides(
  job: { stringLabel: string; stringColor?: string | null; tensionMains: number; tensionCrosses: number },
  customs: readonly CustomColour[] = [],
): JobSides {
  const { mains, crosses, hybrid } = splitSides(job.stringLabel, job.stringColor, customs);
  return {
    mains: { ...mains, tension: job.tensionMains },
    crosses: { ...crosses, tension: job.tensionCrosses },
    customTension: !isConventionalPair(job.tensionMains, job.tensionCrosses),
    customStrings: hybrid,
  };
}
