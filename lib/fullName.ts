/**
 * "First and last name" (Grant, 2026-11-07): the door link asks a new person
 * for both, so an organiser approving "Sandra" from a lock screen knows which
 * Sandra, and two Sandras on one roster stay two names.
 *
 * A name counts as full when it has two parts that each carry a letter
 * ("Sandra Lee", "Chris L."). A name written in a script that does not put a
 * space between the family and given name (Chinese, Japanese, Korean) counts
 * when it is at least two characters: "张伟" is a full name, and asking for a
 * space there would refuse every Chinese-speaking member.
 *
 * Shared by the sheet that asks and the route that stores the ask, so the two
 * cannot disagree about what passes.
 */
const NO_SPACE_SCRIPTS = /[\p{Script=Han}\p{Script=Hiragana}\p{Script=Katakana}\p{Script=Hangul}]/u;
const LETTER = /\p{L}/u;

export function isFullName(raw: string): boolean {
  const name = typeof raw === 'string' ? raw.trim() : '';
  if (!name) return false;
  if (NO_SPACE_SCRIPTS.test(name)) return [...name.replace(/\s+/g, '')].length >= 2;
  const parts = name.split(/\s+/).filter((p) => LETTER.test(p));
  return parts.length >= 2;
}
