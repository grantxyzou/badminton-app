/**
 * Catalog search matching for the "choose your own" picker.
 *
 * Pure: no fetch, no DB, no clock. The picker is a LOOKUP surface — the member
 * already knows which racket they mean and is trying to find it among 71 rows —
 * so a miss is not "no such racket", it is the picker failing at its one job.
 * A member reported the Li-Ning Halbertec 5000 "missing" from the database. It
 * was there, fully normalized, and had been all along; the query was
 * "helbatec". A single `includes(lowercased)` answered no, the list rendered
 * empty, and the honest-looking empty state told them something false.
 *
 * Two passes, in order:
 *
 *   STRICT   every query token must appear somewhere in the row's text, in any
 *            order — so "5000 halbertec" and "lining halbertec" both hit, which
 *            plain substring matching does not.
 *   FUZZY    only when strict matched NOTHING across the whole list. Each query
 *            token must land within a small edit distance of some row token.
 *            Scoped this way on purpose: a fallback that runs per-row would let
 *            a loose match outrank an exact one, and running it only when there
 *            is nothing to lose cannot degrade a search that already worked.
 */

/** Lowercase, strip diacritics, and reduce every separator to a space, so
 *  "Li-Ning" / "li ning" / "LiNing" all normalize toward each other. */
export function normalizeText(value: string): string {
  return value
    .normalize('NFD')
    .replace(/[\u0300-\u036f]/g, '')
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, ' ')
    .trim();
}

export function tokenize(value: string): string[] {
  const n = normalizeText(value);
  return n ? n.split(' ') : [];
}

/**
 * Edit distance, capped: once the best possible result exceeds `max` there is
 * no reason to finish the matrix. Iterative two-row form — the catalog is small
 * but this runs per token pair, and the allocation is the expensive part.
 */
export function editDistance(a: string, b: string, max: number): number {
  if (a === b) return 0;
  if (Math.abs(a.length - b.length) > max) return max + 1;

  let prev = Array.from({ length: b.length + 1 }, (_, i) => i);
  let curr = new Array<number>(b.length + 1);

  for (let i = 1; i <= a.length; i++) {
    curr[0] = i;
    let rowBest = curr[0];
    for (let j = 1; j <= b.length; j++) {
      const cost = a[i - 1] === b[j - 1] ? 0 : 1;
      curr[j] = Math.min(curr[j - 1] + 1, prev[j] + 1, prev[j - 1] + cost);
      if (curr[j] < rowBest) rowBest = curr[j];
    }
    if (rowBest > max) return max + 1;
    const swap = prev;
    prev = curr;
    curr = swap;
  }

  return prev[b.length];
}

/**
 * How wrong a token is allowed to be.
 *
 * A token containing a DIGIT gets no tolerance whatever its length: in this
 * catalog the digits are the whole distinction. One edit turns 5000 into 9000
 * (Halbertec, two different frames), N65 into N68 and BG65 into BG68 (two
 * different strings a member could be holding). Forgiving a digit does not
 * find someone the row they meant, it hands them a different product.
 *
 * Short alphabetic tokens get none either — at three characters one edit
 * reaches half the alphabet.
 */
function tolerance(token: string): number {
  if (/[0-9]/.test(token)) return 0;
  if (token.length >= 7) return 2;
  if (token.length >= 4) return 1;
  return 0;
}

/**
 * The token with its vowels removed.
 *
 * Plain edit distance is the wrong model for how people misspell a brand name.
 * The query that started this was "helbatec" for "Halbertec": three edits — a
 * vowel swapped, a vowel moved, a consonant dropped — which is well past any
 * typo budget you would dare give an eight-letter token. But it is ONE error of
 * the kind people actually make: they remember the consonants and guess the
 * vowels. Comparing skeletons ("hlbtc" vs "hlbrtc") puts it back at distance 1.
 *
 * Guarded on length, because the skeleton throws away information: "bg68" and
 * "bg65" survive vowel-stripping unchanged and are one edit apart, and they are
 * two different strings. Only tokens long enough to have a skeleton worth
 * comparing get this treatment.
 */
const SKELETON_MIN_TOKEN = 5;
const SKELETON_MIN_LENGTH = 3;

function skeleton(token: string): string {
  return token.replace(/[aeiou]/g, '');
}

function skeletonsMatch(a: string, b: string): boolean {
  // Same reasoning as `tolerance`: a model number is not a word whose vowels
  // anyone is guessing at.
  if (/[0-9]/.test(a) || /[0-9]/.test(b)) return false;
  if (a.length < SKELETON_MIN_TOKEN || b.length < SKELETON_MIN_TOKEN) return false;
  const sa = skeleton(a);
  const sb = skeleton(b);
  if (sa.length < SKELETON_MIN_LENGTH || sb.length < SKELETON_MIN_LENGTH) return false;
  return editDistance(sa, sb, 1) <= 1;
}

/** Strict pass: every query token appears somewhere in the haystack. */
export function matchesQuery(haystack: string, query: string): boolean {
  const hay = normalizeText(haystack);
  const tokens = tokenize(query);
  if (tokens.length === 0) return true;
  return tokens.every((t) => hay.includes(t));
}

/** Fuzzy pass: every query token is within `tolerance` of some haystack token
 *  (or is a plain substring of one — a prefix is not a typo). */
export function matchesQueryFuzzy(haystack: string, query: string): boolean {
  const hayTokens = tokenize(haystack);
  const tokens = tokenize(query);
  if (tokens.length === 0) return true;

  return tokens.every((t) => {
    const max = tolerance(t);
    return hayTokens.some((h) => {
      // One direction only. The reverse — the row's token being contained in
      // the QUERY token — is not a prefix search: every row carries its series
      // as a token, so "bg68" would match BG65 through the bare series "bg".
      if (h.includes(t)) return true;
      if (max > 0 && editDistance(t, h, max) <= max) return true;
      return skeletonsMatch(t, h);
    });
  });
}

/**
 * Filter `items` by `query`, falling back to fuzzy matching only when the
 * strict pass leaves nothing. Returns the input order — the catalog's order is
 * curation order, and re-ranking by match quality would shuffle it for no
 * benefit on a list this size.
 */
export function searchCatalog<T>(items: T[], query: string, toText: (item: T) => string): T[] {
  if (!normalizeText(query)) return items;

  const strict = items.filter((i) => matchesQuery(toText(i), query));
  if (strict.length > 0) return strict;

  return items.filter((i) => matchesQueryFuzzy(toText(i), query));
}
